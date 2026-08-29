import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FraudAnalyzeInput,
  InvestigateInput,
  SummarizeInput,
} from '../../src/services/ai/aiService';

/**
 * AIService unit tests. `fetch` is stubbed so no real OpenAI calls are made.
 * Covers: a successful structured call, upstream API failure, request timeout,
 * malformed / schema-violating output, a missing API key, and the per-feature
 * result shapes for fraud analysis, transaction investigation and summaries.
 */

const jsonResponse = (content: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  }),
});

const INVESTIGATE_INPUT: InvestigateInput = {
  reference: 'TXN-20260829-DEADBEEF',
  direction: 'SENT',
  amount_bdt: '50000.00',
  status: 'COMPLETED',
  outcome: 'DELIVERED',
  attempt_count: 1,
  created_at: '2026-08-29T10:00:00.000Z',
  counterparty_name: 'Fatima Khan',
  timeline: [
    { step: 1, state: 'PENDING', event: 'INITIATED', at: '2026-08-29T10:00:00.000Z' },
    { step: 2, state: 'PROCESSING', event: 'BALANCE_LOCKED', at: '2026-08-29T10:00:01.000Z' },
    { step: 3, state: 'PROCESSING', event: 'PROCESSED', at: '2026-08-29T10:00:02.000Z' },
    { step: 4, state: 'COMPLETED', event: 'COMPLETED', at: '2026-08-29T10:00:03.000Z' },
  ],
  reconciliation: {
    ledger_entry_count: 2,
    money_moved: true,
    net_ledger_paisa: '0',
    snapshot_consistent: true,
  },
  fraud: { band: 'MEDIUM', score: 30, reasons: ['Unusually large transaction'] },
};

const FRAUD_INPUT: FraudAnalyzeInput = {
  reference: 'TXN-20260829-CAFEBABE',
  signals: {
    transaction_amount_bdt: '50000.00',
    recent_transaction_count: 8,
    recipient_is_new: true,
    device_is_new: true,
    failed_auth_attempts: 0,
    transaction_frequency_window_minutes: 10,
    user_transaction_baseline_bdt: '1200.00',
    existing_risk_score: 72,
  },
  rule_based: {
    band: 'HIGH',
    decision: 'BLOCKED',
    score: 72,
    reasons: ['Unusually large transaction', 'New recipient', 'New device'],
  },
};

const SUMMARY_INPUT: SummarizeInput = {
  period: 'monthly',
  range: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-29T00:00:00.000Z' },
  totals: { sent_bdt: '32500.00', received_bdt: '18000.00', net_bdt: '-14500.00' },
  top_category: { name: 'Food', amount_bdt: '9200.00' },
  categories: [
    { name: 'Food', amount_bdt: '9200.00' },
    { name: 'Transport', amount_bdt: '4300.00' },
  ],
  comparison: { previous_sent_bdt: '28500.00', change_pct: 14 },
  counts: { sent: 11, received: 4 },
};

let fetchMock: ReturnType<typeof vi.fn>;

async function loadAIService() {
  vi.resetModules();
  return (await import('../../src/services/ai/aiService')).AIService;
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key-abc123');
  vi.stubEnv('OPENAI_MODEL', 'gpt-4o-mini');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AIService — successful structured call', () => {
  it('returns an AI-sourced result and calls OpenAI in JSON mode', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        JSON.stringify({
          summary: 'Your transfer completed normally.',
          timeline_explained: ['Transfer initiated', 'Balance verified', 'Funds moved', 'Completed'],
          money_status: 'DELIVERED',
          what_this_means: 'Your money was delivered to Fatima Khan.',
        })
      )
    );
    const AIService = await loadAIService();
    const { result, meta } = await AIService.investigateTransfer(INVESTIGATE_INPUT);

    expect(result.source).toBe('ai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.money_status).toBe('DELIVERED');
    expect(Array.isArray(result.timeline_explained)).toBe(true);
    expect(meta.outcome).toBe('ok');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as any).body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('gpt-4o-mini');
    expect((init as any).headers.Authorization).toContain('test-key-abc123');
  });

  it('never echoes the API key back in the result', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        JSON.stringify({
          summary: 's',
          timeline_explained: ['a'],
          money_status: 'DELIVERED',
          what_this_means: 'w',
        })
      )
    );
    const AIService = await loadAIService();
    const { result } = await AIService.investigateTransfer(INVESTIGATE_INPUT);
    expect(JSON.stringify(result)).not.toContain('test-key-abc123');
  });
});

describe('AIService — OpenAI API failure', () => {
  it('falls back deterministically on repeated 500s (no throw)', async () => {
    fetchMock.mockResolvedValue(jsonResponse('{}', 500));
    const AIService = await loadAIService();
    const { result, meta } = await AIService.investigateTransfer(INVESTIGATE_INPUT);

    expect(result.source).toBe('fallback');
    expect(result.money_status).toBe('DELIVERED'); // still derived from the ledger outcome
    expect(result.timeline_explained.length).toBeGreaterThan(0);
    expect(meta.outcome).toBe('error');
    expect(meta.errorCode).toBe('AI_UPSTREAM');
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1); // retried
  });

  it('does not retry on a 4xx and falls back', async () => {
    fetchMock.mockResolvedValue(jsonResponse('{}', 400));
    const AIService = await loadAIService();
    const { result, meta } = await AIService.analyzeFraud(FRAUD_INPUT);
    expect(result.source).toBe('fallback');
    expect(meta.errorCode).toBe('AI_UPSTREAM');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('AIService — request timeout', () => {
  it('falls back when the request aborts', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const AIService = await loadAIService();
    const { result, meta } = await AIService.summarizeFinances(SUMMARY_INPUT);

    expect(result.source).toBe('fallback');
    expect(meta.errorCode).toBe('AI_TIMEOUT');
    expect(result.headline.length).toBeGreaterThan(0);
    expect(result.observations.length).toBeGreaterThan(0);
  });
});

describe('AIService — malformed AI output', () => {
  it('falls back when the completion is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('not json at all {['));
    const AIService = await loadAIService();
    const { result, meta } = await AIService.investigateTransfer(INVESTIGATE_INPUT);
    expect(result.source).toBe('fallback');
    expect(meta.errorCode).toBe('AI_BAD_OUTPUT');
  });

  it('falls back when JSON is valid but violates the schema', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(JSON.stringify({ risk_level: 'CATASTROPHIC', reasoning_summary: 'x' }))
    );
    const AIService = await loadAIService();
    const { result, meta } = await AIService.analyzeFraud(FRAUD_INPUT);
    expect(result.source).toBe('fallback');
    expect(meta.errorCode).toBe('AI_BAD_OUTPUT');
    // fallback mirrors the deterministic band
    expect(result.risk_level).toBe('HIGH');
  });

  it('sanitises oversized / control-char strings and caps arrays', async () => {
    const esc = String.fromCharCode(27); // ANSI escape — a control char
    const nul = String.fromCharCode(0);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        JSON.stringify({
          headline: 'H'.repeat(5000),
          observations: Array.from({ length: 50 }, (_, i) => 'obs ' + i),
          spending_note: 'clean' + esc + nul + 'text',
        })
      )
    );
    const AIService = await loadAIService();
    const { result } = await AIService.summarizeFinances(SUMMARY_INPUT);
    expect(result.source).toBe('ai');
    expect(result.headline.length).toBeLessThanOrEqual(240);
    expect(result.observations.length).toBeLessThanOrEqual(6);
    expect(result.spending_note).toBe('clean text');
  });
});

describe('AIService — missing API key', () => {
  it('returns a fallback without calling OpenAI', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const AIService = await loadAIService();
    expect(AIService.enabled).toBe(false);

    const { result, meta } = await AIService.analyzeFraud(FRAUD_INPUT);
    expect(result.source).toBe('fallback');
    expect(meta.errorCode).toBe('AI_DISABLED');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('AIService — fraud analysis shape', () => {
  it('returns risk_level, reasoning_summary, risk_factors, recommended_action', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        JSON.stringify({
          risk_level: 'HIGH',
          reasoning_summary: 'Large amount to a new recipient from a new device.',
          risk_factors: ['Unusually large transaction', 'New recipient', 'New device', 'High recent frequency'],
          recommended_action: 'Require additional verification before proceeding.',
        })
      )
    );
    const AIService = await loadAIService();
    const { result } = await AIService.analyzeFraud(FRAUD_INPUT);

    expect(result.source).toBe('ai');
    expect(result.risk_level).toBe('HIGH');
    expect(result.reasoning_summary).toContain('new recipient');
    expect(result.risk_factors).toContain('New device');
    expect(result.recommended_action).toMatch(/verification/i);
  });
});

describe('AIService — transaction investigation shape', () => {
  it('forces money_status from the ledger outcome even if the model disagrees', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        JSON.stringify({
          summary: 'It failed.',
          timeline_explained: ['Initiated', 'Failed'],
          money_status: 'DELIVERED', // model is wrong on purpose
          what_this_means: 'gone',
        })
      )
    );
    const AIService = await loadAIService();
    const { result } = await AIService.investigateTransfer({
      ...INVESTIGATE_INPUT,
      outcome: 'NOT_SENT',
      status: 'FAILED',
    });
    expect(result.money_status).toBe('SAFE'); // NOT_SENT -> SAFE, not the model's DELIVERED
  });
});

describe('AIService — financial summary shape', () => {
  it('returns headline, observations and a spending note', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        JSON.stringify({
          headline: 'You spent more than you received this month.',
          observations: [
            'Total sent was ৳32,500 against ৳18,000 received.',
            'Food was your top category at ৳9,200.',
            'Spending rose 14% versus last month.',
          ],
          spending_note: 'Your food-related spending increased noticeably this month.',
        })
      )
    );
    const AIService = await loadAIService();
    const { result } = await AIService.summarizeFinances(SUMMARY_INPUT);

    expect(result.source).toBe('ai');
    expect(result.headline.length).toBeGreaterThan(0);
    expect(result.observations.length).toBeGreaterThanOrEqual(2);
    expect(result.spending_note).toMatch(/food/i);
  });
});

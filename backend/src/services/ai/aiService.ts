import { z } from 'zod';
import { aiConfigured, env } from '../../config/env';
import { logger } from '../../utils/logger';
import { chatJson, AIError } from './openaiClient';

/**
 * AIService — the single, reusable abstraction over OpenAI for this app.
 *
 * Contract for every method:
 *  - Input is an already-sanitised, structured object built by a caller from
 *    authorised data. This module adds NOTHING sensitive.
 *  - Output is validated against a strict zod schema and every string is
 *    sanitised (trimmed, control chars stripped, length-capped) before return.
 *  - On ANY failure (no key, timeout, upstream error, malformed output) the
 *    method returns a deterministic fallback with `source: 'fallback'`. It never
 *    throws to the caller, so the core product is unaffected by AI outages.
 *
 * Internal prompts are not exported and never included in API responses.
 */

// --------------------------------------------------------------------------
// output sanitisation
// --------------------------------------------------------------------------

function clean(s: unknown, max = 600): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanList(v: unknown, maxItems = 8, maxLen = 240): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => clean(x, maxLen))
    .filter((x) => x.length > 0)
    .slice(0, maxItems);
}

// --------------------------------------------------------------------------
// feature 1 — Transaction Investigator
// --------------------------------------------------------------------------

export interface InvestigateInput {
  reference: string;
  direction: 'SENT' | 'RECEIVED';
  amount_bdt: string;
  status: string;
  outcome: 'DELIVERED' | 'NOT_SENT' | 'INDETERMINATE';
  attempt_count: number;
  created_at: string;
  counterparty_name: string;
  timeline: Array<{ step: number; state: string; event: string; at: string; note?: string }>;
  reconciliation: {
    ledger_entry_count: number;
    money_moved: boolean;
    net_ledger_paisa: string;
    snapshot_consistent: boolean;
  };
  fraud: { band: string; score: number; reasons: string[] } | null;
}

export type MoneyStatus = 'DELIVERED' | 'SAFE' | 'NEEDS_VERIFICATION';

export interface InvestigateResult {
  source: 'ai' | 'fallback';
  model: string | null;
  summary: string;
  timeline_explained: string[];
  money_status: MoneyStatus;
  what_this_means: string;
}

const investigateSchema = z.object({
  summary: z.string(),
  timeline_explained: z.array(z.string()),
  money_status: z.enum(['DELIVERED', 'SAFE', 'NEEDS_VERIFICATION']),
  what_this_means: z.string(),
});

/** "24703.50" -> "24,703.50" — display only, used inside deterministic fallback prose. */
function fmt(bdt: string): string {
  const [whole, frac = '00'] = bdt.replace('-', '').split('.');
  const withSep = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${bdt.startsWith('-') ? '-' : ''}${withSep}.${frac}`;
}

function moneyStatusFor(outcome: InvestigateInput['outcome']): MoneyStatus {
  if (outcome === 'DELIVERED') return 'DELIVERED';
  if (outcome === 'NOT_SENT') return 'SAFE';
  return 'NEEDS_VERIFICATION';
}

const EVENT_PHRASE: Record<string, string> = {
  INITIATED: 'Transfer initiated',
  BALANCE_LOCKED: 'Balance verified and funds held',
  PROCESSED: 'Transfer committed — funds moved on the ledger',
  COMPLETED: 'Transfer completed',
  FAILED: 'Transfer failed — no money moved',
  CLIENT_CONFIRMATION_LOST: 'Client confirmation lost',
  VERIFIED: 'Transaction reconciled against the ledger',
};

function investigateFallback(input: InvestigateInput): InvestigateResult {
  const status = moneyStatusFor(input.outcome);
  const steps = input.timeline.map((t) => EVENT_PHRASE[t.event] ?? `${t.state}: ${t.event}`);
  const verb = input.direction === 'SENT' ? 'sent' : 'received';
  const meaning =
    status === 'DELIVERED'
      ? `Your money was delivered. ৳${fmt(input.amount_bdt)} was ${verb} exactly once and the ledger balances.`
      : status === 'SAFE'
        ? `Your money is safe. No funds left the account for this transaction — your balance is unchanged.`
        : `This transaction could not be confirmed automatically and needs manual verification. No action has changed your balance.`;
  return {
    source: 'fallback',
    model: null,
    summary: `Transaction ${input.reference} (${verb} ৳${fmt(input.amount_bdt)}) is currently ${input.status}. Reconciliation against the immutable ledger found ${input.reconciliation.ledger_entry_count} entr${input.reconciliation.ledger_entry_count === 1 ? 'y' : 'ies'} and concluded: ${input.outcome}.`,
    timeline_explained: steps.length ? steps : ['No timeline events were recorded for this transaction.'],
    money_status: status,
    what_this_means: meaning,
  };
}

// --------------------------------------------------------------------------
// feature 2 — AI-Assisted Fraud Analysis
// --------------------------------------------------------------------------

export interface FraudSignals {
  transaction_amount_bdt: string;
  recent_transaction_count: number;
  recipient_is_new: boolean;
  device_is_new: boolean;
  failed_auth_attempts: number;
  transaction_frequency_window_minutes: number;
  user_transaction_baseline_bdt: string;
  existing_risk_score: number;
}

export interface FraudAnalyzeInput {
  reference: string;
  signals: FraudSignals;
  rule_based: { band: string; decision: string; score: number; reasons: string[] };
}

export interface FraudAnalysisResult {
  source: 'ai' | 'fallback';
  model: string | null;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasoning_summary: string;
  risk_factors: string[];
  recommended_action: string;
}

const fraudSchema = z.object({
  risk_level: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  reasoning_summary: z.string(),
  risk_factors: z.array(z.string()),
  recommended_action: z.string(),
});

function fraudFallback(input: FraudAnalyzeInput): FraudAnalysisResult {
  const band = (['LOW', 'MEDIUM', 'HIGH'].includes(input.rule_based.band)
    ? input.rule_based.band
    : 'LOW') as 'LOW' | 'MEDIUM' | 'HIGH';
  const factors: string[] = [];
  const s = input.signals;
  if (Number(s.transaction_amount_bdt) >= Number(s.user_transaction_baseline_bdt) * 3 && Number(s.user_transaction_baseline_bdt) > 0)
    factors.push('Transaction is well above this user’s typical amount');
  if (s.recipient_is_new) factors.push('Recipient has not been paid by this user before');
  if (s.device_is_new) factors.push('Request came from a new device or network');
  if (s.recent_transaction_count >= 5) factors.push(`High recent activity: ${s.recent_transaction_count} transfers in the last window`);
  if (s.failed_auth_attempts > 0) factors.push(`${s.failed_auth_attempts} recent failed login attempt(s)`);
  if (factors.length === 0) factors.push('No individual signal stands out; rule-based score is the basis for this level');
  const action =
    band === 'HIGH'
      ? 'Require additional verification and hold the transfer for security review before proceeding.'
      : band === 'MEDIUM'
        ? 'Ask the user for a step-up confirmation before completing the transfer.'
        : 'Allow the transfer; continue routine monitoring.';
  return {
    source: 'fallback',
    model: null,
    risk_level: band,
    reasoning_summary: `Deterministic rules scored this ${input.rule_based.score}/100 (${band}). ${input.rule_based.reasons.length ? 'Contributing rules: ' + input.rule_based.reasons.join(', ') + '.' : 'No individual rules were triggered.'}`,
    risk_factors: factors.slice(0, 8),
    recommended_action: action,
  };
}

// --------------------------------------------------------------------------
// feature 3 — Smart Financial Summaries
// --------------------------------------------------------------------------

export interface SummarizeInput {
  period: 'weekly' | 'monthly';
  range: { from: string; to: string };
  totals: { sent_bdt: string; received_bdt: string; net_bdt: string };
  top_category: { name: string; amount_bdt: string } | null;
  categories: Array<{ name: string; amount_bdt: string }>;
  comparison: { previous_sent_bdt: string; change_pct: number } | null;
  counts: { sent: number; received: number };
}

export interface SummaryResult {
  source: 'ai' | 'fallback';
  model: string | null;
  headline: string;
  observations: string[];
  spending_note: string;
}

const summarySchema = z.object({
  headline: z.string(),
  observations: z.array(z.string()),
  spending_note: z.string(),
});

function summaryFallback(input: SummarizeInput): SummaryResult {
  const obs: string[] = [];
  obs.push(
    `You sent ৳${fmt(input.totals.sent_bdt)} and received ৳${fmt(input.totals.received_bdt)} this ${input.period === 'weekly' ? 'week' : 'month'} (net ৳${fmt(input.totals.net_bdt)}).`
  );
  if (input.top_category) {
    obs.push(`Your largest spending category was ${input.top_category.name} at ৳${fmt(input.top_category.amount_bdt)}.`);
  }
  if (input.comparison) {
    const dir = input.comparison.change_pct > 0 ? 'increased' : input.comparison.change_pct < 0 ? 'decreased' : 'stayed flat';
    obs.push(`Compared with the previous ${input.period === 'weekly' ? 'week' : 'month'}, spending ${dir} by ${Math.abs(input.comparison.change_pct)}%.`);
  }
  return {
    source: 'fallback',
    model: null,
    headline: `${input.period === 'weekly' ? 'Weekly' : 'Monthly'} summary: ৳${fmt(input.totals.sent_bdt)} out, ৳${fmt(input.totals.received_bdt)} in`,
    observations: obs,
    spending_note: input.top_category
      ? `Most of your outgoing money went to ${input.top_category.name}.`
      : 'No categorised spending was recorded in this period.',
  };
}

// --------------------------------------------------------------------------
// prompts (internal — never returned to clients)
// --------------------------------------------------------------------------

const GUARDRAILS =
  'You are a careful financial-explanation assistant for a peer-to-peer wallet app. ' +
  'Rules: only use the numbers and facts in the JSON provided; never invent figures, ' +
  'names, or events; never give investment or financial advice; never claim you can ' +
  'change balances or transactions. Write in plain, calm language a non-expert can ' +
  'understand. Respond with ONLY a JSON object matching the requested keys.';

async function call<T>(
  feature: string,
  system: string,
  userPayload: unknown,
  schema: z.ZodType<T>,
  maxTokens: number
): Promise<{ parsed: T; model: string; usage: { prompt_tokens?: number; completion_tokens?: number }; duration_ms: number }> {
  const { json, model, usage, duration_ms } = await chatJson({
    system: `${GUARDRAILS}\n\n${system}`,
    user: JSON.stringify(userPayload),
    maxTokens,
  });
  const result = schema.safeParse(json);
  if (!result.success) {
    logger.warn('ai output failed schema validation', { feature, issues: result.error.issues.length });
    throw new AIError('AI_BAD_OUTPUT', 'AI output did not match the expected schema');
  }
  return { parsed: result.data, model, usage, duration_ms };
}

// --------------------------------------------------------------------------
// public API
// --------------------------------------------------------------------------

export const AIService = {
  get enabled(): boolean {
    return aiConfigured();
  },
  get model(): string {
    return env.OPENAI_MODEL;
  },

  /** Feature 1: explain an uncertain / failed / suspicious transaction. */
  async investigateTransfer(
    input: InvestigateInput
  ): Promise<{ result: InvestigateResult; meta: CallMeta }> {
    if (!aiConfigured()) return { result: investigateFallback(input), meta: metaDisabled() };
    try {
      const { parsed, model, usage, duration_ms } = await call(
        'investigate',
        'Explain what happened to this transaction. Keys: "summary" (2-4 sentences), ' +
          '"timeline_explained" (array, one short human sentence per timeline step, in order), ' +
          '"money_status" (one of "DELIVERED", "SAFE", "NEEDS_VERIFICATION" — match the provided ' +
          '"outcome": DELIVERED->DELIVERED, NOT_SENT->SAFE, INDETERMINATE->NEEDS_VERIFICATION), ' +
          '"what_this_means" (1-2 sentences telling the user plainly whether their money was ' +
          'delivered, is safe, or needs verification).',
        input,
        investigateSchema,
        700
      );
      // The ledger outcome is authoritative — do not let the model override it.
      const forced = moneyStatusFor(input.outcome);
      return {
        result: {
          source: 'ai',
          model,
          summary: clean(parsed.summary, 900),
          timeline_explained: cleanList(parsed.timeline_explained, 12, 240),
          money_status: forced,
          what_this_means: clean(parsed.what_this_means, 500),
        },
        meta: metaOk('ai_investigate', model, usage, duration_ms),
      };
    } catch (err) {
      return { result: investigateFallback(input), meta: metaErr('ai_investigate', err) };
    }
  },

  /** Feature 2: secondary, advisory analysis of deterministic fraud signals. */
  async analyzeFraud(
    input: FraudAnalyzeInput
  ): Promise<{ result: FraudAnalysisResult; meta: CallMeta }> {
    if (!aiConfigured()) return { result: fraudFallback(input), meta: metaDisabled() };
    try {
      const { parsed, model, usage, duration_ms } = await call(
        'fraud',
        'Give a SECONDARY behavioural risk opinion on these pre-computed fraud signals. ' +
          'You are advisory only and never the authority to block or approve. Keys: ' +
          '"risk_level" ("LOW"|"MEDIUM"|"HIGH"), "reasoning_summary" (2-3 sentences on why it ' +
          'does or does not look unusual), "risk_factors" (array of short phrases), ' +
          '"recommended_action" (one sentence, e.g. require additional verification).',
        input,
        fraudSchema,
        500
      );
      return {
        result: {
          source: 'ai',
          model,
          risk_level: parsed.risk_level,
          reasoning_summary: clean(parsed.reasoning_summary, 700),
          risk_factors: cleanList(parsed.risk_factors, 8, 200),
          recommended_action: clean(parsed.recommended_action, 300),
        },
        meta: metaOk('ai_fraud', model, usage, duration_ms),
      };
    } catch (err) {
      return { result: fraudFallback(input), meta: metaErr('ai_fraud', err) };
    }
  },

  /** Feature 3: narrate already-computed financial totals. */
  async summarizeFinances(
    input: SummarizeInput
  ): Promise<{ result: SummaryResult; meta: CallMeta }> {
    if (!aiConfigured()) return { result: summaryFallback(input), meta: metaDisabled() };
    try {
      const { parsed, model, usage, duration_ms } = await call(
        'summary',
        'Summarise this already-calculated financial activity. Do NOT recompute or add ' +
          'numbers. Keys: "headline" (one line), "observations" (array of 2-4 short factual ' +
          'sentences grounded only in the given figures), "spending_note" (one sentence ' +
          'observation about spending patterns, no advice, no unsupported claims).',
        input,
        summarySchema,
        500
      );
      return {
        result: {
          source: 'ai',
          model,
          headline: clean(parsed.headline, 240),
          observations: cleanList(parsed.observations, 6, 300),
          spending_note: clean(parsed.spending_note, 400),
        },
        meta: metaOk('ai_summary', model, usage, duration_ms),
      };
    } catch (err) {
      return { result: summaryFallback(input), meta: metaErr('ai_summary', err) };
    }
  },
};

// --------------------------------------------------------------------------
// call metadata (for safe telemetry by the caller)
// --------------------------------------------------------------------------

export interface CallMeta {
  outcome: 'ok' | 'fallback' | 'error';
  model: string | null;
  errorCode: string | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
}

function metaOk(
  _feature: string,
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number },
  durationMs: number
): CallMeta {
  return {
    outcome: 'ok',
    model,
    errorCode: null,
    durationMs,
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
  };
}

function metaDisabled(): CallMeta {
  return { outcome: 'fallback', model: null, errorCode: 'AI_DISABLED', durationMs: null, promptTokens: null, completionTokens: null };
}

function metaErr(_feature: string, err: unknown): CallMeta {
  const code = err instanceof AIError ? err.code : 'AI_UNKNOWN';
  return { outcome: 'error', model: null, errorCode: code, durationMs: null, promptTokens: null, completionTokens: null };
}

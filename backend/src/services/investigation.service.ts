import { pool } from '../config/database';
import { logger } from '../utils/logger';
import { TransferService } from './transfer.service';
import { AIService, type InvestigateInput } from './ai/aiService';
import {
  hashInput,
  readInsight,
  writeInsight,
  logAiRequest,
} from './ai/insightCache';

/**
 * Feature 1 — AI Transaction Investigator.
 *
 * Answers "What happened to my money?" for a transaction the caller is a party
 * to. The deterministic pipeline is the authority:
 *   1. `TransferService.getForUser` enforces authorisation (throws if not a party).
 *   2. `TransferService.verify` reconciles against the immutable ledger and
 *      returns the definitive `outcome` + timeline. It is idempotent and never
 *      moves money.
 *   3. Only then do we hand a small, sanitised structured summary to the AI for a
 *      human-readable explanation. The AI cannot change status, balances, or the
 *      `outcome` — that value is forced from the ledger result.
 */

const EVENT_STEP_NOTE = (event: string, detail: Record<string, unknown>): string | undefined => {
  if (event === 'FAILED' && typeof detail.reason === 'string') return detail.reason;
  if (event === 'VERIFIED' && typeof detail.outcome === 'string') return `outcome: ${detail.outcome}`;
  if (event === 'INITIATED' && detail.retry) return 'retry attempt';
  return undefined;
};

async function fraudContext(transferId: string): Promise<InvestigateInput['fraud']> {
  try {
    const { rows } = await pool.query(
      `SELECT band, score, reasons
         FROM transfer_risk_assessments
        WHERE transfer_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [transferId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    const reasons: string[] = Array.isArray(r.reasons)
      ? r.reasons.map((x: any) => String(x.label ?? x.code ?? '')).filter(Boolean).slice(0, 6)
      : [];
    return { band: String(r.band), score: Number(r.score), reasons };
  } catch (err) {
    logger.error('fraud context lookup failed', err, { transferId });
    return null;
  }
}

export const InvestigationService = {
  async investigate(idOrReference: string, userId: string) {
    // (1) authorise + (2) reconcile against the ledger (idempotent, no money moves)
    const verify = await TransferService.verify(idOrReference, userId);
    const t = verify.transfer;

    const structured: InvestigateInput = {
      reference: t.reference,
      direction: t.direction === 'SENT' ? 'SENT' : 'RECEIVED',
      amount_bdt: t.amount_bdt,
      status: t.status,
      outcome: verify.outcome,
      attempt_count: t.attempt_count ?? 1,
      created_at: new Date(t.created_at).toISOString(),
      counterparty_name: t.counterparty?.full_name ?? 'the other party',
      timeline: verify.timeline.map((e, i) => ({
        step: i + 1,
        state: e.state,
        event: e.event,
        at: new Date(e.created_at).toISOString(),
        note: EVENT_STEP_NOTE(e.event, e.detail || {}),
      })),
      reconciliation: {
        ledger_entry_count: verify.reconciliation.ledger_entry_count,
        money_moved: verify.reconciliation.money_moved,
        net_ledger_paisa: verify.reconciliation.net_ledger_paisa,
        snapshot_consistent: verify.reconciliation.snapshot_consistent,
      },
      fraud: await fraudContext(t.transfer_id),
    };

    const inputHash = hashInput(structured);
    const cached = await readInsight<Awaited<ReturnType<typeof AIService.investigateTransfer>>['result']>(
      'TRANSFER_INVESTIGATION',
      t.reference,
      inputHash
    );

    let ai;
    if (cached) {
      ai = cached.result;
      await logAiRequest({ feature: 'ai_investigate', userId, model: cached.model, outcome: 'cache' });
    } else {
      const { result, meta } = await AIService.investigateTransfer(structured);
      ai = result;
      await writeInsight('TRANSFER_INVESTIGATION', t.reference, inputHash, result, result.source, result.model);
      await logAiRequest({
        feature: 'ai_investigate',
        userId,
        model: meta.model,
        outcome: meta.outcome,
        errorCode: meta.errorCode,
        durationMs: meta.durationMs,
        promptTokens: meta.promptTokens,
        completionTokens: meta.completionTokens,
      });
    }

    return {
      transfer: verify.transfer,
      outcome: verify.outcome, // authoritative (from the ledger)
      reconciliation: verify.reconciliation,
      timeline: verify.timeline,
      ai: {
        available: AIService.enabled,
        source: ai.source,
        model: ai.model,
        summary: ai.summary,
        timeline_explained: ai.timeline_explained,
        money_status: ai.money_status,
        what_this_means: ai.what_this_means,
      },
    };
  },
};

import { pool } from '../config/database';
import { paisaToBdtString } from '../utils/money';
import { categorise, type SpendCategory } from '../utils/category';
import { AIService, type SummarizeInput } from './ai/aiService';
import {
  hashInput,
  readInsight,
  writeInsight,
  logAiRequest,
} from './ai/insightCache';

/**
 * Feature 3 — Smart Financial Summaries.
 *
 * Every total, category split and period-over-period delta is computed here from
 * authoritative `transfers` / ledger data with plain SQL + a deterministic
 * categoriser. The AI is handed ONLY these finished numbers and asked to narrate
 * them — it never sums, recomputes, or invents figures.
 */

export type Period = 'weekly' | 'monthly';

interface Range {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  label: string;
}

function computeRange(period: Period): Range {
  const now = new Date();
  if (period === 'weekly') {
    const to = now;
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevTo = from;
    const prevFrom = new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from, to, prevFrom, prevTo, label: 'last 7 days' };
  }
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = now;
  const prevFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevTo = from;
  return { from, to, prevFrom, prevTo, label: 'this month' };
}

async function sumPaisa(sql: string, params: any[]): Promise<bigint> {
  const { rows } = await pool.query(sql, params);
  return BigInt(rows[0]?.total ?? 0);
}

export const SummaryService = {
  async financialSummary(userId: string, period: Period) {
    const r = computeRange(period);

    // ---- deterministic totals (authoritative) --------------------------------
    const COMPLETED = `status = 'COMPLETED'`;
    const [sentPaisa, recvPaisa, prevSentPaisa, sentCountRow, recvCountRow, sentRows] =
      await Promise.all([
        sumPaisa(
          `SELECT COALESCE(SUM(amount_paisa), 0)::text AS total FROM transfers
            WHERE sender_id = $1 AND ${COMPLETED} AND created_at >= $2 AND created_at < $3`,
          [userId, r.from, r.to]
        ),
        sumPaisa(
          `SELECT COALESCE(SUM(amount_paisa), 0)::text AS total FROM transfers
            WHERE receiver_id = $1 AND ${COMPLETED} AND created_at >= $2 AND created_at < $3`,
          [userId, r.from, r.to]
        ),
        sumPaisa(
          `SELECT COALESCE(SUM(amount_paisa), 0)::text AS total FROM transfers
            WHERE sender_id = $1 AND ${COMPLETED} AND created_at >= $2 AND created_at < $3`,
          [userId, r.prevFrom, r.prevTo]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS c FROM transfers
            WHERE sender_id = $1 AND ${COMPLETED} AND created_at >= $2 AND created_at < $3`,
          [userId, r.from, r.to]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS c FROM transfers
            WHERE receiver_id = $1 AND ${COMPLETED} AND created_at >= $2 AND created_at < $3`,
          [userId, r.from, r.to]
        ),
        pool.query<{ note: string | null; amount_paisa: bigint; type: string }>(
          `SELECT note, amount_paisa, type FROM transfers
            WHERE sender_id = $1 AND ${COMPLETED} AND created_at >= $2 AND created_at < $3`,
          [userId, r.from, r.to]
        ),
      ]);

    const netPaisa = recvPaisa - sentPaisa;

    // ---- deterministic category split (rule-based, not AI) -------------------
    const buckets = new Map<SpendCategory, bigint>();
    for (const row of sentRows.rows) {
      const cat = row.type === 'STIPEND' ? 'Family & Friends' : categorise(row.note);
      buckets.set(cat, (buckets.get(cat) ?? 0n) + BigInt(row.amount_paisa));
    }
    const categories = [...buckets.entries()]
      .map(([name, paisa]) => ({ name, amount_paisa: paisa }))
      .sort((a, b) => (b.amount_paisa > a.amount_paisa ? 1 : b.amount_paisa < a.amount_paisa ? -1 : 0));
    const top = categories.find((c) => c.name !== 'Uncategorised') ?? categories[0] ?? null;

    const changePct =
      prevSentPaisa > 0n
        ? Math.round((Number(sentPaisa - prevSentPaisa) / Number(prevSentPaisa)) * 100)
        : sentPaisa > 0n
          ? 100
          : 0;

    const deterministic = {
      period,
      range: {
        from: r.from.toISOString(),
        to: r.to.toISOString(),
        label: r.label,
      },
      totals: {
        sent_bdt: paisaToBdtString(sentPaisa),
        received_bdt: paisaToBdtString(recvPaisa),
        net_bdt: paisaToBdtString(netPaisa),
      },
      top_category: top
        ? { name: top.name, amount_bdt: paisaToBdtString(top.amount_paisa) }
        : null,
      categories: categories.map((c) => ({
        name: c.name,
        amount_bdt: paisaToBdtString(c.amount_paisa),
      })),
      comparison:
        prevSentPaisa > 0n || sentPaisa > 0n
          ? { previous_sent_bdt: paisaToBdtString(prevSentPaisa), change_pct: changePct }
          : null,
      counts: { sent: sentCountRow.rows[0].c as number, received: recvCountRow.rows[0].c as number },
    };

    // ---- AI narration (cached; advisory only) -------------------------------
    const aiInput: SummarizeInput = {
      period,
      range: { from: deterministic.range.from, to: deterministic.range.to },
      totals: deterministic.totals,
      top_category: deterministic.top_category,
      categories: deterministic.categories,
      comparison: deterministic.comparison,
      counts: deterministic.counts,
    };
    const subject = `${userId}:${period}:${r.from.toISOString().slice(0, 10)}`;
    const inputHash = hashInput(aiInput);
    const cached = await readInsight<Awaited<ReturnType<typeof AIService.summarizeFinances>>['result']>(
      'FINANCIAL_SUMMARY',
      subject,
      inputHash
    );

    let ai;
    if (cached) {
      ai = cached.result;
      await logAiRequest({ feature: 'ai_summary', userId, model: cached.model, outcome: 'cache' });
    } else {
      const { result, meta } = await AIService.summarizeFinances(aiInput);
      ai = result;
      await writeInsight('FINANCIAL_SUMMARY', subject, inputHash, result, result.source, result.model);
      await logAiRequest({
        feature: 'ai_summary',
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
      ...deterministic,
      ai: {
        available: AIService.enabled,
        source: ai.source,
        model: ai.model,
        headline: ai.headline,
        observations: ai.observations,
        spending_note: ai.spending_note,
      },
    };
  },
};

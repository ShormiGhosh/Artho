import crypto from 'crypto';
import { pool } from '../../config/database';
import { logger } from '../../utils/logger';

/**
 * Cache for AI insights, keyed by a hash of the exact structured input. An
 * identical request inside the TTL is served from Postgres — no OpenAI call,
 * no cost. `fallback` rows (produced while the API was unavailable) get a short
 * TTL so we retry the model soon; real `ai` rows get the full TTL.
 */

export type InsightKind =
  | 'TRANSFER_INVESTIGATION'
  | 'FINANCIAL_SUMMARY'
  | 'FRAUD_ANALYSIS';

export function hashInput(input: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))
    .digest('hex');
}

export interface CachedInsight<T = Record<string, unknown>> {
  result: T;
  source: 'ai' | 'fallback';
  model: string | null;
  created_at: Date;
}

export async function readInsight<T>(
  kind: InsightKind,
  subject: string,
  inputHash: string
): Promise<CachedInsight<T> | null> {
  try {
    const { rows } = await pool.query(
      `SELECT result, source, model, created_at
         FROM ai_insights
        WHERE kind = $1 AND subject = $2 AND input_hash = $3 AND expires_at > NOW()
        LIMIT 1`,
      [kind, subject, inputHash]
    );
    return rows[0] ?? null;
  } catch (err) {
    logger.error('ai insight cache read failed', err, { kind });
    return null;
  }
}

export async function writeInsight(
  kind: InsightKind,
  subject: string,
  inputHash: string,
  result: unknown,
  source: 'ai' | 'fallback',
  model: string | null
): Promise<void> {
  const ttlSeconds =
    source === 'fallback'
      ? 120
      : kind === 'FINANCIAL_SUMMARY'
        ? 6 * 60 * 60
        : 24 * 60 * 60;
  try {
    await pool.query(
      `INSERT INTO ai_insights (kind, subject, input_hash, result, source, model, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW() + ($7 || ' seconds')::interval)
       ON CONFLICT (kind, subject, input_hash)
       DO UPDATE SET result = EXCLUDED.result, source = EXCLUDED.source,
                     model = EXCLUDED.model, created_at = NOW(),
                     expires_at = EXCLUDED.expires_at`,
      [kind, subject, inputHash, JSON.stringify(result), source, model, String(ttlSeconds)]
    );
  } catch (err) {
    logger.error('ai insight cache write failed', err, { kind });
  }
}

/** Safe, content-free telemetry row. Never stores prompts, output or secrets. */
export async function logAiRequest(entry: {
  feature: string;
  userId?: string | null;
  model?: string | null;
  outcome: 'ok' | 'fallback' | 'error' | 'cache';
  errorCode?: string | null;
  durationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO ai_request_log
         (feature, user_id, model, outcome, error_code, duration_ms, prompt_tokens, completion_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.feature,
        entry.userId ?? null,
        entry.model ?? null,
        entry.outcome,
        entry.errorCode ?? null,
        entry.durationMs ?? null,
        entry.promptTokens ?? null,
        entry.completionTokens ?? null,
      ]
    );
  } catch (err) {
    logger.error('ai request log write failed', err, { feature: entry.feature });
  }
}

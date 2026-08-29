import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { pool } from '../config/database';
import { IDEMPOTENCY_TTL_HOURS } from '../config/constants';
import { Errors } from '../utils/errors';
import { logger } from '../utils/logger';

function fingerprint(req: Request): string {
  const body = JSON.stringify(req.body ?? {});
  return crypto
    .createHash('sha256')
    .update(`${req.method}:${req.baseUrl}${req.path}:${body}`)
    .digest('hex');
}

/**
 * Enforces exactly-once semantics for unsafe money operations.
 *
 * - First time a (user, key) pair is seen: inserts a PROCESSING row and lets the
 *   handler run. res.json is wrapped so the final status + body are persisted.
 * - Replay of a COMPLETED key: the stored response is returned verbatim, the
 *   handler never runs, so no second debit happens.
 * - Same key with a different request body: 409 (key reuse).
 * - Key still PROCESSING (concurrent double-submit): 409, client should poll.
 * - Previously FAILED (5xx) or a stale PROCESSING row: reclaimed and retried.
 */
export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const key = req.header('idempotency-key');
  if (!key || key.trim().length === 0 || key.length > 255) {
    return next(Errors.missingIdempotencyKey());
  }
  const userId = req.userId!;
  const fp = fingerprint(req);
  const endpoint = `${req.method} ${req.baseUrl}${req.route?.path ?? req.path}`;

  try {
    const inserted = await pool.query(
      `INSERT INTO idempotency_records
         (user_id, idempotency_key, endpoint, request_fingerprint, status, expires_at)
       VALUES ($1, $2, $3, $4, 'PROCESSING', NOW() + ($5 || ' hours')::interval)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [userId, key, endpoint, fp, String(IDEMPOTENCY_TTL_HOURS)]
    );

    if (inserted.rowCount === 0) {
      const existing = await pool.query(
        `SELECT id, request_fingerprint, status, response_status, response_payload,
                created_at
           FROM idempotency_records
          WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, key]
      );
      const row = existing.rows[0];

      if (row.request_fingerprint !== fp) {
        return next(Errors.idempotencyConflict());
      }

      if (row.status === 'COMPLETED') {
        res
          .status(row.response_status ?? 200)
          .set('Idempotent-Replay', 'true')
          .json(row.response_payload);
        return;
      }

      const staleMs = Date.now() - new Date(row.created_at).getTime();
      if (row.status === 'FAILED' || staleMs > 2 * 60 * 1000) {
        await pool.query(
          `UPDATE idempotency_records
              SET status = 'PROCESSING', response_status = NULL,
                  response_payload = NULL, created_at = NOW()
            WHERE id = $1`,
          [row.id]
        );
      } else {
        return next(Errors.idempotencyInProgress());
      }
    }
  } catch (err) {
    return next(err);
  }

  // Persist the outcome the first time this request actually runs.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    const status = res.statusCode || 200;
    const finalize =
      status >= 500
        ? pool.query(
            `DELETE FROM idempotency_records WHERE user_id = $1 AND idempotency_key = $2`,
            [userId, key]
          )
        : pool.query(
            `UPDATE idempotency_records
                SET status = 'COMPLETED', response_status = $3, response_payload = $4
              WHERE user_id = $1 AND idempotency_key = $2`,
            [userId, key, status, JSON.stringify(body)]
          );
    finalize.catch((e) =>
      logger.error('idempotency finalize failed', e, { requestId: req.requestId })
    );
    return originalJson(body);
  };

  req.idempotencyKey = key;
  next();
}

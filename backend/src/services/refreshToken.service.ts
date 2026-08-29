import { v4 as uuidv4 } from 'uuid';
import { pool, withSerializableTransaction } from '../config/database';
import { env } from '../config/env';
import { randomToken, sha256Hex } from '../utils/crypto';
import { logger } from '../utils/logger';
import { SecurityService } from './security.service';
import { NotificationService } from './notification.service';

/**
 * Rotating refresh tokens with reuse detection.
 *
 * A "family" is one continuous chain of rotations starting at a single
 * login/register. Every successful `POST /auth/refresh` retires the presented
 * token (marks it ROTATED) and issues a brand-new one in the same family — the
 * old token can never be used again. If it IS presented again (status already
 * ROTATED or REVOKED), that can only mean a stale copy is floating around
 * (client retry) or has been stolen; either way we cannot tell them apart
 * safely, so the entire family is revoked and the user is signed out
 * everywhere, exactly the reuse-detection behaviour the name implies.
 *
 * Only a SHA-256 hash of the opaque token is ever stored — the raw value lives
 * only in the httpOnly cookie and in memory for the duration of one request.
 */

interface TokenRow {
  id: string;
  user_id: string;
  family_id: string;
  status: 'ACTIVE' | 'ROTATED' | 'REVOKED';
  expires_at: string;
}

export interface IssuedPair {
  raw: string;
  id: string;
  familyId: string;
  expiresAt: Date;
}

export type RotateResult =
  | { ok: true; userId: string; pair: IssuedPair }
  | { ok: false; error: 'INVALID' | 'EXPIRED' | 'REUSED' };

interface Ctx {
  ipHash?: string | null;
  uaHash?: string | null;
}

export const RefreshTokenService = {
  /** Issue a brand-new token, optionally continuing an existing family. */
  async issue(userId: string, familyId: string | null, ctx: Ctx = {}): Promise<IssuedPair> {
    const family = familyId ?? uuidv4();
    const raw = randomToken(32);
    const hash = sha256Hex(raw);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, ip_hash, user_agent_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, family, hash, ctx.ipHash ?? null, ctx.uaHash ?? null, expiresAt]
    );
    return { raw, id: rows[0].id, familyId: family, expiresAt };
  },

  /** Exchange a presented raw refresh token for a new access+refresh pair. */
  async rotate(rawToken: string, ctx: Ctx = {}): Promise<RotateResult> {
    const hash = sha256Hex(rawToken);
    const { rows } = await pool.query<TokenRow>(
      `SELECT id, user_id, family_id, status, expires_at FROM refresh_tokens WHERE token_hash = $1`,
      [hash]
    );
    const row = rows[0];
    if (!row) return { ok: false, error: 'INVALID' };

    if (row.status !== 'ACTIVE') {
      // A dead token being presented again = reuse. Assume compromise.
      await this.revokeFamily(row.family_id, 'REUSE_DETECTED');
      await SecurityService.logEvent({
        userId: row.user_id,
        type: 'REFRESH_TOKEN_REUSE_DETECTED',
        severity: 'HIGH',
        ipHash: ctx.ipHash ?? null,
        uaHash: ctx.uaHash ?? null,
        detail: { family_id: row.family_id, presented_status: row.status },
      });
      logger.warn('refresh token reuse detected — family revoked', {
        userId: row.user_id,
        familyId: row.family_id,
      });
      NotificationService.emit({
        userId: row.user_id,
        type: 'SECURITY_ALERT',
        title: 'Suspicious sign-in activity',
        message:
          'We detected reuse of an old session token and signed you out everywhere as a precaution. Please log in again.',
      });
      return { ok: false, error: 'REUSED' };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, error: 'EXPIRED' };
    }

    // Legitimate rotation: retire this token and mint the next one in the same
    // family, atomically — a crash between the two must not leave a live token
    // that reuse-detection can no longer catch.
    const pair = await withSerializableTransaction(async (client) => {
      const newRaw = randomToken(32);
      const newHash = sha256Hex(newRaw);
      const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, ip_hash, user_agent_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [row.user_id, row.family_id, newHash, ctx.ipHash ?? null, ctx.uaHash ?? null, expiresAt]
      );
      await client.query(
        `UPDATE refresh_tokens SET status = 'ROTATED', rotated_at = NOW(), replaced_by = $2
          WHERE id = $1`,
        [row.id, ins.rows[0].id]
      );
      return { raw: newRaw, id: ins.rows[0].id, familyId: row.family_id, expiresAt };
    });

    return { ok: true, userId: row.user_id, pair };
  },

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens SET status = 'REVOKED', revoked_at = NOW(), revoked_reason = $2
        WHERE family_id = $1 AND status <> 'REVOKED'`,
      [familyId, reason]
    );
  },

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens SET status = 'REVOKED', revoked_at = NOW(), revoked_reason = $2
        WHERE user_id = $1 AND status <> 'REVOKED'`,
      [userId, reason]
    );
  },

  /** Used by logout: kill just the session (family) this token belongs to. */
  async revokeByRawToken(rawToken: string, reason: string): Promise<void> {
    const hash = sha256Hex(rawToken);
    const { rows } = await pool.query<{ family_id: string }>(
      `SELECT family_id FROM refresh_tokens WHERE token_hash = $1`,
      [hash]
    );
    if (rows[0]) await this.revokeFamily(rows[0].family_id, reason);
  },
};

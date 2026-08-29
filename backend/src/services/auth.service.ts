import bcrypt from 'bcryptjs';
import { pool, withSerializableTransaction } from '../config/database';
import {
  INITIAL_BALANCE_PAISA,
  INSTITUTION_INITIAL_BALANCE_PAISA,
  NID_REGEX,
  PHONE_REGEX,
  normalizePhoneBD,
} from '../config/constants';
import { env, exposeDevVerificationCode } from '../config/env';
import { signToken } from '../middleware/auth';
import { AppError, Errors } from '../utils/errors';
import { paisaToBdtString } from '../utils/money';
import {
  blindIndex,
  decryptField,
  encryptField,
  maskNid,
  randomNumericCode,
  sha256Hex,
} from '../utils/crypto';
import { logger } from '../utils/logger';
import { SecurityService } from './security.service';
import { RefreshTokenService, type IssuedPair } from './refreshToken.service';
import { EmailService } from './email/emailService';

const BCRYPT_ROUNDS = 10;

export type UserRole = 'USER' | 'INSTITUTION' | 'ADMIN';
export interface AuthContext {
  ipHash?: string | null;
  uaHash?: string | null;
}

function nidCiphertext(nid: string): { enc: string; bidx: string } {
  return { enc: encryptField(nid), bidx: blindIndex(nid) };
}

/** Shapes the pair of tokens a login/register/refresh returns to the route,
 *  which is the one that actually sets the httpOnly cookie. */
function tokenBundle(userId: string, refresh: IssuedPair) {
  return {
    token: signToken(userId),
    token_expires_in: env.JWT_EXPIRATION,
    refresh,
  };
}

async function issueVerificationCode(
  userId: string,
  email: string,
  purpose: 'REGISTER' | 'RESEND'
): Promise<{ dev_code?: string }> {
  const code = randomNumericCode(6);
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL_MINUTES * 60_000);
  await pool.query(
    `INSERT INTO email_verifications (user_id, code_hash, expires_at, max_attempts)
     VALUES ($1, $2, $3, $4)`,
    [userId, sha256Hex(code), expiresAt, env.EMAIL_VERIFICATION_MAX_ATTEMPTS]
  );
  const { delivered } = await EmailService.sendVerificationCode(email, code, { purpose });
  logger.info('verification code issued', { userId, purpose, delivered });
  // Dev/test convenience only — see exposeDevVerificationCode(). Never active
  // in production, and only meaningful when nothing actually emailed it.
  return !delivered && exposeDevVerificationCode() ? { dev_code: code } : {};
}

export const AuthService = {
  async register(
    input: {
      email: string;
      password: string;
      full_name: string;
      phone: string;
      role?: UserRole;
      nid?: string | null;
    },
    ctx: AuthContext = {}
  ) {
    const email = input.email.trim().toLowerCase();
    const fullName = input.full_name.trim();
    const role: UserRole = input.role === 'INSTITUTION' ? 'INSTITUTION' : 'USER';
    const nid = input.nid?.trim() || null;

    if (input.password.length < 8) throw Errors.weakPassword();
    if (nid && !NID_REGEX.test(nid)) {
      throw Errors.invalidRequest('NID must be 10, 13 or 17 digits');
    }
    const phoneRaw = input.phone?.trim();
    if (!phoneRaw || !PHONE_REGEX.test(phoneRaw)) {
      throw Errors.invalidRequest('Enter a valid Bangladeshi phone number, e.g. 01712345678');
    }
    const phone = normalizePhoneBD(phoneRaw);

    const existing = await pool.query(
      'SELECT email, phone FROM users WHERE email = $1 OR phone = $2',
      [email, phone]
    );
    if (existing.rows.some((r) => r.email === email)) throw Errors.emailTaken();
    if (existing.rows.some((r) => r.phone === phone)) {
      throw new AppError('PHONE_ALREADY_REGISTERED', 'That phone number is already registered', 409);
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const opening =
      role === 'INSTITUTION' ? INSTITUTION_INITIAL_BALANCE_PAISA : INITIAL_BALANCE_PAISA;
    const nidCols = nid ? nidCiphertext(nid) : { enc: null, bidx: null };

    const userId = await withSerializableTransaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name, phone, role, nid_enc, nid_bidx,
                             account_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING_VERIFICATION')
         RETURNING id`,
        [email, passwordHash, fullName, phone, role, nidCols.enc, nidCols.bidx]
      );
      const id = user.rows[0].id;

      await client.query(`INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, $2)`, [
        id,
        opening.toString(),
      ]);
      await client.query(
        `INSERT INTO ledger_entries (user_id, amount_paisa, balance_after, transfer_id, entry_type)
         VALUES ($1, $2, $2, NULL, 'INITIAL_FUNDING')`,
        [id, opening.toString()]
      );
      return id;
    });

    logger.info('user registered', { userId, email, phone, role });
    if (ctx.ipHash && ctx.uaHash) {
      await SecurityService.touchSession(userId, ctx.ipHash, ctx.uaHash).catch(() => undefined);
    }
    await SecurityService.logEvent({
      userId,
      type: 'ACCOUNT_CREATED',
      severity: 'INFO',
      ipHash: ctx.ipHash ?? null,
      uaHash: ctx.uaHash ?? null,
    });

    const dev = await issueVerificationCode(userId, email, 'REGISTER');
    const refresh = await RefreshTokenService.issue(userId, null, ctx);

    return {
      user_id: userId,
      email,
      phone,
      full_name: fullName,
      role,
      nid: maskNid(nid),
      account_status: 'PENDING_VERIFICATION' as const,
      ...tokenBundle(userId, refresh),
      verification: {
        required: true,
        channel: 'email' as const,
        expires_in_minutes: env.EMAIL_VERIFICATION_TTL_MINUTES,
        ...dev,
      },
      wallet: {
        balance_paisa: opening.toString(),
        balance_bdt: paisaToBdtString(opening),
        currency: 'BDT',
      },
    };
  },

  async login(input: { email: string; password: string }, ctx: AuthContext = {}) {
    const email = input.email.trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, password_hash, full_name, account_status, role
         FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];

    // PENDING_VERIFICATION may still log in (they need to reach the verify
    // screen); SUSPENDED/CLOSED may not.
    if (!user || !['ACTIVE', 'PENDING_VERIFICATION'].includes(user.account_status)) {
      await SecurityService.recordLoginOutcome({
        userId: user?.id ?? null,
        email,
        success: false,
        ipHash: ctx.ipHash ?? null,
        uaHash: ctx.uaHash ?? null,
      });
      throw Errors.invalidCredentials();
    }

    // Temporary lockout after repeated failures — never a permanent ban.
    const lock = await SecurityService.loginLockState(user.id);
    if (lock.locked) {
      await SecurityService.recordLoginOutcome({
        userId: user.id,
        email,
        success: false,
        ipHash: ctx.ipHash ?? null,
        uaHash: ctx.uaHash ?? null,
      });
      throw new AppError(
        'ACCOUNT_TEMPORARILY_LOCKED',
        `Too many failed attempts. Try again in about ${Math.ceil(lock.retry_after_s / 60)} minute(s).`,
        429,
        { retry_after_s: lock.retry_after_s }
      );
    }

    const passwordOk = await bcrypt.compare(input.password, user.password_hash);
    await SecurityService.recordLoginOutcome({
      userId: user.id,
      email,
      success: passwordOk,
      ipHash: ctx.ipHash ?? null,
      uaHash: ctx.uaHash ?? null,
    });
    if (!passwordOk) throw Errors.invalidCredentials();

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    logger.info('user login', { userId: user.id });

    const refresh = await RefreshTokenService.issue(user.id, null, ctx);

    return {
      user_id: user.id,
      full_name: user.full_name,
      role: user.role as UserRole,
      account_status: user.account_status as 'ACTIVE' | 'PENDING_VERIFICATION',
      ...tokenBundle(user.id, refresh),
    };
  },

  /** Exchange a refresh token (from the httpOnly cookie) for a new access token
   *  + a fresh, rotated refresh token. Reuse of an already-rotated/revoked
   *  token revokes the whole session family — see RefreshTokenService. */
  async refreshSession(rawToken: string, ctx: AuthContext = {}) {
    const result = await RefreshTokenService.rotate(rawToken, ctx);
    if (!result.ok) {
      const messages: Record<typeof result.error, string> = {
        INVALID: 'Session not recognised. Please log in again.',
        EXPIRED: 'Your session has expired. Please log in again.',
        REUSED: 'Unusual activity was detected on this session. Please log in again.',
      };
      throw new AppError('REFRESH_TOKEN_' + result.error, messages[result.error], 401);
    }
    return {
      token: signToken(result.userId),
      token_expires_in: env.JWT_EXPIRATION,
      refresh: result.pair,
    };
  },

  async logout(rawToken: string | null): Promise<void> {
    if (!rawToken) return;
    await RefreshTokenService.revokeByRawToken(rawToken, 'LOGOUT').catch((e) =>
      logger.error('logout revoke failed', e)
    );
  },

  async verifyEmail(userId: string, code: string) {
    const { rows } = await pool.query(
      `SELECT id, code_hash, attempt_count, max_attempts, expires_at, consumed_at
         FROM email_verifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    const row = rows[0];
    if (!row || row.consumed_at || new Date(row.expires_at).getTime() < Date.now()) {
      throw new AppError(
        'VERIFICATION_CODE_EXPIRED',
        'That code has expired. Request a new one.',
        410
      );
    }
    if (row.attempt_count >= row.max_attempts) {
      throw new AppError(
        'VERIFICATION_CODE_LOCKED',
        'Too many incorrect attempts. Request a new code.',
        429
      );
    }

    if (sha256Hex(code.trim()) !== row.code_hash) {
      await pool.query(
        `UPDATE email_verifications SET attempt_count = attempt_count + 1 WHERE id = $1`,
        [row.id]
      );
      throw new AppError('INVALID_VERIFICATION_CODE', 'That code is incorrect', 400, {
        attempts_remaining: Math.max(0, row.max_attempts - (row.attempt_count + 1)),
      });
    }

    await withSerializableTransaction(async (client) => {
      await client.query(`UPDATE email_verifications SET consumed_at = NOW() WHERE id = $1`, [
        row.id,
      ]);
      await client.query(
        `UPDATE users SET account_status = 'ACTIVE', email_verified_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND account_status = 'PENDING_VERIFICATION'`,
        [userId]
      );
    });

    await SecurityService.logEvent({ userId, type: 'EMAIL_VERIFIED', severity: 'INFO' });
    logger.info('email verified', { userId });
    return this.profile(userId);
  },

  async resendVerification(userId: string) {
    const { rows } = await pool.query(
      `SELECT email, account_status FROM users WHERE id = $1`,
      [userId]
    );
    if (rows.length === 0) throw Errors.userNotFound();
    if (rows[0].account_status === 'ACTIVE') {
      return { already_verified: true as const };
    }

    const last = await pool.query<{ created_at: string }>(
      `SELECT created_at FROM email_verifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (last.rows[0]) {
      const elapsedS = (Date.now() - new Date(last.rows[0].created_at).getTime()) / 1000;
      const remaining = env.EMAIL_VERIFICATION_RESEND_COOLDOWN_S - elapsedS;
      if (remaining > 0) {
        throw new AppError(
          'VERIFICATION_RESEND_TOO_SOON',
          `Please wait ${Math.ceil(remaining)}s before requesting another code.`,
          429,
          { retry_after_s: Math.ceil(remaining) }
        );
      }
    }

    const dev = await issueVerificationCode(userId, rows[0].email, 'RESEND');
    return {
      already_verified: false as const,
      expires_in_minutes: env.EMAIL_VERIFICATION_TTL_MINUTES,
      ...dev,
    };
  },

  async profile(userId: string) {
    const { rows } = await pool.query(
      `SELECT id, email, phone, full_name, account_status, role, nid_enc, created_at, last_login_at
         FROM users WHERE id = $1`,
      [userId]
    );
    if (rows.length === 0) throw Errors.userNotFound();
    const u = rows[0];
    const nidPlain = decryptField(u.nid_enc);
    return {
      user_id: u.id,
      email: u.email,
      phone: u.phone,
      full_name: u.full_name,
      account_status: u.account_status,
      role: u.role,
      nid: maskNid(nidPlain), // masked — full value is never returned
      has_nid: !!nidPlain,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    };
  },

  async updateProfile(userId: string, input: { full_name?: string; nid?: string | null }) {
    const sets: string[] = [];
    const params: any[] = [];

    if (input.full_name !== undefined) {
      const name = input.full_name.trim();
      if (name.length < 1) throw Errors.invalidRequest('Name cannot be empty');
      params.push(name);
      sets.push(`full_name = $${params.length}`);
    }
    if (input.nid !== undefined) {
      const nid = input.nid?.trim() || null;
      if (nid && !NID_REGEX.test(nid)) {
        throw Errors.invalidRequest('NID must be 10, 13 or 17 digits');
      }
      const cols = nid ? nidCiphertext(nid) : { enc: null, bidx: null };
      params.push(cols.enc);
      sets.push(`nid_enc = $${params.length}`);
      params.push(cols.bidx);
      sets.push(`nid_bidx = $${params.length}`);
    }
    if (sets.length === 0) return this.profile(userId);

    params.push(userId);
    await pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params
    );
    logger.info('profile updated', { userId });
    return this.profile(userId);
  },

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: AuthContext = {}
  ) {
    if (newPassword.length < 8) throw Errors.weakPassword();
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) throw Errors.userNotFound();

    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) throw Errors.invalidCredentials();

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query(
      `UPDATE users SET password_hash = $1, password_changed_at = NOW(), updated_at = NOW()
        WHERE id = $2`,
      [hash, userId]
    );
    // Kill every access token (via password_changed_at, checked in requireAuth)
    // AND every refresh token family — otherwise a stolen refresh token could
    // keep minting fresh access tokens after the "safety" password change.
    await RefreshTokenService.revokeAllForUser(userId, 'PASSWORD_CHANGED').catch((e) =>
      logger.error('refresh token revoke-all failed', e, { userId })
    );
    await SecurityService.logEvent({
      userId,
      type: 'PASSWORD_CHANGED',
      severity: 'LOW',
      ipHash: ctx.ipHash ?? null,
      uaHash: ctx.uaHash ?? null,
    });
    logger.info('password changed', { userId });
  },
};

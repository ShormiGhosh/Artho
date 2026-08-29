import bcrypt from 'bcryptjs';
import { pool, withSerializableTransaction } from '../config/database';
import { INITIAL_BALANCE_PAISA } from '../config/constants';
import { signToken } from '../middleware/auth';
import { Errors } from '../utils/errors';
import { paisaToBdtString } from '../utils/money';
import { logger } from '../utils/logger';

const BCRYPT_ROUNDS = 10;

export const AuthService = {
  async register(input: { email: string; password: string; full_name: string }) {
    const email = input.email.trim().toLowerCase();
    const fullName = input.full_name.trim();

    if (input.password.length < 8) throw Errors.weakPassword();

    const existing = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) throw Errors.emailTaken();

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    const userId = await withSerializableTransaction(async (client) => {
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [email, passwordHash, fullName]
      );
      const id = user.rows[0].id;

      await client.query(
        `INSERT INTO wallets (user_id, balance_paisa) VALUES ($1, $2)`,
        [id, INITIAL_BALANCE_PAISA.toString()]
      );

      // Immutable proof of the opening balance.
      await client.query(
        `INSERT INTO ledger_entries (user_id, amount_paisa, balance_after, transfer_id, entry_type)
         VALUES ($1, $2, $2, NULL, 'INITIAL_FUNDING')`,
        [id, INITIAL_BALANCE_PAISA.toString()]
      );

      return id;
    });

    logger.info('user registered', { userId, email });
    const token = signToken(userId);

    return {
      user_id: userId,
      email,
      full_name: fullName,
      token,
      token_expires_in: 86400,
      wallet: {
        balance_paisa: INITIAL_BALANCE_PAISA.toString(),
        balance_bdt: paisaToBdtString(INITIAL_BALANCE_PAISA),
        currency: 'BDT',
      },
    };
  },

  async login(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, password_hash, full_name, account_status
         FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user || user.account_status !== 'ACTIVE') throw Errors.invalidCredentials();

    const ok = await bcrypt.compare(input.password, user.password_hash);
    if (!ok) throw Errors.invalidCredentials();

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    logger.info('user login', { userId: user.id });

    return {
      user_id: user.id,
      full_name: user.full_name,
      token: signToken(user.id),
      token_expires_in: 86400,
    };
  },

  async profile(userId: string) {
    const { rows } = await pool.query(
      `SELECT id, email, full_name, account_status, created_at, last_login_at
         FROM users WHERE id = $1`,
      [userId]
    );
    if (rows.length === 0) throw Errors.userNotFound();
    const u = rows[0];
    return {
      user_id: u.id,
      email: u.email,
      full_name: u.full_name,
      account_status: u.account_status,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (newPassword.length < 8) throw Errors.weakPassword();
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) throw Errors.userNotFound();

    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) throw Errors.invalidCredentials();

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      hash,
      userId,
    ]);
    logger.info('password changed', { userId });
  },
};

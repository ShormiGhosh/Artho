import { pool } from '../config/database';
import { Errors } from '../utils/errors';
import { paisaToBdtString, formatBdt } from '../utils/money';

export const WalletService = {
  async getWallet(userId: string) {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.account_status, u.role, u.nid, u.created_at,
              w.balance_paisa, w.currency, w.updated_at AS wallet_updated_at
         FROM users u
         JOIN wallets w ON w.user_id = u.id
        WHERE u.id = $1`,
      [userId]
    );
    if (rows.length === 0) throw Errors.userNotFound();
    const r = rows[0];
    return {
      user_id: r.id,
      email: r.email,
      full_name: r.full_name,
      account_status: r.account_status,
      role: r.role,
      nid: r.nid,
      created_at: r.created_at,
      wallet: {
        balance_paisa: r.balance_paisa.toString(),
        balance_bdt: paisaToBdtString(r.balance_paisa),
        balance_display: formatBdt(r.balance_paisa),
        currency: r.currency,
        updated_at: r.wallet_updated_at,
      },
    };
  },

  async balancePaisa(userId: string): Promise<bigint> {
    const { rows } = await pool.query('SELECT balance_paisa FROM wallets WHERE user_id = $1', [
      userId,
    ]);
    if (rows.length === 0) throw Errors.userNotFound();
    return rows[0].balance_paisa as bigint;
  },
};

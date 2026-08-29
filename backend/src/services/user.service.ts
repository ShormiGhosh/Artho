import { pool } from '../config/database';

export const UserService = {
  /**
   * Search by name or email fragment. Never leaks balances or status detail.
   * Excludes the caller and non-active accounts.
   */
  async search(currentUserId: string, term: string, limit = 10) {
    const q = term.trim();
    if (q.length < 1) return [];
    const capped = Math.min(Math.max(limit, 1), 50);

    const { rows } = await pool.query(
      `SELECT id, full_name, email
         FROM users
        WHERE id <> $1
          AND account_status = 'ACTIVE'
          AND (full_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
        ORDER BY
          (LOWER(full_name) = LOWER($2)) DESC,
          (full_name ILIKE $2 || '%') DESC,
          full_name ASC
        LIMIT $3`,
      [currentUserId, q, capped]
    );
    return rows.map((r) => ({ user_id: r.id, full_name: r.full_name, email: r.email }));
  },

  async getPublicProfile(userId: string) {
    const { rows } = await pool.query(
      `SELECT id, full_name, email FROM users WHERE id = $1 AND account_status = 'ACTIVE'`,
      [userId]
    );
    if (rows.length === 0) return null;
    return { user_id: rows[0].id, full_name: rows[0].full_name, email: rows[0].email };
  },
};

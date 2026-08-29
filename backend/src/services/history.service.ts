import { pool } from '../config/database';
import { formatBdt, paisaToBdtString } from '../utils/money';

interface FeedOptions {
  page?: number;
  limit?: number;
  kind?: 'TRANSFER' | 'REQUEST' | 'all';
  status?: string;
  from?: string;
  to?: string;
}

export const HistoryService = {
  /**
   * Unified, reverse-chronological activity feed combining transfers and money
   * requests the user is party to.
   */
  async feed(userId: string, opts: FeedOptions = {}) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);

    const items: any[] = [];

    if (!opts.kind || opts.kind === 'all' || opts.kind === 'TRANSFER') {
      const { rows } = await pool.query(
        `SELECT t.id, t.reference, t.sender_id, t.receiver_id, t.amount_paisa, t.status,
                t.type, t.note, t.failure_reason, t.created_at,
                s.full_name AS sender_name, r.full_name AS receiver_name
           FROM transfers t
           JOIN users s ON s.id = t.sender_id
           JOIN users r ON r.id = t.receiver_id
          WHERE t.sender_id = $1 OR t.receiver_id = $1`,
        [userId]
      );
      for (const row of rows) {
        const direction = row.sender_id === userId ? 'SENT' : 'RECEIVED';
        items.push({
          kind: 'TRANSFER',
          id: row.id,
          reference: row.reference,
          direction,
          badge: direction === 'SENT' ? 'SENT' : 'RECEIVED',
          counterparty_name: direction === 'SENT' ? row.receiver_name : row.sender_name,
          amount_paisa: row.amount_paisa.toString(),
          amount_bdt: paisaToBdtString(row.amount_paisa),
          amount_display: formatBdt(row.amount_paisa),
          status: row.status,
          note: row.note,
          failure_reason: row.failure_reason,
          transfer_type: row.type,
          created_at: row.created_at,
        });
      }
    }

    if (!opts.kind || opts.kind === 'all' || opts.kind === 'REQUEST') {
      const { rows } = await pool.query(
        `SELECT mr.id, mr.reference, mr.requester_id, mr.requestee_id, mr.amount_paisa,
                mr.status, mr.reason, mr.related_transfer_id, mr.created_at,
                u1.full_name AS requester_name, u2.full_name AS requestee_name
           FROM money_requests mr
           JOIN users u1 ON u1.id = mr.requester_id
           JOIN users u2 ON u2.id = mr.requestee_id
          WHERE mr.requester_id = $1 OR mr.requestee_id = $1`,
        [userId]
      );
      for (const row of rows) {
        const direction = row.requester_id === userId ? 'SENT' : 'RECEIVED';
        items.push({
          kind: 'REQUEST',
          id: row.id,
          reference: row.reference,
          direction,
          badge: direction === 'SENT' ? 'REQUEST_SENT' : 'REQUEST_RECEIVED',
          counterparty_name: direction === 'SENT' ? row.requestee_name : row.requester_name,
          amount_paisa: row.amount_paisa.toString(),
          amount_bdt: paisaToBdtString(row.amount_paisa),
          amount_display: formatBdt(row.amount_paisa),
          status: row.status,
          reason: row.reason,
          related_transfer_id: row.related_transfer_id,
          created_at: row.created_at,
        });
      }
    }

    let filtered = items;
    if (opts.status && opts.status !== 'all') {
      filtered = filtered.filter((i) => i.status === opts.status);
    }
    if (opts.from) {
      const from = new Date(opts.from).getTime();
      filtered = filtered.filter((i) => new Date(i.created_at).getTime() >= from);
    }
    if (opts.to) {
      const to = new Date(opts.to).getTime() + 24 * 60 * 60 * 1000 - 1;
      filtered = filtered.filter((i) => new Date(i.created_at).getTime() <= to);
    }

    filtered.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const total = filtered.length;
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  },

  /** Immutable ledger view with the balance after each entry. */
  async ledger(userId: string, opts: { page?: number; limit?: number } = {}) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = (page - 1) * limit;

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM ledger_entries WHERE user_id = $1`,
      [userId]
    );

    const { rows } = await pool.query(
      `SELECT le.id, le.amount_paisa, le.balance_after, le.entry_type, le.created_at,
              le.transfer_id, t.reference AS transfer_reference
         FROM ledger_entries le
         LEFT JOIN transfers t ON t.id = le.transfer_id
        WHERE le.user_id = $1
        ORDER BY le.created_at DESC, le.id DESC
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return {
      entries: rows.map((r) => ({
        id: r.id,
        entry_type: r.entry_type,
        amount_paisa: r.amount_paisa.toString(),
        amount_bdt: paisaToBdtString(r.amount_paisa),
        balance_after_bdt: paisaToBdtString(r.balance_after),
        transfer_id: r.transfer_id,
        transfer_reference: r.transfer_reference,
        created_at: r.created_at,
      })),
      pagination: {
        page,
        limit,
        total: totalRes.rows[0].c as number,
        pages: Math.ceil((totalRes.rows[0].c as number) / limit) || 1,
      },
    };
  },
};

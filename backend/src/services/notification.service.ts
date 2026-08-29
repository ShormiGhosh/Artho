import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { logger } from '../utils/logger';

type NotificationType =
  | 'TRANSFER_RECEIVED'
  | 'REQUEST_RECEIVED'
  | 'REQUEST_APPROVED'
  | 'REQUEST_REJECTED'
  | 'REQUEST_CANCELLED'
  | 'REQUEST_EXPIRED'
  | 'STIPEND_RECEIVED';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedTransferId?: string | null;
  relatedRequestId?: string | null;
}

/**
 * Notifications are best-effort and never block money movement. Failures are
 * logged and swallowed; the transaction is already durable by the time we get
 * here, and the user can always see it in their history.
 */
export const NotificationService = {
  async create(input: CreateNotificationInput, client?: PoolClient): Promise<void> {
    const runner = client ?? pool;
    try {
      await runner.query(
        `INSERT INTO notifications
           (user_id, type, related_transfer_id, related_request_id, title, message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.userId,
          input.type,
          input.relatedTransferId ?? null,
          input.relatedRequestId ?? null,
          input.title,
          input.message,
        ]
      );
    } catch (err) {
      logger.error('notification create failed', err, { userId: input.userId, type: input.type });
    }
  },

  /** Fire-and-forget wrapper used after a committed transaction. */
  emit(input: CreateNotificationInput): void {
    void this.create(input);
  },

  async list(userId: string, unreadOnly = false) {
    const { rows } = await pool.query(
      `SELECT id, type, related_transfer_id, related_request_id, title, message,
              is_read, created_at
         FROM notifications
        WHERE user_id = $1 ${unreadOnly ? 'AND is_read = FALSE' : ''}
        ORDER BY created_at DESC
        LIMIT 100`,
      [userId]
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      related_transfer_id: r.related_transfer_id,
      related_request_id: r.related_request_id,
      title: r.title,
      message: r.message,
      is_read: r.is_read,
      created_at: r.created_at,
    }));
  },

  async unreadCount(userId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    return rows[0].c;
  },

  async markRead(userId: string, id: string): Promise<void> {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
  },

  async markAllRead(userId: string): Promise<void> {
    await pool.query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
  },
};

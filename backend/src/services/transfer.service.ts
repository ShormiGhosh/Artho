import { PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { pool, withSerializableTransaction } from '../config/database';
import { MAX_NOTE_LENGTH } from '../config/constants';
import { Errors } from '../utils/errors';
import { bdtToPaisa, formatBdt, MoneyError, paisaToBdtString } from '../utils/money';
import { newTransferReference } from '../utils/reference';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';

export type TransferType = 'TRANSFER' | 'REQUEST_APPROVAL' | 'STIPEND';

export interface ExecuteTransferInput {
  senderId: string;
  receiverId: string;
  /** Raw user amount in BDT ("2500", "2500.50") or an already-parsed paisa bigint. */
  amount: string | number | bigint;
  note?: string | null;
  idempotencyKey: string;
  type?: TransferType;
}

interface TransferRow {
  id: string;
  reference: string;
  sender_id: string;
  receiver_id: string;
  amount_paisa: bigint;
  status: string;
  type: string;
  note: string | null;
  failure_reason: string | null;
  sender_balance_before: bigint | null;
  sender_balance_after: bigint | null;
  receiver_balance_before: bigint | null;
  receiver_balance_after: bigint | null;
  created_at: Date;
  updated_at: Date;
}

function toPaisa(amount: string | number | bigint): bigint {
  if (typeof amount === 'bigint') return amount;
  try {
    return bdtToPaisa(amount);
  } catch (e) {
    if (e instanceof MoneyError) throw Errors.invalidAmount(e.message);
    throw e;
  }
}

function shape(row: TransferRow, viewerId: string) {
  const direction = row.sender_id === viewerId ? 'SENT' : 'RECEIVED';
  const yourBefore =
    direction === 'SENT' ? row.sender_balance_before : row.receiver_balance_before;
  const yourAfter =
    direction === 'SENT' ? row.sender_balance_after : row.receiver_balance_after;
  return {
    transfer_id: row.id,
    reference: row.reference,
    status: row.status,
    type: row.type,
    is_stipend: row.type === 'STIPEND',
    fee_bdt: '0.00',
    direction,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    amount_paisa: row.amount_paisa.toString(),
    amount_bdt: paisaToBdtString(row.amount_paisa),
    amount_display: formatBdt(row.amount_paisa),
    note: row.note,
    failure_reason: row.failure_reason,
    your_balance_before_bdt: yourBefore != null ? paisaToBdtString(yourBefore) : null,
    your_balance_after_bdt: yourAfter != null ? paisaToBdtString(yourAfter) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findByIdempotencyKey(senderId: string, key: string): Promise<TransferRow | null> {
  const { rows } = await pool.query<TransferRow>(
    `SELECT * FROM transfers WHERE sender_id = $1 AND idempotency_key = $2`,
    [senderId, key]
  );
  return rows[0] ?? null;
}

async function recordStandaloneFailure(
  input: ExecuteTransferInput,
  amountPaisa: bigint,
  reason: string
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO transfers
         (reference, sender_id, receiver_id, amount_paisa, status, type, note,
          idempotency_key, failure_reason)
       VALUES ($1, $2, $3, $4, 'FAILED', $5, $6, $7, $8)`,
      [
        newTransferReference(),
        input.senderId,
        input.receiverId,
        amountPaisa.toString(),
        input.type ?? 'TRANSFER',
        input.note ?? null,
        // random key so a genuine retry (e.g. after topping up) is not blocked
        `failed-${uuidv4()}`,
        reason,
      ]
    );
  } catch (err) {
    logger.error('failed to record FAILED transfer', err);
  }
}

export const TransferService = {
  /**
   * The core money-movement primitive. Atomic, serialized per wallet, and
   * exactly-once for a given (sender, idempotencyKey).
   */
  async execute(input: ExecuteTransferInput) {
    const type: TransferType = input.type ?? 'TRANSFER';

    if (input.senderId === input.receiverId) throw Errors.selfTransfer();
    if (input.note && input.note.length > MAX_NOTE_LENGTH) {
      throw Errors.invalidRequest(`Note must be at most ${MAX_NOTE_LENGTH} characters`);
    }
    const amountPaisa = toPaisa(input.amount);

    // Service-level idempotency: replay a prior result for the same key.
    const prior = await findByIdempotencyKey(input.senderId, input.idempotencyKey);
    if (prior) {
      if (prior.status === 'COMPLETED') return shape(prior, input.senderId);
      if (prior.status === 'FAILED') {
        throw Errors.insufficientBalance(); // deterministic replay of the failure
      }
    }

    let sentinel: 'INSUFFICIENT_BALANCE' | 'RECEIVER_NOT_FOUND' | 'RECEIVER_INACTIVE' | null =
      null;

    try {
      const result = await withSerializableTransaction(async (client: PoolClient) => {
        // Lock both wallets in a deterministic order to prevent deadlocks.
        const locked = await client.query<{
          user_id: string;
          balance_paisa: bigint;
          account_status: string;
          full_name: string;
        }>(
          `SELECT w.user_id, w.balance_paisa, u.account_status, u.full_name
             FROM wallets w
             JOIN users u ON u.id = w.user_id
            WHERE w.user_id = ANY($1::uuid[])
            ORDER BY w.user_id
            FOR UPDATE OF w`,
          [[input.senderId, input.receiverId]]
        );

        const byId = new Map(locked.rows.map((r) => [r.user_id, r]));
        const sender = byId.get(input.senderId);
        const receiver = byId.get(input.receiverId);

        if (!sender) throw Errors.userNotFound('Sender wallet not found');
        if (!receiver) {
          sentinel = 'RECEIVER_NOT_FOUND';
          throw new Error('RECEIVER_NOT_FOUND');
        }
        if (receiver.account_status !== 'ACTIVE') {
          sentinel = 'RECEIVER_INACTIVE';
          throw new Error('RECEIVER_INACTIVE');
        }

        if (sender.balance_paisa < amountPaisa) {
          sentinel = 'INSUFFICIENT_BALANCE';
          throw new Error('INSUFFICIENT_BALANCE');
        }

        const senderBefore = sender.balance_paisa;
        const senderAfter = senderBefore - amountPaisa;
        const receiverBefore = receiver.balance_paisa;
        const receiverAfter = receiverBefore + amountPaisa;

        await client.query(
          `UPDATE wallets SET balance_paisa = balance_paisa - $1, updated_at = NOW()
            WHERE user_id = $2`,
          [amountPaisa.toString(), input.senderId]
        );
        await client.query(
          `UPDATE wallets SET balance_paisa = balance_paisa + $1, updated_at = NOW()
            WHERE user_id = $2`,
          [amountPaisa.toString(), input.receiverId]
        );

        const transferId = uuidv4();
        const reference = newTransferReference();
        const inserted = await client.query<TransferRow>(
          `INSERT INTO transfers
             (id, reference, sender_id, receiver_id, amount_paisa, status, type, note,
              idempotency_key, sender_balance_before, sender_balance_after,
              receiver_balance_before, receiver_balance_after, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, $7, $8, $9, $10, $11, $12, NOW())
           RETURNING *`,
          [
            transferId,
            reference,
            input.senderId,
            input.receiverId,
            amountPaisa.toString(),
            type,
            input.note ?? null,
            input.idempotencyKey,
            senderBefore.toString(),
            senderAfter.toString(),
            receiverBefore.toString(),
            receiverAfter.toString(),
          ]
        );

        await client.query(
          `INSERT INTO ledger_entries (user_id, amount_paisa, balance_after, transfer_id, entry_type)
           VALUES ($1, $2, $3, $4, 'TRANSFER_DEBIT')`,
          [input.senderId, (-amountPaisa).toString(), senderAfter.toString(), transferId]
        );
        await client.query(
          `INSERT INTO ledger_entries (user_id, amount_paisa, balance_after, transfer_id, entry_type)
           VALUES ($1, $2, $3, $4, 'TRANSFER_CREDIT')`,
          [input.receiverId, amountPaisa.toString(), receiverAfter.toString(), transferId]
        );

        return { row: inserted.rows[0], senderName: sender.full_name };
      });

      logger.info('transfer completed', {
        transferId: result.row.id,
        reference: result.row.reference,
        senderId: input.senderId,
        receiverId: input.receiverId,
        amountPaisa: amountPaisa.toString(),
        type,
      });

      const fromName =
        result.row.sender_id === input.senderId ? result.senderName : 'a user';
      NotificationService.emit(
        type === 'STIPEND'
          ? {
              userId: input.receiverId,
              type: 'STIPEND_RECEIVED',
              title: 'Stipend received',
              message: `${formatBdt(amountPaisa)} stipend credited by ${fromName} — no cash-out fee`,
              relatedTransferId: result.row.id,
            }
          : {
              userId: input.receiverId,
              type: 'TRANSFER_RECEIVED',
              title: 'Money received',
              message: `Received ${formatBdt(amountPaisa)} from ${fromName}`,
              relatedTransferId: result.row.id,
            }
      );

      return shape(result.row, input.senderId);
    } catch (err: any) {
      // Concurrent duplicate: the other request won the unique key. Replay it.
      if (err?.code === '23505' && String(err.constraint).includes('idempotency')) {
        const existing = await findByIdempotencyKey(input.senderId, input.idempotencyKey);
        if (existing && existing.status === 'COMPLETED') return shape(existing, input.senderId);
      }

      if (sentinel === 'INSUFFICIENT_BALANCE') {
        await recordStandaloneFailure(input, amountPaisa, 'INSUFFICIENT_BALANCE');
        const available = await pool
          .query('SELECT balance_paisa FROM wallets WHERE user_id = $1', [input.senderId])
          .then((r) => r.rows[0]?.balance_paisa ?? 0n);
        throw Errors.insufficientBalance({
          required_paisa: amountPaisa.toString(),
          available_paisa: available.toString(),
        });
      }
      if (sentinel === 'RECEIVER_NOT_FOUND') {
        await recordStandaloneFailure(input, amountPaisa, 'RECEIVER_NOT_FOUND');
        throw Errors.receiverNotFound();
      }
      if (sentinel === 'RECEIVER_INACTIVE') {
        await recordStandaloneFailure(input, amountPaisa, 'RECEIVER_INACTIVE');
        throw Errors.receiverInactive();
      }
      throw err;
    }
  },

  /** Cheap lookup of an already-executed transfer by its (sender, key) pair. */
  async getByIdempotencyKey(senderId: string, key: string) {
    const row = await findByIdempotencyKey(senderId, key);
    return row
      ? { transfer_id: row.id, reference: row.reference, status: row.status }
      : null;
  },

  async getForUser(idOrReference: string, userId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrReference
    );
    // References are stored upper-case; accept any casing from callers.
    const lookup = isUuid ? idOrReference : idOrReference.toUpperCase();
    const { rows } = await pool.query<TransferRow & { sender_name: string; receiver_name: string }>(
      `SELECT t.*, s.full_name AS sender_name, r.full_name AS receiver_name
         FROM transfers t
         JOIN users s ON s.id = t.sender_id
         JOIN users r ON r.id = t.receiver_id
        WHERE ${isUuid ? 't.id = $1' : 't.reference = $1'}`,
      [lookup]
    );
    const row = rows[0];
    if (!row) throw Errors.transferNotFound();
    if (row.sender_id !== userId && row.receiver_id !== userId) throw Errors.forbidden();

    const base = shape(row, userId);
    return {
      ...base,
      counterparty:
        base.direction === 'SENT'
          ? { user_id: row.receiver_id, full_name: row.receiver_name }
          : { user_id: row.sender_id, full_name: row.sender_name },
    };
  },

  async list(
    userId: string,
    opts: { page?: number; limit?: number; status?: string; direction?: string } = {}
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const offset = (page - 1) * limit;

    const filters: string[] = ['(t.sender_id = $1 OR t.receiver_id = $1)'];
    const params: any[] = [userId];

    if (opts.status && opts.status !== 'all') {
      params.push(opts.status);
      filters.push(`t.status = $${params.length}`);
    }
    if (opts.direction === 'sent') filters.push('t.sender_id = $1');
    if (opts.direction === 'received') filters.push('t.receiver_id = $1');

    const where = filters.join(' AND ');
    const totalRes = await pool.query(`SELECT COUNT(*)::int AS c FROM transfers t WHERE ${where}`, params);
    const total = totalRes.rows[0].c as number;

    params.push(limit, offset);
    const { rows } = await pool.query<TransferRow & { sender_name: string; receiver_name: string }>(
      `SELECT t.*, s.full_name AS sender_name, r.full_name AS receiver_name
         FROM transfers t
         JOIN users s ON s.id = t.sender_id
         JOIN users r ON r.id = t.receiver_id
        WHERE ${where}
        ORDER BY t.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return {
      transfers: rows.map((row) => {
        const base = shape(row, userId);
        return {
          ...base,
          other_party:
            base.direction === 'SENT' ? row.receiver_name : row.sender_name,
        };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  },
};

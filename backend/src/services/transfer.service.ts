import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { pool, withSerializableTransaction } from '../config/database';
import { MAX_NOTE_LENGTH } from '../config/constants';
import { AppError, Errors } from '../utils/errors';
import { bdtToPaisa, formatBdt, MoneyError, paisaToBdtString } from '../utils/money';
import { newTransferReference } from '../utils/reference';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';

export type TransferType = 'TRANSFER' | 'REQUEST_APPROVAL' | 'STIPEND';
export type TransferSimulation =
  | 'crash_before_processing'
  | 'crash_during_processing'
  | 'lost_response';

export interface ExecuteTransferInput {
  senderId: string;
  receiverId: string;
  /** Raw user amount in BDT ("2500", "2500.50") or an already-parsed paisa bigint. */
  amount: string | number | bigint;
  note?: string | null;
  idempotencyKey: string;
  type?: TransferType;
  /**
   * Retry policy when this (sender, idempotencyKey) previously FAILED:
   *  - 'replay' (default): return the original failure. One key = one user action.
   *  - 'retry': reset that same transfer row to PENDING and attempt again (used by
   *    internally-driven flows with deterministic keys — disbursements, request
   *    approvals — where a top-up should let the payment go through).
   */
  onPriorFailure?: 'replay' | 'retry';
  /** Fault injection for demonstrating exactly-once / recovery. */
  simulate?: TransferSimulation | null;
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
  attempt_count: number;
  sender_balance_before: bigint | null;
  sender_balance_after: bigint | null;
  receiver_balance_before: bigint | null;
  receiver_balance_after: bigint | null;
  created_at: Date;
  updated_at: Date;
}

interface TransferEventRow {
  seq: number;
  state: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: Date;
}

type Executor = Pool | PoolClient;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toPaisa(amount: string | number | bigint): bigint {
  if (typeof amount === 'bigint') return amount;
  try {
    return bdtToPaisa(amount);
  } catch (e) {
    if (e instanceof MoneyError) throw Errors.invalidAmount(e.message);
    throw e;
  }
}

/** Append one row to the append-only per-transfer audit trail. */
async function appendEvent(
  exec: Executor,
  transferId: string,
  state: string,
  event: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await exec.query(
    `INSERT INTO transfer_events (transfer_id, seq, state, event, detail)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4::jsonb
       FROM transfer_events WHERE transfer_id = $1`,
    [transferId, state, event, JSON.stringify(detail)]
  );
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
    is_uncertain: ['PENDING', 'PROCESSING', 'VERIFYING'].includes(row.status),
    attempt_count: row.attempt_count,
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

async function loadEvents(transferId: string): Promise<TransferEventRow[]> {
  const { rows } = await pool.query<TransferEventRow>(
    `SELECT seq, state, event, detail, created_at
       FROM transfer_events WHERE transfer_id = $1 ORDER BY seq ASC`,
    [transferId]
  );
  return rows;
}

/** Turn a stored FAILED transfer back into its original typed error (replay policy). */
function failureError(row: TransferRow): AppError {
  const reason = row.failure_reason || 'UNKNOWN';
  const details = {
    replayed_failure: true,
    transfer_reference: row.reference,
    failure_reason: reason,
  };
  if (reason === 'INSUFFICIENT_BALANCE') {
    return new AppError(
      'INSUFFICIENT_BALANCE',
      'This transfer already failed: your balance was insufficient. Start a new transfer to try again.',
      402,
      details
    );
  }
  if (reason === 'RECEIVER_NOT_FOUND') {
    return new AppError('RECEIVER_NOT_FOUND', 'This transfer already failed: recipient not found.', 404, details);
  }
  if (reason === 'RECEIVER_INACTIVE') {
    return new AppError('RECEIVER_INACTIVE', 'This transfer already failed: recipient inactive.', 409, details);
  }
  return new AppError(
    'TRANSFER_FAILED',
    `This transfer already failed (${reason}). Start a new transfer to try again.`,
    409,
    details
  );
}

/** Wait briefly for a concurrent attempt on the same key to reach a terminal state. */
async function awaitSettled(senderId: string, key: string): Promise<TransferRow | null> {
  for (let i = 0; i < 15; i++) {
    const row = await findByIdempotencyKey(senderId, key);
    if (!row) return null;
    if (row.status === 'COMPLETED' || row.status === 'FAILED') return row;
    await new Promise((r) => setTimeout(r, 200));
  }
  return findByIdempotencyKey(senderId, key);
}

export const TransferService = {
  /**
   * Core money-movement primitive.
   *
   * Lifecycle: a PENDING row + INITIATED event are committed first, then a single
   * SERIALIZABLE transaction moves the money, writes BALANCE_LOCKED / PROCESSED /
   * COMPLETED events and flips the row to COMPLETED — all-or-nothing. A business
   * failure flips the same row to FAILED (no money moved); the immutable
   * idempotency key stays, so a same-key retry replays the failure (see
   * `onPriorFailure`).
   *
   * If execution is interrupted, the row is left PENDING with no ledger entries;
   * `verify()` reconciles it against the ledger to a definite terminal state.
   */
  async execute(input: ExecuteTransferInput) {
    const type: TransferType = input.type ?? 'TRANSFER';
    const onPriorFailure = input.onPriorFailure ?? 'replay';

    if (input.senderId === input.receiverId) throw Errors.selfTransfer();
    if (input.note && input.note.length > MAX_NOTE_LENGTH) {
      throw Errors.invalidRequest(`Note must be at most ${MAX_NOTE_LENGTH} characters`);
    }
    const amountPaisa = toPaisa(input.amount);

    let transferRow: TransferRow | undefined;
    let transferId = '';
    let reference = '';

    // Handle a FAILED prior for this (sender, key) per the retry policy.
    const resolvePriorFailure = async (row: TransferRow): Promise<'replayed' | 'reset'> => {
      if (onPriorFailure === 'replay') throw failureError(row);
      const reset = await pool.query<TransferRow>(
        `UPDATE transfers
            SET status = 'PENDING', failure_reason = NULL,
                attempt_count = attempt_count + 1, updated_at = NOW()
          WHERE id = $1 AND status = 'FAILED'
          RETURNING *`,
        [row.id]
      );
      if (reset.rows[0]) {
        transferRow = reset.rows[0];
        transferId = transferRow.id;
        reference = transferRow.reference;
        await appendEvent(pool, transferId, 'PENDING', 'INITIATED', {
          amount_paisa: amountPaisa.toString(),
          type,
          attempt: transferRow.attempt_count,
          retry: true,
        });
        return 'reset';
      }
      return 'replayed'; // lost a race; fall through to re-read
    };

    // Replay / concurrent-dedupe on (sender, idempotencyKey).
    const prior = await findByIdempotencyKey(input.senderId, input.idempotencyKey);
    if (prior) {
      if (prior.status === 'COMPLETED') return shape(prior, input.senderId);
      if (prior.status === 'FAILED') {
        await resolvePriorFailure(prior);
      } else {
        // PENDING / PROCESSING / VERIFYING — let a concurrent attempt settle.
        const settled = await awaitSettled(input.senderId, input.idempotencyKey);
        if (settled?.status === 'COMPLETED') return shape(settled, input.senderId);
        if (settled?.status === 'FAILED') {
          await resolvePriorFailure(settled);
        } else if (settled) {
          return shape(settled, input.senderId); // still in flight — caller may verify()
        }
      }
    }

    // ---- 1. Commit a fresh PENDING row + INITIATED event -----------------
    if (!transferRow) {
      transferId = uuidv4();
      reference = newTransferReference();
      const preInsert = await pool.query<TransferRow>(
        `INSERT INTO transfers
           (id, reference, sender_id, receiver_id, amount_paisa, status, type, note,
            idempotency_key, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, NOW())
         ON CONFLICT (sender_id, idempotency_key) DO NOTHING
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
        ]
      );

      transferRow = preInsert.rows[0] as TransferRow | undefined;
      if (!transferRow) {
        const settled = await awaitSettled(input.senderId, input.idempotencyKey);
        if (settled?.status === 'COMPLETED') return shape(settled, input.senderId);
        if (settled?.status === 'FAILED') {
          await resolvePriorFailure(settled);
          if (!transferRow) throw failureError(settled);
        } else if (settled) {
          return shape(settled, input.senderId);
        } else {
          throw Errors.internal('Could not create transfer');
        }
      } else {
        await appendEvent(pool, transferId, 'PENDING', 'INITIATED', {
          amount_paisa: amountPaisa.toString(),
          type,
          attempt: transferRow.attempt_count,
        });
      }
    }

    // ---- fault injection: server dies before touching money --------------
    if (input.simulate === 'crash_before_processing') {
      logger.warn('SIMULATED crash before processing', { transferId, reference });
      throw new AppError(
        'SIMULATED_CRASH',
        'Simulated server crash before processing. No money has moved — verify to confirm.',
        500,
        { transfer_reference: reference, transfer_id: transferId }
      );
    }

    let sentinel: 'INSUFFICIENT_BALANCE' | 'RECEIVER_NOT_FOUND' | 'RECEIVER_INACTIVE' | null =
      null;

    try {
      const result = await withSerializableTransaction(async (client: PoolClient) => {
        const locked = await client.query<{
          user_id: string;
          balance_paisa: bigint;
          account_status: string;
          full_name: string;
        }>(
          `SELECT w.user_id, w.balance_paisa, u.account_status, u.full_name
             FROM wallets w JOIN users u ON u.id = w.user_id
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

        await appendEvent(client, transferId, 'PROCESSING', 'BALANCE_LOCKED', {
          sender_balance_paisa: senderBefore.toString(),
          amount_paisa: amountPaisa.toString(),
        });

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

        // ---- fault injection: crash mid-transaction ----------------------
        // The debit/credit above are uncommitted; throwing here rolls the whole
        // SERIALIZABLE transaction back — balances are untouched.
        if (input.simulate === 'crash_during_processing') {
          throw new Error('SIMULATED_CRASH_MID_TX');
        }

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

        await appendEvent(client, transferId, 'PROCESSING', 'PROCESSED', {
          amount_paisa: amountPaisa.toString(),
        });

        const updated = await client.query<TransferRow>(
          `UPDATE transfers
              SET status = 'COMPLETED', sender_balance_before = $2, sender_balance_after = $3,
                  receiver_balance_before = $4, receiver_balance_after = $5, updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [
            transferId,
            senderBefore.toString(),
            senderAfter.toString(),
            receiverBefore.toString(),
            receiverAfter.toString(),
          ]
        );

        await appendEvent(client, transferId, 'COMPLETED', 'COMPLETED', {
          sender_balance_after_paisa: senderAfter.toString(),
        });

        return { row: updated.rows[0], senderName: sender.full_name };
      });

      transferRow = result.row;
      logger.info('transfer completed', {
        transferId: result.row.id,
        reference: result.row.reference,
        senderId: input.senderId,
        receiverId: input.receiverId,
        amountPaisa: amountPaisa.toString(),
        type,
      });

      const fromName = result.row.sender_id === input.senderId ? result.senderName : 'a user';
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

      // ---- fault injection: money moved but the client never hears back ---
      if (input.simulate === 'lost_response') {
        logger.warn('SIMULATED lost client response', { transferId, reference });
        throw new AppError(
          'NETWORK_UNCERTAIN',
          'Simulated: your device did not receive the confirmation. The transfer may already be done — verify to find out.',
          504,
          { transfer_reference: reference, transfer_id: transferId }
        );
      }

      return shape(result.row, input.senderId);
    } catch (err: any) {
      if (err instanceof AppError && ['SIMULATED_CRASH', 'NETWORK_UNCERTAIN'].includes(err.code)) {
        throw err;
      }

      // Simulated mid-transaction crash: the tx rolled back, no money moved.
      if (err?.message === 'SIMULATED_CRASH_MID_TX') {
        logger.warn('SIMULATED crash during processing (rolled back)', { transferId, reference });
        throw new AppError(
          'SIMULATED_CRASH',
          'Simulated server crash during processing. The transaction rolled back — no money moved. Verify to confirm.',
          500,
          { transfer_reference: reference, transfer_id: transferId }
        );
      }

      if (sentinel) {
        const reason =
          sentinel === 'INSUFFICIENT_BALANCE'
            ? 'INSUFFICIENT_BALANCE'
            : sentinel === 'RECEIVER_NOT_FOUND'
              ? 'RECEIVER_NOT_FOUND'
              : 'RECEIVER_INACTIVE';
        // Flip the PENDING row to FAILED. The idempotency key is immutable — a
        // same-key retry replays this failure; a new user action needs a new key.
        await pool
          .query(
            `UPDATE transfers SET status = 'FAILED', failure_reason = $2, updated_at = NOW()
              WHERE id = $1 AND status = 'PENDING'`,
            [transferId, reason]
          )
          .catch((e) => logger.error('failed to mark transfer FAILED', e));
        await appendEvent(pool, transferId, 'FAILED', 'FAILED', { reason }).catch(() => undefined);

        if (sentinel === 'INSUFFICIENT_BALANCE') {
          const available = await pool
            .query('SELECT balance_paisa FROM wallets WHERE user_id = $1', [input.senderId])
            .then((r) => r.rows[0]?.balance_paisa ?? 0n);
          throw Errors.insufficientBalance({
            required_paisa: amountPaisa.toString(),
            available_paisa: available.toString(),
            transfer_reference: reference,
          });
        }
        if (sentinel === 'RECEIVER_NOT_FOUND') throw Errors.receiverNotFound();
        throw Errors.receiverInactive();
      }

      // Unexpected error mid-execution — leave the row PENDING for verify() to reconcile.
      logger.error('transfer execution error, left PENDING for reconciliation', err, {
        transferId,
        reference,
      });
      throw new AppError(
        'TRANSFER_UNCERTAIN',
        'The transfer could not be confirmed. Use verify to get its final status.',
        502,
        { transfer_reference: reference, transfer_id: transferId }
      );
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
    const isUuid = UUID_RE.test(idOrReference);
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
      events: await loadEvents(row.id),
    };
  },

  /**
   * "What happened to my money?" — reconcile a transfer against the authoritative
   * record (its ledger entries) and return a definite outcome plus the full
   * timeline. Safe to call repeatedly; never moves money.
   */
  async verify(idOrReference: string, userId: string) {
    const isUuid = UUID_RE.test(idOrReference);
    const lookup = isUuid ? idOrReference : idOrReference.toUpperCase();
    const found = await pool.query<TransferRow>(
      `SELECT * FROM transfers WHERE ${isUuid ? 'id' : 'reference'} = $1`,
      [lookup]
    );
    const row = found.rows[0];
    if (!row) throw Errors.transferNotFound();
    if (row.sender_id !== userId && row.receiver_id !== userId) throw Errors.forbidden();

    // Authoritative record = the immutable ledger entries for this transfer.
    const ledger = await pool.query<{ amount_paisa: bigint; entry_type: string }>(
      `SELECT amount_paisa, entry_type FROM ledger_entries WHERE transfer_id = $1`,
      [row.id]
    );
    const entries = ledger.rows;
    const net = entries.reduce((a, e) => a + BigInt(e.amount_paisa), 0n);
    const debit = entries.find((e) => e.entry_type === 'TRANSFER_DEBIT');
    const credit = entries.find((e) => e.entry_type === 'TRANSFER_CREDIT');
    const moved =
      entries.length === 2 &&
      net === 0n &&
      !!debit &&
      !!credit &&
      BigInt(debit.amount_paisa) === -row.amount_paisa &&
      BigInt(credit.amount_paisa) === row.amount_paisa;

    let outcome: 'DELIVERED' | 'NOT_SENT' | 'INDETERMINATE';
    let targetStatus: 'COMPLETED' | 'FAILED' | null;
    if (moved) {
      outcome = 'DELIVERED';
      targetStatus = 'COMPLETED';
    } else if (entries.length === 0 && row.status !== 'COMPLETED') {
      outcome = 'NOT_SENT';
      targetStatus = 'FAILED';
    } else {
      outcome = 'INDETERMINATE';
      targetStatus = null;
      logger.error('RECONCILIATION INDETERMINATE', undefined, {
        transferId: row.id,
        reference: row.reference,
        status: row.status,
        ledgerCount: entries.length,
        netPaisa: net.toString(),
      });
    }

    const events = await loadEvents(row.id);
    const newest = events[events.length - 1];
    const alreadyResolved =
      newest?.event === 'VERIFIED' &&
      ((outcome === 'DELIVERED' && row.status === 'COMPLETED') ||
        (outcome === 'NOT_SENT' && row.status === 'FAILED'));

    if (!alreadyResolved) {
      await withSerializableTransaction(async (client) => {
        if (newest?.event !== 'CLIENT_CONFIRMATION_LOST' && newest?.event !== 'VERIFIED') {
          await appendEvent(client, row.id, 'VERIFYING', 'CLIENT_CONFIRMATION_LOST', {
            triggered_by: userId === row.sender_id ? 'sender' : 'receiver',
          });
          await client.query(
            `UPDATE transfers SET status = 'VERIFYING', updated_at = NOW()
              WHERE id = $1 AND status IN ('PENDING', 'PROCESSING')`,
            [row.id]
          );
        }

        if (targetStatus === 'COMPLETED') {
          await client.query(
            `UPDATE transfers SET status = 'COMPLETED', updated_at = NOW()
              WHERE id = $1 AND status <> 'COMPLETED'`,
            [row.id]
          );
          await appendEvent(client, row.id, 'COMPLETED', 'VERIFIED', { outcome });
        } else if (targetStatus === 'FAILED') {
          // Definite terminal state. The immutable idempotency key stays — a
          // same-key retry replays this outcome; sending again needs a new key.
          await client.query(
            `UPDATE transfers
                SET status = 'FAILED',
                    failure_reason = COALESCE(failure_reason, 'RECONCILED_NOT_PROCESSED'),
                    updated_at = NOW()
              WHERE id = $1 AND status <> 'FAILED'`,
            [row.id]
          );
          await appendEvent(client, row.id, 'FAILED', 'VERIFIED', { outcome });
        } else {
          await appendEvent(client, row.id, 'VERIFYING', 'VERIFIED', { outcome });
        }
      });
    }

    const reloaded = await pool.query<TransferRow & { sender_name: string; receiver_name: string }>(
      `SELECT t.*, s.full_name AS sender_name, r.full_name AS receiver_name
         FROM transfers t
         JOIN users s ON s.id = t.sender_id
         JOIN users r ON r.id = t.receiver_id
        WHERE t.id = $1`,
      [row.id]
    );
    const fresh = reloaded.rows[0];
    const base = shape(fresh, userId);

    return {
      transfer: {
        ...base,
        counterparty:
          base.direction === 'SENT'
            ? { user_id: fresh.receiver_id, full_name: fresh.receiver_name }
            : { user_id: fresh.sender_id, full_name: fresh.sender_name },
      },
      outcome,
      reconciliation: {
        ledger_entry_count: entries.length,
        net_ledger_paisa: net.toString(),
        money_moved: moved,
        snapshot_consistent:
          moved
            ? fresh.sender_balance_after != null &&
              fresh.sender_balance_before != null &&
              fresh.sender_balance_before - fresh.sender_balance_after === fresh.amount_paisa
            : entries.length === 0,
      },
      timeline: await loadEvents(row.id),
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
          other_party: base.direction === 'SENT' ? row.receiver_name : row.sender_name,
        };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
  },
};

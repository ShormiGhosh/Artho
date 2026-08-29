import { pool } from '../config/database';
import { MAX_REASON_LENGTH, REQUEST_TTL_DAYS } from '../config/constants';
import { Errors } from '../utils/errors';
import { bdtToPaisa, formatBdt, MoneyError, paisaToBdtString } from '../utils/money';
import { newRequestReference } from '../utils/reference';
import { logger } from '../utils/logger';
import { NotificationService } from './notification.service';
import { TransferService } from './transfer.service';

interface RequestRow {
  id: string;
  reference: string;
  requester_id: string;
  requestee_id: string;
  amount_paisa: bigint;
  reason: string | null;
  status: string;
  related_transfer_id: string | null;
  approved_at: Date | null;
  rejected_at: Date | null;
  cancelled_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  requester_name?: string;
  requestee_name?: string;
  related_transfer_reference?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_REQUEST = `
  SELECT mr.*, u1.full_name AS requester_name, u2.full_name AS requestee_name,
         t.reference AS related_transfer_reference
    FROM money_requests mr
    JOIN users u1 ON u1.id = mr.requester_id
    JOIN users u2 ON u2.id = mr.requestee_id
    LEFT JOIN transfers t ON t.id = mr.related_transfer_id
`;

function resolvedAt(row: RequestRow): Date | null {
  return row.approved_at ?? row.rejected_at ?? row.cancelled_at ?? null;
}

function shape(row: RequestRow, viewerId: string) {
  const direction = row.requester_id === viewerId ? 'SENT' : 'RECEIVED';
  return {
    request_id: row.id,
    reference: row.reference,
    direction,
    status: row.status,
    requester_id: row.requester_id,
    requestee_id: row.requestee_id,
    requester_name: row.requester_name,
    requestee_name: row.requestee_name,
    counterparty_name: direction === 'SENT' ? row.requestee_name : row.requester_name,
    amount_paisa: row.amount_paisa.toString(),
    amount_bdt: paisaToBdtString(row.amount_paisa),
    amount_display: formatBdt(row.amount_paisa),
    reason: row.reason,
    related_transfer_id: row.related_transfer_id,
    related_transfer_reference: row.related_transfer_reference ?? null,
    approved_at: row.approved_at,
    rejected_at: row.rejected_at,
    cancelled_at: row.cancelled_at,
    resolved_at: resolvedAt(row),
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

async function fetchRequest(idOrReference: string): Promise<RequestRow | null> {
  const isUuid = UUID_RE.test(idOrReference);
  // References are stored upper-case; accept any casing from callers.
  const lookup = isUuid ? idOrReference : idOrReference.toUpperCase();
  const { rows } = await pool.query<RequestRow>(
    `${SELECT_REQUEST} WHERE ${isUuid ? 'mr.id = $1' : 'mr.reference = $1'}`,
    [lookup]
  );
  return rows[0] ?? null;
}

/** Load a request and require `actorId` to be on a specific side of it. */
async function loadForActor(
  idOrReference: string,
  column: 'requester_id' | 'requestee_id',
  actorId: string
): Promise<RequestRow> {
  const row = await fetchRequest(idOrReference);
  if (!row) throw Errors.requestNotFound();
  if (row[column] !== actorId) throw Errors.forbidden();
  return row;
}

export const RequestService = {
  async create(input: {
    requesterId: string;
    requesteeId: string;
    amount: string | number;
    reason?: string | null;
  }) {
    if (input.requesterId === input.requesteeId) throw Errors.selfRequest();
    if (input.reason && input.reason.length > MAX_REASON_LENGTH) {
      throw Errors.invalidRequest(`Reason must be at most ${MAX_REASON_LENGTH} characters`);
    }

    let amountPaisa: bigint;
    try {
      amountPaisa = bdtToPaisa(input.amount);
    } catch (e) {
      if (e instanceof MoneyError) throw Errors.invalidAmount(e.message);
      throw e;
    }

    const requestee = await pool.query(
      `SELECT full_name, account_status FROM users WHERE id = $1`,
      [input.requesteeId]
    );
    if (requestee.rowCount === 0) throw Errors.userNotFound('Requestee not found');
    if (requestee.rows[0].account_status !== 'ACTIVE') throw Errors.receiverInactive();

    const requester = await pool.query(`SELECT full_name FROM users WHERE id = $1`, [
      input.requesterId,
    ]);

    const reference = newRequestReference();
    const { rows } = await pool.query<RequestRow>(
      `INSERT INTO money_requests
         (reference, requester_id, requestee_id, amount_paisa, reason, status, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW() + ($6 || ' days')::interval, NOW())
       RETURNING *`,
      [
        reference,
        input.requesterId,
        input.requesteeId,
        amountPaisa.toString(),
        input.reason ?? null,
        String(REQUEST_TTL_DAYS),
      ]
    );
    const row = rows[0];
    row.requester_name = requester.rows[0]?.full_name;
    row.requestee_name = requestee.rows[0].full_name;

    logger.info('money request created', { requestId: row.id, reference });

    NotificationService.emit({
      userId: input.requesteeId,
      type: 'REQUEST_RECEIVED',
      title: 'Money request received',
      message: `${row.requester_name} requested ${formatBdt(amountPaisa)}${
        input.reason ? ` — ${input.reason}` : ''
      }`,
      relatedRequestId: row.id,
    });

    return shape(row, input.requesterId);
  },

  /** Full detail for either party to a request. 404 if unknown, 403 if not a party. */
  async getForUser(idOrReference: string, userId: string) {
    const row = await fetchRequest(idOrReference);
    if (!row) throw Errors.requestNotFound();
    if (row.requester_id !== userId && row.requestee_id !== userId) {
      throw Errors.forbidden();
    }
    return shape(row, userId);
  },

  async approve(idOrReference: string, requesteeId: string) {
    const row = await loadForActor(idOrReference, 'requestee_id', requesteeId);
    if (row.status !== 'PENDING') throw Errors.requestNotPending();

    // Deterministic key => approving twice (retry or double-click) moves money once.
    // 'retry' so that approving again after topping up succeeds (the request is
    // still PENDING; a prior failed approval transfer is re-attempted).
    const transfer = await TransferService.execute({
      senderId: requesteeId,
      receiverId: row.requester_id,
      amount: row.amount_paisa,
      note: row.reason ? `Request approved: ${row.reason}` : 'Money request approved',
      idempotencyKey: `req-approve-${row.id}`,
      type: 'REQUEST_APPROVAL',
      onPriorFailure: 'retry',
    });

    const updated = await pool.query<RequestRow>(
      `UPDATE money_requests
          SET status = 'APPROVED', related_transfer_id = $2,
              approved_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING *`,
      [row.id, transfer.transfer_id]
    );
    // If another concurrent approve already flipped it, that's fine — money still
    // moved exactly once thanks to the deterministic idempotency key.
    const finalRow: RequestRow =
      updated.rows[0] ??
      ({
        ...row,
        status: 'APPROVED',
        related_transfer_id: transfer.transfer_id,
        approved_at: new Date(),
      } as RequestRow);
    finalRow.requester_name = row.requester_name;
    finalRow.requestee_name = row.requestee_name;
    finalRow.related_transfer_reference = transfer.reference;

    NotificationService.emit({
      userId: row.requester_id,
      type: 'REQUEST_APPROVED',
      title: 'Request approved',
      message: `${row.requestee_name} approved your ${formatBdt(row.amount_paisa)} request`,
      relatedRequestId: row.id,
      relatedTransferId: transfer.transfer_id,
    });

    return { request: shape(finalRow, requesteeId), transfer };
  },

  async reject(idOrReference: string, requesteeId: string, reason?: string | null) {
    if (reason && reason.length > MAX_REASON_LENGTH) {
      throw Errors.invalidRequest(`Reason must be at most ${MAX_REASON_LENGTH} characters`);
    }
    const row = await loadForActor(idOrReference, 'requestee_id', requesteeId);
    if (row.status !== 'PENDING') throw Errors.requestNotPending();

    const updated = await pool.query<RequestRow>(
      `UPDATE money_requests
          SET status = 'REJECTED', rejected_at = NOW(), rejection_reason = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING *`,
      [row.id, reason ?? null]
    );
    if (updated.rowCount === 0) throw Errors.requestNotPending();

    NotificationService.emit({
      userId: row.requester_id,
      type: 'REQUEST_REJECTED',
      title: 'Request rejected',
      message: `${row.requestee_name} rejected your ${formatBdt(row.amount_paisa)} request${
        reason ? ` — ${reason}` : ''
      }`,
      relatedRequestId: row.id,
    });

    const finalRow = updated.rows[0];
    finalRow.requester_name = row.requester_name;
    finalRow.requestee_name = row.requestee_name;
    return shape(finalRow, requesteeId);
  },

  async cancel(idOrReference: string, requesterId: string) {
    const row = await loadForActor(idOrReference, 'requester_id', requesterId);
    if (row.status !== 'PENDING') throw Errors.requestNotPending();

    const updated = await pool.query<RequestRow>(
      `UPDATE money_requests
          SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING *`,
      [row.id]
    );
    if (updated.rowCount === 0) throw Errors.requestNotPending();

    NotificationService.emit({
      userId: row.requestee_id,
      type: 'REQUEST_CANCELLED',
      title: 'Request cancelled',
      message: `${row.requester_name} cancelled their ${formatBdt(row.amount_paisa)} request`,
      relatedRequestId: row.id,
    });

    const finalRow = updated.rows[0];
    finalRow.requester_name = row.requester_name;
    finalRow.requestee_name = row.requestee_name;
    return shape(finalRow, requesterId);
  },

  async list(
    userId: string,
    opts: { direction?: 'sent' | 'received' | 'all'; status?: string } = {}
  ) {
    const params: any[] = [userId];
    const filters: string[] = ['(mr.requester_id = $1 OR mr.requestee_id = $1)'];
    if (opts.direction === 'sent') filters.push('mr.requester_id = $1');
    if (opts.direction === 'received') filters.push('mr.requestee_id = $1');
    if (opts.status && opts.status !== 'all') {
      params.push(opts.status);
      filters.push(`mr.status = $${params.length}`);
    }

    const { rows } = await pool.query<RequestRow>(
      `${SELECT_REQUEST} WHERE ${filters.join(' AND ')} ORDER BY mr.created_at DESC LIMIT 200`,
      params
    );

    const shaped = rows.map((r) => shape(r, userId));
    return {
      sent: shaped.filter((r) => r.direction === 'SENT'),
      received: shaped.filter((r) => r.direction === 'RECEIVED'),
    };
  },

  /** Marks overdue PENDING requests EXPIRED. Safe to call repeatedly. */
  async expireStale(): Promise<number> {
    const { rows } = await pool.query<RequestRow & { requester_name: string }>(
      `UPDATE money_requests mr
          SET status = 'EXPIRED', updated_at = NOW()
         FROM users u
        WHERE mr.requester_id = u.id
          AND mr.status = 'PENDING'
          AND mr.expires_at < NOW()
      RETURNING mr.id, mr.requester_id, mr.amount_paisa, u.full_name AS requester_name`,
      []
    );
    for (const r of rows) {
      NotificationService.emit({
        userId: r.requester_id,
        type: 'REQUEST_EXPIRED',
        title: 'Request expired',
        message: `Your ${formatBdt(r.amount_paisa)} request has expired`,
        relatedRequestId: r.id,
      });
    }
    if (rows.length > 0) logger.info('expired stale money requests', { count: rows.length });
    return rows.length;
  },
};

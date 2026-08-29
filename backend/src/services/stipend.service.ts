import { pool } from '../config/database';
import { NID_REGEX } from '../config/constants';
import { Errors } from '../utils/errors';
import { AppError } from '../utils/errors';
import { bdtToPaisa, formatBdt, MoneyError, paisaToBdtString } from '../utils/money';
import { newDisbursementReference, newStipendProgramReference } from '../utils/reference';
import { blindIndex, decryptField, encryptField } from '../utils/crypto';
import { logger } from '../utils/logger';
import { TransferService } from './transfer.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Category = 'STIPEND' | 'SCHOLARSHIP' | 'GRANT';

function parseAmount(input: string | number): bigint {
  try {
    return bdtToPaisa(input);
  } catch (e) {
    if (e instanceof MoneyError) throw Errors.invalidAmount(e.message);
    throw e;
  }
}

function programShape(row: any) {
  return {
    program_id: row.id,
    reference: row.reference,
    owner_id: row.owner_id,
    owner_name: row.owner_name ?? undefined,
    name: row.name,
    category: row.category as Category,
    description: row.description,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    beneficiary_count:
      row.beneficiary_count !== undefined ? Number(row.beneficiary_count) : undefined,
    disbursement_count:
      row.disbursement_count !== undefined ? Number(row.disbursement_count) : undefined,
    total_disbursed_paisa:
      row.total_disbursed_paisa !== undefined ? String(row.total_disbursed_paisa) : undefined,
    total_disbursed_bdt:
      row.total_disbursed_paisa !== undefined
        ? paisaToBdtString(row.total_disbursed_paisa)
        : undefined,
  };
}

function beneficiaryShape(row: any) {
  return {
    beneficiary_id: row.id,
    program_id: row.program_id,
    user_id: row.user_id,
    user_name: row.user_name,
    user_email: row.user_email,
    account_status: row.account_status,
    guardian_nid: row.guardian_nid,
    institution_name: row.institution_name,
    default_amount_paisa: row.default_amount_paisa ? String(row.default_amount_paisa) : null,
    default_amount_bdt: row.default_amount_paisa
      ? paisaToBdtString(row.default_amount_paisa)
      : null,
    status: row.status,
    eligible: row.status === 'ACTIVE' && row.account_status === 'ACTIVE' && !!row.guardian_nid,
    enrolled_at: row.enrolled_at,
    updated_at: row.updated_at,
  };
}

async function ownedProgram(idOrRef: string, ownerId: string) {
  const isUuid = UUID_RE.test(idOrRef);
  const { rows } = await pool.query(
    `SELECT * FROM stipend_programs WHERE ${isUuid ? 'id' : 'reference'} = $1`,
    [isUuid ? idOrRef : idOrRef.toUpperCase()]
  );
  if (rows.length === 0) throw Errors.programNotFound();
  if (rows[0].owner_id !== ownerId) throw Errors.forbidden();
  return rows[0];
}

export const StipendService = {
  async createProgram(
    ownerId: string,
    input: { name: string; category?: Category; description?: string | null }
  ) {
    const category: Category =
      input.category && ['STIPEND', 'SCHOLARSHIP', 'GRANT'].includes(input.category)
        ? input.category
        : 'STIPEND';
    const { rows } = await pool.query(
      `INSERT INTO stipend_programs (reference, owner_id, name, category, description, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        newStipendProgramReference(),
        ownerId,
        input.name.trim(),
        category,
        input.description?.trim() || null,
      ]
    );
    logger.info('stipend program created', { programId: rows[0].id, ownerId, category });
    return programShape(rows[0]);
  },

  async listPrograms(userId: string, role: string) {
    if (role === 'INSTITUTION') {
      const { rows } = await pool.query(
        `SELECT p.*,
                (SELECT COUNT(*) FROM stipend_beneficiaries b
                  WHERE b.program_id = p.id AND b.status = 'ACTIVE') AS beneficiary_count,
                (SELECT COUNT(*) FROM stipend_disbursements d WHERE d.program_id = p.id) AS disbursement_count,
                (SELECT COALESCE(SUM(d.total_amount_paisa), 0) FROM stipend_disbursements d
                  WHERE d.program_id = p.id) AS total_disbursed_paisa
           FROM stipend_programs p
          WHERE p.owner_id = $1
          ORDER BY p.created_at DESC`,
        [userId]
      );
      return { as: 'owner', programs: rows.map(programShape) };
    }

    const { rows } = await pool.query(
      `SELECT p.*, u.full_name AS owner_name,
              b.status AS my_status, b.institution_name, b.guardian_nid,
              b.default_amount_paisa
         FROM stipend_beneficiaries b
         JOIN stipend_programs p ON p.id = b.program_id
         JOIN users u ON u.id = p.owner_id
        WHERE b.user_id = $1 AND b.status <> 'REMOVED'
        ORDER BY p.created_at DESC`,
      [userId]
    );
    return {
      as: 'beneficiary',
      programs: rows.map((r) => ({
        ...programShape(r),
        my_enrollment: {
          status: r.my_status,
          institution_name: r.institution_name,
          guardian_nid: r.guardian_nid,
          default_amount_bdt: r.default_amount_paisa
            ? paisaToBdtString(r.default_amount_paisa)
            : null,
        },
      })),
    };
  },

  async getProgram(idOrRef: string, userId: string, role: string) {
    const isUuid = UUID_RE.test(idOrRef);
    const { rows } = await pool.query(
      `SELECT p.*, u.full_name AS owner_name,
              (SELECT COUNT(*) FROM stipend_beneficiaries b
                WHERE b.program_id = p.id AND b.status = 'ACTIVE') AS beneficiary_count,
              (SELECT COUNT(*) FROM stipend_disbursements d WHERE d.program_id = p.id) AS disbursement_count,
              (SELECT COALESCE(SUM(d.total_amount_paisa), 0) FROM stipend_disbursements d
                WHERE d.program_id = p.id) AS total_disbursed_paisa
         FROM stipend_programs p
         JOIN users u ON u.id = p.owner_id
        WHERE p.${isUuid ? 'id' : 'reference'} = $1`,
      [isUuid ? idOrRef : idOrRef.toUpperCase()]
    );
    if (rows.length === 0) throw Errors.programNotFound();
    const program = rows[0];
    const isOwner = program.owner_id === userId;

    const mine = await pool.query(
      `SELECT * FROM stipend_beneficiaries WHERE program_id = $1 AND user_id = $2`,
      [program.id, userId]
    );
    if (!isOwner && mine.rows.length === 0) throw Errors.forbidden();

    return {
      ...programShape(program),
      is_owner: isOwner,
      my_enrollment:
        mine.rows.length > 0
          ? {
              status: mine.rows[0].status,
              institution_name: mine.rows[0].institution_name,
              guardian_nid: mine.rows[0].guardian_nid,
              default_amount_bdt: mine.rows[0].default_amount_paisa
                ? paisaToBdtString(mine.rows[0].default_amount_paisa)
                : null,
            }
          : null,
    };
  },

  async closeProgram(idOrRef: string, ownerId: string) {
    const program = await ownedProgram(idOrRef, ownerId);
    const { rows } = await pool.query(
      `UPDATE stipend_programs SET status = 'CLOSED', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [program.id]
    );
    return programShape(rows[0]);
  },

  async enroll(
    programIdOrRef: string,
    ownerId: string,
    input: {
      user_id: string;
      guardian_nid: string;
      institution_name: string;
      default_amount_bdt?: string | number | null;
    }
  ) {
    const program = await ownedProgram(programIdOrRef, ownerId);
    if (program.status !== 'ACTIVE') throw Errors.programClosed();

    const guardianNid = String(input.guardian_nid || '').trim();
    if (!NID_REGEX.test(guardianNid)) throw Errors.nidRequired();

    const target = await pool.query(
      `SELECT id, full_name, account_status, role, nid_bidx FROM users WHERE id = $1`,
      [input.user_id]
    );
    if (target.rows.length === 0) throw Errors.userNotFound('Beneficiary account not found');
    const u = target.rows[0];
    if (u.role === 'INSTITUTION') throw Errors.cannotEnrollInstitution();
    if (u.nid_bidx && u.nid_bidx !== blindIndex(guardianNid)) throw Errors.nidMismatch();

    const defaultPaisa =
      input.default_amount_bdt !== undefined && input.default_amount_bdt !== null && input.default_amount_bdt !== ''
        ? parseAmount(input.default_amount_bdt)
        : null;

    // Bind the NID to the beneficiary account if it had none on file.
    if (!u.nid_bidx) {
      await pool.query(
        'UPDATE users SET nid_enc = $1, nid_bidx = $2, updated_at = NOW() WHERE id = $3',
        [encryptField(guardianNid), blindIndex(guardianNid), u.id]
      );
    }

    // Re-activate a previously removed enrollment instead of erroring.
    const existing = await pool.query(
      `SELECT * FROM stipend_beneficiaries WHERE program_id = $1 AND user_id = $2`,
      [program.id, u.id]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].status !== 'REMOVED') throw Errors.beneficiaryExists();
      const { rows } = await pool.query(
        `UPDATE stipend_beneficiaries
            SET status = 'ACTIVE', guardian_nid = $2, institution_name = $3,
                default_amount_paisa = $4, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [existing.rows[0].id, guardianNid, input.institution_name.trim(), defaultPaisa?.toString() ?? null]
      );
      return this.hydrateBeneficiary(rows[0]);
    }

    const { rows } = await pool.query(
      `INSERT INTO stipend_beneficiaries
         (program_id, user_id, guardian_nid, institution_name, default_amount_paisa, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        program.id,
        u.id,
        guardianNid,
        input.institution_name.trim(),
        defaultPaisa?.toString() ?? null,
      ]
    );
    logger.info('stipend beneficiary enrolled', { programId: program.id, userId: u.id });
    return this.hydrateBeneficiary(rows[0]);
  },

  async hydrateBeneficiary(row: any) {
    const { rows } = await pool.query(
      `SELECT b.*, u.full_name AS user_name, u.email AS user_email, u.account_status
         FROM stipend_beneficiaries b JOIN users u ON u.id = b.user_id
        WHERE b.id = $1`,
      [row.id]
    );
    return beneficiaryShape(rows[0]);
  },

  async listBeneficiaries(programIdOrRef: string, ownerId: string) {
    const program = await ownedProgram(programIdOrRef, ownerId);
    const { rows } = await pool.query(
      `SELECT b.*, u.full_name AS user_name, u.email AS user_email, u.account_status
         FROM stipend_beneficiaries b
         JOIN users u ON u.id = b.user_id
        WHERE b.program_id = $1 AND b.status <> 'REMOVED'
        ORDER BY u.full_name ASC`,
      [program.id]
    );
    return rows.map(beneficiaryShape);
  },

  async updateBeneficiary(
    programIdOrRef: string,
    beneficiaryId: string,
    ownerId: string,
    input: {
      status?: 'ACTIVE' | 'SUSPENDED';
      guardian_nid?: string;
      institution_name?: string;
      default_amount_bdt?: string | number | null;
    }
  ) {
    const program = await ownedProgram(programIdOrRef, ownerId);
    const found = await pool.query(
      `SELECT * FROM stipend_beneficiaries WHERE id = $1 AND program_id = $2`,
      [beneficiaryId, program.id]
    );
    if (found.rows.length === 0) throw Errors.beneficiaryNotFound();

    const sets: string[] = [];
    const params: any[] = [];
    if (input.status && ['ACTIVE', 'SUSPENDED'].includes(input.status)) {
      params.push(input.status);
      sets.push(`status = $${params.length}`);
    }
    if (input.guardian_nid !== undefined) {
      const nid = String(input.guardian_nid).trim();
      if (!NID_REGEX.test(nid)) throw Errors.nidRequired();
      params.push(nid);
      sets.push(`guardian_nid = $${params.length}`);
    }
    if (input.institution_name !== undefined) {
      params.push(input.institution_name.trim());
      sets.push(`institution_name = $${params.length}`);
    }
    if (input.default_amount_bdt !== undefined) {
      const val =
        input.default_amount_bdt === null || input.default_amount_bdt === ''
          ? null
          : parseAmount(input.default_amount_bdt).toString();
      params.push(val);
      sets.push(`default_amount_paisa = $${params.length}`);
    }
    if (sets.length === 0) return this.hydrateBeneficiary(found.rows[0]);

    params.push(beneficiaryId);
    const { rows } = await pool.query(
      `UPDATE stipend_beneficiaries SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} RETURNING *`,
      params
    );
    return this.hydrateBeneficiary(rows[0]);
  },

  async removeBeneficiary(programIdOrRef: string, beneficiaryId: string, ownerId: string) {
    const program = await ownedProgram(programIdOrRef, ownerId);
    const { rowCount } = await pool.query(
      `UPDATE stipend_beneficiaries SET status = 'REMOVED', updated_at = NOW()
        WHERE id = $1 AND program_id = $2 AND status <> 'REMOVED'`,
      [beneficiaryId, program.id]
    );
    if (rowCount === 0) throw Errors.beneficiaryNotFound();
    return { beneficiary_id: beneficiaryId, status: 'REMOVED' };
  },

  /* ============================================================
   *  Disbursement engine — resumable, guaranteed exactly-once
   * ============================================================
   *
   * Exactly-once rests on three layers:
   *   1. `stipend_disbursements` carries the client `idempotency_key`, UNIQUE
   *      per programme. Retrying a batch (or resuming a crashed one) always
   *      lands on the SAME disbursement id.
   *   2. Each item's transfer uses the deterministic key
   *      `dsb-<disbursementId>-<userId>`; `transfers` has UNIQUE(sender_id,
   *      idempotency_key), so a given beneficiary can be paid at most once.
   *   3. Before paying an item the engine checks whether that transfer already
   *      succeeded (crash between `execute()` committing and the item update),
   *      and just reconciles the row.
   *
   * A crash-recovery sweep (`resumeStuckDisbursements`) finishes any batch left
   * in PROCESSING even if the client never retries.
   */

  _running: new Set<string>(),

  async _findByKey(programId: string, key: string): Promise<{ id: string; status: string } | null> {
    const { rows } = await pool.query(
      `SELECT id, status FROM stipend_disbursements WHERE program_id = $1 AND idempotency_key = $2`,
      [programId, key]
    );
    return rows[0] ?? null;
  },

  /** Resolve (beneficiary, amount) targets for a standard disbursement. */
  async _resolveStandardTargets(
    program: any,
    input: {
      amount_bdt?: string | number | null;
      items?: Array<{ user_id: string; amount_bdt?: string | number }>;
    }
  ) {
    const flat =
      input.amount_bdt !== undefined && input.amount_bdt !== null && input.amount_bdt !== ''
        ? parseAmount(input.amount_bdt)
        : null;

    const beneficiaries = await pool.query(
      `SELECT b.*, u.full_name AS user_name, u.account_status
         FROM stipend_beneficiaries b JOIN users u ON u.id = b.user_id
        WHERE b.program_id = $1 AND b.status <> 'REMOVED'`,
      [program.id]
    );
    const byUser = new Map(beneficiaries.rows.map((r) => [r.user_id, r]));
    const targets: Array<{ beneficiary: any; userId: string; amountPaisa: bigint }> = [];

    if (input.items && input.items.length > 0) {
      for (const item of input.items) {
        const b = byUser.get(item.user_id);
        if (!b) throw Errors.beneficiaryNotFound();
        const amt =
          item.amount_bdt !== undefined && item.amount_bdt !== null && item.amount_bdt !== ''
            ? parseAmount(item.amount_bdt)
            : b.default_amount_paisa
              ? BigInt(b.default_amount_paisa)
              : flat;
        if (!amt || amt <= 0n) throw Errors.invalidAmount('Missing amount for a beneficiary');
        targets.push({ beneficiary: b, userId: b.user_id, amountPaisa: amt });
      }
    } else {
      for (const b of beneficiaries.rows) {
        const amt = b.default_amount_paisa ? BigInt(b.default_amount_paisa) : flat;
        if (!amt || amt <= 0n) {
          if (b.status === 'ACTIVE') {
            throw Errors.invalidAmount(
              `No amount for ${b.user_name}. Provide amount_bdt or a per-beneficiary default.`
            );
          }
          continue; // suspended + no amount — nothing to record
        }
        targets.push({ beneficiary: b, userId: b.user_id, amountPaisa: amt });
      }
    }
    if (targets.length === 0) throw Errors.noDisbursementTargets();
    return targets;
  },

  /**
   * Insert the disbursement + its item rows in one transaction.
   * Returns the new id, or `null` if a row for (program, key) already existed.
   */
  async _createDisbursement(args: {
    programId: string;
    initiatedBy: string;
    idempotencyKey: string;
    note: string | null;
    mode: 'STANDARD' | 'BULK';
    targets: Array<{ beneficiary: { id: string }; userId: string; amountPaisa: bigint }>;
    unresolved?: unknown[];
  }): Promise<string | null> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const disb = await client.query(
        `INSERT INTO stipend_disbursements
           (reference, program_id, initiated_by, idempotency_key, note, status, mode,
            total_count, unresolved, last_progress_at)
         VALUES ($1, $2, $3, $4, $5, 'PROCESSING', $6, $7, $8::jsonb, NOW())
         ON CONFLICT (program_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          newDisbursementReference(),
          args.programId,
          args.initiatedBy,
          args.idempotencyKey,
          args.note,
          args.mode,
          args.targets.length,
          JSON.stringify(args.unresolved ?? []),
        ]
      );
      if (disb.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const disbId = disb.rows[0].id;
      for (const t of args.targets) {
        await client.query(
          `INSERT INTO stipend_disbursement_items
             (disbursement_id, beneficiary_id, user_id, amount_paisa, status)
           VALUES ($1, $2, $3, $4, 'PENDING')
           ON CONFLICT (disbursement_id, user_id) DO NOTHING`,
          [disbId, t.beneficiary.id, t.userId, t.amountPaisa.toString()]
        );
      }
      await client.query('COMMIT');
      return disbId;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /** Recompute the disbursement's counters from its item rows. */
  async _flushProgress(disbId: string): Promise<void> {
    await pool.query(
      `UPDATE stipend_disbursements d SET
          success_count = s.paid, failed_count = s.failed, skipped_count = s.skipped,
          processed_count = s.done, total_amount_paisa = s.total, last_progress_at = NOW()
       FROM (
         SELECT
           COUNT(*) FILTER (WHERE status = 'PAID')::int    AS paid,
           COUNT(*) FILTER (WHERE status = 'FAILED')::int  AS failed,
           COUNT(*) FILTER (WHERE status = 'SKIPPED')::int AS skipped,
           COUNT(*) FILTER (WHERE status IN ('PAID','FAILED','SKIPPED'))::int AS done,
           COALESCE(SUM(amount_paisa) FILTER (WHERE status = 'PAID'), 0) AS total
         FROM stipend_disbursement_items WHERE disbursement_id = $1
       ) s
       WHERE d.id = $1`,
      [disbId]
    );
  },

  async _finalize(disbId: string): Promise<void> {
    await this._flushProgress(disbId);
    await pool.query(
      `UPDATE stipend_disbursements SET
          status = CASE
            WHEN success_count = total_count THEN 'COMPLETED'
            WHEN success_count > 0            THEN 'PARTIAL'
            ELSE 'FAILED' END,
          completed_at = NOW()
        WHERE id = $1 AND status = 'PROCESSING'`,
      [disbId]
    );
    const { rows } = await pool.query(
      `SELECT status, success_count, failed_count, skipped_count, total_count
         FROM stipend_disbursements WHERE id = $1`,
      [disbId]
    );
    logger.info('stipend disbursement finalized', { disbursementId: disbId, ...rows[0] });
  },

  /**
   * Drive a PROCESSING disbursement to a terminal state. Idempotent and
   * re-entrant across process restarts: only items not yet terminal are touched,
   * and an already-succeeded transfer is reconciled rather than re-sent.
   */
  async _runDisbursement(disbId: string): Promise<void> {
    if (this._running.has(disbId)) return;
    this._running.add(disbId);
    try {
      const dRes = await pool.query(
        `SELECT d.*, p.owner_id, p.name AS program_name, p.category
           FROM stipend_disbursements d JOIN stipend_programs p ON p.id = d.program_id
          WHERE d.id = $1`,
        [disbId]
      );
      if (dRes.rows.length === 0) return;
      const d = dRes.rows[0];
      if (d.status !== 'PROCESSING') return;

      const ownerId = d.owner_id as string;
      const noteText =
        d.note || `${d.program_name} — ${String(d.category).toLowerCase()}`;

      const items = await pool.query(
        `SELECT i.id, i.user_id, i.amount_paisa,
                b.status AS beneficiary_status, b.guardian_nid,
                u.account_status
           FROM stipend_disbursement_items i
           JOIN stipend_beneficiaries b ON b.id = i.beneficiary_id
           JOIN users u ON u.id = i.user_id
          WHERE i.disbursement_id = $1 AND i.status IN ('PENDING', 'FAILED')`,
        [disbId]
      );

      let sinceFlush = 0;
      for (const it of items.rows) {
        const key = `dsb-${disbId}-${it.user_id}`;

        const already = await TransferService.getByIdempotencyKey(ownerId, key);
        if (already && already.status === 'COMPLETED') {
          await pool.query(
            `UPDATE stipend_disbursement_items
                SET status = 'PAID', transfer_id = $2, failure_reason = NULL WHERE id = $1`,
            [it.id, already.transfer_id]
          );
        } else {
          let status: 'PAID' | 'FAILED' | 'SKIPPED';
          let reason: string | null = null;
          let transferId: string | null = null;

          if (it.beneficiary_status !== 'ACTIVE') {
            status = 'SKIPPED';
            reason = 'BENEFICIARY_INACTIVE';
          } else if (it.account_status !== 'ACTIVE') {
            status = 'SKIPPED';
            reason = 'ACCOUNT_INACTIVE';
          } else if (!it.guardian_nid || !NID_REGEX.test(it.guardian_nid)) {
            status = 'SKIPPED';
            reason = 'NID_MISSING';
          } else {
            try {
              const transfer = await TransferService.execute({
                senderId: ownerId,
                receiverId: it.user_id,
                amount: BigInt(it.amount_paisa),
                note: noteText,
                idempotencyKey: key,
                type: 'STIPEND',
                // A resume should genuinely re-attempt a previously-failed payment
                // (e.g. the programme wallet has since been topped up).
                onPriorFailure: 'retry',
              });
              status = 'PAID';
              transferId = transfer.transfer_id;
            } catch (err) {
              status = 'FAILED';
              reason = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
            }
          }
          await pool.query(
            `UPDATE stipend_disbursement_items
                SET status = $2, failure_reason = $3, transfer_id = $4 WHERE id = $1`,
            [it.id, status, reason, transferId]
          );
        }

        if (++sinceFlush >= 20) {
          sinceFlush = 0;
          await this._flushProgress(disbId);
        }
      }

      await this._finalize(disbId);
    } finally {
      this._running.delete(disbId);
    }
  },

  /**
   * Standard payout. `idempotencyKey` makes it safe to retry: the same key
   * resumes the same disbursement instead of paying anyone twice.
   */
  async disburse(
    programIdOrRef: string,
    initiatedBy: string,
    idempotencyKey: string,
    input: {
      note?: string | null;
      amount_bdt?: string | number | null;
      items?: Array<{ user_id: string; amount_bdt?: string | number }>;
    }
  ) {
    const program = await ownedProgram(programIdOrRef, initiatedBy);

    const prior = await this._findByKey(program.id, idempotencyKey);
    if (prior) {
      if (prior.status === 'PROCESSING') await this._runDisbursement(prior.id);
      return this.getDisbursement(prior.id, initiatedBy);
    }

    if (program.status !== 'ACTIVE') throw Errors.programClosed();
    const targets = await this._resolveStandardTargets(program, input);
    const noteText =
      input.note?.trim() || `${program.name} — ${program.category.toLowerCase()}`;

    let disbId = await this._createDisbursement({
      programId: program.id,
      initiatedBy,
      idempotencyKey,
      note: noteText,
      mode: 'STANDARD',
      targets,
    });
    if (disbId === null) {
      const again = await this._findByKey(program.id, idempotencyKey);
      if (!again) throw Errors.internal('Failed to create disbursement');
      disbId = again.id;
    }

    await this._runDisbursement(disbId);
    return this.getDisbursement(disbId, initiatedBy);
  },

  /**
   * Bulk / roster disbursement. Accepts up to a few thousand rows identified by
   * `user_id`, `email` or `nid`. With `dry_run` it only returns the resolution
   * plan. Otherwise it creates the batch and processes it in the background —
   * poll `GET /stipend-disbursements/:ref` for progress.
   */
  async bulkDisburse(
    programIdOrRef: string,
    initiatedBy: string,
    idempotencyKey: string | null,
    input: {
      note?: string | null;
      default_amount_bdt?: string | number | null;
      default_institution_name?: string | null;
      auto_enroll?: boolean;
      dry_run?: boolean;
      rows: Array<{
        user_id?: string;
        email?: string;
        nid?: string;
        guardian_nid?: string;
        institution_name?: string;
        amount_bdt?: string | number;
      }>;
    }
  ) {
    const program = await ownedProgram(programIdOrRef, initiatedBy);

    if (!input.dry_run && idempotencyKey) {
      const prior = await this._findByKey(program.id, idempotencyKey);
      if (prior) {
        if (prior.status === 'PROCESSING') {
          void this._runDisbursement(prior.id).catch((e) =>
            logger.error('resume on replay failed', e, { disbursementId: prior.id })
          );
        }
        return { ...(await this.getDisbursement(prior.id, initiatedBy)), replayed: true };
      }
    }
    if (!input.dry_run && program.status !== 'ACTIVE') throw Errors.programClosed();

    const flat =
      input.default_amount_bdt != null && input.default_amount_bdt !== ''
        ? parseAmount(input.default_amount_bdt)
        : null;

    const bens = await pool.query(
      `SELECT b.id, b.user_id, b.status, b.default_amount_paisa
         FROM stipend_beneficiaries b
        WHERE b.program_id = $1 AND b.status <> 'REMOVED'`,
      [program.id]
    );
    const benByUser = new Map(bens.rows.map((r) => [r.user_id, r]));

    const emails = [
      ...new Set(input.rows.map((r) => r.email?.trim().toLowerCase()).filter(Boolean)),
    ] as string[];
    const nids = [...new Set(input.rows.map((r) => r.nid?.trim()).filter(Boolean))] as string[];
    const nidBidx = nids.map((n) => blindIndex(n));
    const ids = [...new Set(input.rows.map((r) => r.user_id).filter(Boolean))] as string[];

    const uRes = await pool.query(
      `SELECT id, full_name, email, nid_enc, nid_bidx, account_status, role FROM users
        WHERE id = ANY($1::uuid[]) OR LOWER(email) = ANY($2::text[]) OR nid_bidx = ANY($3::text[])
        ORDER BY created_at ASC`,
      [ids, emails, nidBidx]
    );
    // NID is not a unique column; if several accounts share one, the newest wins.
    const byId = new Map(uRes.rows.map((u) => [u.id, u]));
    const byEmail = new Map(
      uRes.rows.filter((u) => u.email).map((u) => [u.email.toLowerCase(), u])
    );
    const byNid = new Map(uRes.rows.filter((u) => u.nid_bidx).map((u) => [u.nid_bidx, u]));

    type Resolved = {
      beneficiaryId: string;
      userId: string;
      userName: string;
      amountPaisa: bigint;
      enroll?: { guardianNid: string; institution: string };
    };
    const resolved: Resolved[] = [];
    const unresolved: Array<{ row: unknown; reason: string }> = [];
    const seen = new Set<string>();

    for (const row of input.rows) {
      const u =
        (row.user_id && byId.get(row.user_id)) ||
        (row.email && byEmail.get(row.email.trim().toLowerCase())) ||
        (row.nid && byNid.get(blindIndex(row.nid.trim()))) ||
        null;
      if (!u) {
        unresolved.push({ row, reason: 'ACCOUNT_NOT_FOUND' });
        continue;
      }
      if (u.role === 'INSTITUTION') {
        unresolved.push({ row, reason: 'INSTITUTION_ACCOUNT' });
        continue;
      }
      if (seen.has(u.id)) {
        unresolved.push({ row, reason: 'DUPLICATE_ROW' });
        continue;
      }

      const ben = benByUser.get(u.id);
      const rowAmt =
        row.amount_bdt != null && row.amount_bdt !== '' ? parseAmount(row.amount_bdt) : null;

      if (ben) {
        const amt = rowAmt ?? (ben.default_amount_paisa ? BigInt(ben.default_amount_paisa) : flat);
        if (!amt || amt <= 0n) {
          unresolved.push({ row, reason: 'NO_AMOUNT' });
          continue;
        }
        seen.add(u.id);
        resolved.push({ beneficiaryId: ben.id, userId: u.id, userName: u.full_name, amountPaisa: amt });
        continue;
      }

      if (!input.auto_enroll) {
        unresolved.push({ row, reason: 'NOT_ENROLLED' });
        continue;
      }
      const uNid = decryptField(u.nid_enc);
      const gNid = (row.guardian_nid || uNid || '').trim();
      const inst = (row.institution_name || input.default_institution_name || '').trim();
      if (!NID_REGEX.test(gNid)) {
        unresolved.push({ row, reason: 'NID_MISSING' });
        continue;
      }
      if (uNid && uNid !== gNid) {
        unresolved.push({ row, reason: 'NID_MISMATCH' });
        continue;
      }
      if (!inst) {
        unresolved.push({ row, reason: 'INSTITUTION_REQUIRED' });
        continue;
      }
      const amt = rowAmt ?? flat;
      if (!amt || amt <= 0n) {
        unresolved.push({ row, reason: 'NO_AMOUNT' });
        continue;
      }
      seen.add(u.id);
      resolved.push({
        beneficiaryId: '',
        userId: u.id,
        userName: u.full_name,
        amountPaisa: amt,
        enroll: { guardianNid: gNid, institution: inst },
      });
    }

    const totalPaisa = resolved.reduce((a, r) => a + r.amountPaisa, 0n);

    if (input.dry_run) {
      return {
        dry_run: true,
        program_reference: program.reference,
        resolved_count: resolved.length,
        unresolved_count: unresolved.length,
        will_auto_enroll: resolved.filter((r) => r.enroll).length,
        total_amount_paisa: totalPaisa.toString(),
        total_amount_bdt: paisaToBdtString(totalPaisa),
        resolved: resolved.map((r) => ({
          user_id: r.userId,
          user_name: r.userName,
          amount_bdt: paisaToBdtString(r.amountPaisa),
          new_beneficiary: !!r.enroll,
        })),
        unresolved,
      };
    }

    if (!idempotencyKey) throw Errors.missingIdempotencyKey();
    if (resolved.length === 0) throw Errors.noDisbursementTargets();

    // Enrol the auto-enrol set before creating the batch.
    for (const r of resolved.filter((x) => x.enroll)) {
      try {
        const b = await this.enroll(program.id, initiatedBy, {
          user_id: r.userId,
          guardian_nid: r.enroll!.guardianNid,
          institution_name: r.enroll!.institution,
        });
        r.beneficiaryId = b.beneficiary_id;
      } catch (err) {
        unresolved.push({
          row: { user_id: r.userId },
          reason: err instanceof AppError ? err.code : 'ENROLL_FAILED',
        });
        r.beneficiaryId = '__DROP__';
      }
    }
    const finalTargets = resolved.filter((r) => r.beneficiaryId && r.beneficiaryId !== '__DROP__');
    if (finalTargets.length === 0) throw Errors.noDisbursementTargets();

    const noteText =
      input.note?.trim() || `${program.name} — ${program.category.toLowerCase()}`;

    let disbId = await this._createDisbursement({
      programId: program.id,
      initiatedBy,
      idempotencyKey,
      note: noteText,
      mode: 'BULK',
      unresolved,
      targets: finalTargets.map((r) => ({
        beneficiary: { id: r.beneficiaryId },
        userId: r.userId,
        amountPaisa: r.amountPaisa,
      })),
    });
    if (disbId === null) {
      const again = await this._findByKey(program.id, idempotencyKey);
      if (!again) throw Errors.internal('Failed to create disbursement');
      disbId = again.id;
    }

    const runId = disbId;
    setImmediate(() => {
      this._runDisbursement(runId).catch((e) =>
        logger.error('bulk disbursement run failed', e, { disbursementId: runId })
      );
    });

    return { ...(await this.getDisbursement(disbId, initiatedBy)), async: true };
  },

  /**
   * Crash recovery: finish any batch stuck in PROCESSING whose progress has
   * stalled. Safe to call on a timer — deterministic keys guarantee no double
   * payments even if this races the original run.
   */
  async resumeStuckDisbursements(): Promise<number> {
    // A healthy run flushes progress every ~20 items, so a batch whose
    // `last_progress_at` is this stale has lost its runner.
    const { rows } = await pool.query(
      `SELECT id FROM stipend_disbursements
        WHERE status = 'PROCESSING'
          AND COALESCE(last_progress_at, created_at) < NOW() - INTERVAL '90 seconds'`
    );
    let resumed = 0;
    for (const r of rows) {
      if (this._running.has(r.id)) continue;
      resumed += 1;
      logger.warn('resuming interrupted disbursement', { disbursementId: r.id });
      void this._runDisbursement(r.id).catch((e) =>
        logger.error('resume failed', e, { disbursementId: r.id })
      );
    }
    return resumed;
  },

  async listDisbursements(programIdOrRef: string, ownerId: string) {
    const program = await ownedProgram(programIdOrRef, ownerId);
    const { rows } = await pool.query(
      `SELECT * FROM stipend_disbursements WHERE program_id = $1 ORDER BY created_at DESC`,
      [program.id]
    );
    return rows.map((d) => ({
      disbursement_id: d.id,
      reference: d.reference,
      program_id: d.program_id,
      mode: d.mode,
      note: d.note,
      status: d.status,
      total_count: d.total_count,
      processed_count: d.processed_count,
      success_count: d.success_count,
      failed_count: d.failed_count,
      skipped_count: d.skipped_count,
      unresolved_count: Array.isArray(d.unresolved) ? d.unresolved.length : 0,
      total_amount_paisa: String(d.total_amount_paisa),
      total_amount_bdt: paisaToBdtString(d.total_amount_paisa),
      created_at: d.created_at,
      completed_at: d.completed_at,
    }));
  },

  async getDisbursement(idOrRef: string, ownerId: string) {
    const isUuid = UUID_RE.test(idOrRef);
    const { rows } = await pool.query(
      `SELECT d.*, p.owner_id, p.name AS program_name, p.category
         FROM stipend_disbursements d
         JOIN stipend_programs p ON p.id = d.program_id
        WHERE d.${isUuid ? 'id' : 'reference'} = $1`,
      [isUuid ? idOrRef : idOrRef.toUpperCase()]
    );
    if (rows.length === 0) throw Errors.disbursementNotFound();
    const d = rows[0];
    if (d.owner_id !== ownerId) throw Errors.forbidden();

    const items = await pool.query(
      `SELECT i.*, u.full_name AS user_name, t.reference AS transfer_reference
         FROM stipend_disbursement_items i
         JOIN users u ON u.id = i.user_id
         LEFT JOIN transfers t ON t.id = i.transfer_id
        WHERE i.disbursement_id = $1
        ORDER BY u.full_name ASC`,
      [d.id]
    );

    return {
      disbursement_id: d.id,
      reference: d.reference,
      program_id: d.program_id,
      program_name: d.program_name,
      category: d.category,
      mode: d.mode,
      note: d.note,
      status: d.status,
      total_count: d.total_count,
      processed_count: d.processed_count,
      success_count: d.success_count,
      failed_count: d.failed_count,
      skipped_count: d.skipped_count,
      total_amount_paisa: String(d.total_amount_paisa),
      total_amount_bdt: paisaToBdtString(d.total_amount_paisa),
      unresolved: Array.isArray(d.unresolved) ? d.unresolved : [],
      unresolved_count: Array.isArray(d.unresolved) ? d.unresolved.length : 0,
      created_at: d.created_at,
      completed_at: d.completed_at,
      items: items.rows.map((i) => ({
        item_id: i.id,
        user_id: i.user_id,
        user_name: i.user_name,
        amount_paisa: String(i.amount_paisa),
        amount_bdt: paisaToBdtString(i.amount_paisa),
        amount_display: formatBdt(i.amount_paisa),
        status: i.status,
        failure_reason: i.failure_reason,
        transfer_id: i.transfer_id,
        transfer_reference: i.transfer_reference,
      })),
    };
  },

  /** A beneficiary's own view: stipend payments received + programmes enrolled in. */
  async receivedForUser(userId: string) {
    const payments = await pool.query(
      `SELECT t.id, t.reference, t.amount_paisa, t.note, t.created_at,
              s.full_name AS from_name, p.name AS program_name, p.category, p.reference AS program_reference
         FROM transfers t
         JOIN users s ON s.id = t.sender_id
         LEFT JOIN stipend_disbursement_items i ON i.transfer_id = t.id
         LEFT JOIN stipend_disbursements d ON d.id = i.disbursement_id
         LEFT JOIN stipend_programs p ON p.id = d.program_id
        WHERE t.receiver_id = $1 AND t.type = 'STIPEND' AND t.status = 'COMPLETED'
        ORDER BY t.created_at DESC
        LIMIT 200`,
      [userId]
    );

    const enrollments = await pool.query(
      `SELECT p.name AS program_name, p.reference AS program_reference, p.category,
              u.full_name AS owner_name, b.status, b.institution_name, b.guardian_nid,
              b.default_amount_paisa, b.enrolled_at
         FROM stipend_beneficiaries b
         JOIN stipend_programs p ON p.id = b.program_id
         JOIN users u ON u.id = p.owner_id
        WHERE b.user_id = $1 AND b.status <> 'REMOVED'
        ORDER BY b.enrolled_at DESC`,
      [userId]
    );

    const totalReceived = payments.rows.reduce((acc, r) => acc + BigInt(r.amount_paisa), 0n);

    return {
      total_received_paisa: totalReceived.toString(),
      total_received_bdt: paisaToBdtString(totalReceived),
      payments: payments.rows.map((r) => ({
        transfer_id: r.id,
        reference: r.reference,
        amount_bdt: paisaToBdtString(r.amount_paisa),
        amount_display: formatBdt(r.amount_paisa),
        note: r.note,
        from_name: r.from_name,
        program_name: r.program_name,
        program_reference: r.program_reference,
        category: r.category,
        created_at: r.created_at,
        fee_bdt: '0.00',
      })),
      enrollments: enrollments.rows.map((r) => ({
        program_name: r.program_name,
        program_reference: r.program_reference,
        category: r.category,
        owner_name: r.owner_name,
        status: r.status,
        institution_name: r.institution_name,
        guardian_nid: r.guardian_nid,
        default_amount_bdt: r.default_amount_paisa
          ? paisaToBdtString(r.default_amount_paisa)
          : null,
        enrolled_at: r.enrolled_at,
      })),
    };
  },
};

import { pool, withSerializableTransaction } from '../config/database';
import { AppError, Errors } from '../utils/errors';
import { bdtToPaisa, formatBdt, MoneyError, paisaToBdtString } from '../utils/money';
import {
  newDebtGroupReference,
  newDebtReference,
  newSettlementReference,
} from '../utils/reference';
import {
  computeNetBalances,
  optimizeSettlement,
  planHash,
  type DebtEdge,
} from '../utils/settlement';
import { logger } from '../utils/logger';
import { TransferService } from './transfer.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DEBT = 9_000_000_000_000n;

function parseAmount(input: string | number): bigint {
  try {
    const p = bdtToPaisa(input);
    if (p > MAX_DEBT) throw new MoneyError('Amount too large');
    return p;
  } catch (e) {
    if (e instanceof MoneyError) throw Errors.invalidAmount(e.message);
    throw e;
  }
}

function balanceRole(net: bigint): 'CREDITOR' | 'DEBTOR' | 'SETTLED' {
  return net > 0n ? 'CREDITOR' : net < 0n ? 'DEBTOR' : 'SETTLED';
}

interface GroupRow {
  id: string;
  reference: string;
  name: string;
  created_by: string;
  created_at: Date;
}

async function loadGroup(idOrRef: string): Promise<GroupRow> {
  const isUuid = UUID_RE.test(idOrRef);
  const { rows } = await pool.query<GroupRow>(
    `SELECT * FROM debt_groups WHERE ${isUuid ? 'id' : 'reference'} = $1`,
    [isUuid ? idOrRef : idOrRef.toUpperCase()]
  );
  if (rows.length === 0) throw Errors.groupNotFound();
  return rows[0];
}

async function assertMember(groupId: string, userId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM debt_group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (!rowCount) throw Errors.notGroupMember();
}

async function memberIdSet(groupId: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM debt_group_members WHERE group_id = $1`,
    [groupId]
  );
  return new Set(rows.map((r) => r.user_id));
}

async function pendingDebts(groupId: string): Promise<
  { id: string; debtor_id: string; creditor_id: string; amount_paisa: bigint }[]
> {
  const { rows } = await pool.query(
    `SELECT id, debtor_id, creditor_id, amount_paisa
       FROM debts WHERE group_id = $1 AND status = 'PENDING'`,
    [groupId]
  );
  return rows;
}

async function nameMap(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { rows } = await pool.query<{ id: string; full_name: string }>(
    `SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`,
    [[...new Set(ids)]]
  );
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

function balancesFromDebts(
  edges: DebtEdge[],
  members: { user_id: string; full_name: string }[]
) {
  const net = computeNetBalances(edges);
  return members
    .map((m) => {
      const v = net.get(m.user_id) ?? 0n;
      return {
        user_id: m.user_id,
        full_name: m.full_name,
        net_paisa: v.toString(),
        net_bdt: paisaToBdtString(v),
        net_display: `${v < 0n ? '-' : ''}${formatBdt(v < 0n ? -v : v)}`,
        role: balanceRole(v),
      };
    })
    .sort((a, b) => Number(BigInt(b.net_paisa) - BigInt(a.net_paisa)));
}

async function groupMembers(groupId: string) {
  const { rows } = await pool.query<{ user_id: string; full_name: string; email: string; added_at: Date }>(
    `SELECT m.user_id, u.full_name, u.email, m.added_at
       FROM debt_group_members m JOIN users u ON u.id = m.user_id
      WHERE m.group_id = $1
      ORDER BY u.full_name ASC`,
    [groupId]
  );
  return rows;
}

export const DebtService = {
  async createGroup(userId: string, input: { name: string; member_ids?: string[] }) {
    const ids = new Set<string>([userId, ...(input.member_ids ?? [])]);
    const active = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND account_status = 'ACTIVE'`,
      [[...ids]]
    );
    const activeIds = new Set(active.rows.map((r) => r.id));
    for (const id of ids) {
      if (!activeIds.has(id)) throw Errors.notAMember(`User ${id} not found or inactive`);
    }

    const group = await withSerializableTransaction(async (client) => {
      const g = await client.query<GroupRow>(
        `INSERT INTO debt_groups (reference, name, created_by, updated_at)
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        [newDebtGroupReference(), input.name.trim(), userId]
      );
      for (const id of ids) {
        await client.query(
          `INSERT INTO debt_group_members (group_id, user_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [g.rows[0].id, id]
        );
      }
      return g.rows[0];
    });
    logger.info('debt group created', { groupId: group.id, members: ids.size });
    return this.getGroup(group.id, userId);
  },

  async listGroups(userId: string) {
    const { rows } = await pool.query(
      `SELECT g.id, g.reference, g.name, g.created_at,
              (SELECT COUNT(*) FROM debt_group_members m WHERE m.group_id = g.id) AS member_count
         FROM debt_groups g
         JOIN debt_group_members me ON me.group_id = g.id AND me.user_id = $1
        ORDER BY g.created_at DESC`,
      [userId]
    );
    const result = [];
    for (const g of rows) {
      const edges = (await pendingDebts(g.id)) as DebtEdge[];
      const net = computeNetBalances(edges);
      const mine = net.get(userId) ?? 0n;
      const outstanding = edges.reduce((a, e) => a + e.amount_paisa, 0n);
      result.push({
        group_id: g.id,
        reference: g.reference,
        name: g.name,
        member_count: Number(g.member_count),
        created_at: g.created_at,
        total_outstanding_bdt: paisaToBdtString(outstanding),
        my_net_paisa: mine.toString(),
        my_net_bdt: paisaToBdtString(mine),
        my_role: balanceRole(mine),
      });
    }
    return result;
  },

  async getGroup(idOrRef: string, userId: string) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);

    const members = await groupMembers(group.id);
    const debtsRes = await pool.query(
      `SELECT d.id, d.reference, d.debtor_id, d.creditor_id, d.amount_paisa, d.description,
              d.kind, d.status, d.settlement_id, d.created_at,
              dr.full_name AS debtor_name, cr.full_name AS creditor_name,
              s.reference AS settlement_reference
         FROM debts d
         JOIN users dr ON dr.id = d.debtor_id
         JOIN users cr ON cr.id = d.creditor_id
         LEFT JOIN debt_settlements s ON s.id = d.settlement_id
        WHERE d.group_id = $1
        ORDER BY d.created_at DESC`,
      [group.id]
    );

    const pending = (await pendingDebts(group.id)) as DebtEdge[];
    const outstanding = pending.reduce((a, e) => a + e.amount_paisa, 0n);

    return {
      group_id: group.id,
      reference: group.reference,
      name: group.name,
      created_by: group.created_by,
      created_at: group.created_at,
      members: members.map((m) => ({
        user_id: m.user_id,
        full_name: m.full_name,
        email: m.email,
      })),
      balances: balancesFromDebts(pending, members),
      outstanding: {
        total_paisa: outstanding.toString(),
        total_bdt: paisaToBdtString(outstanding),
        pending_debt_count: pending.length,
      },
      debts: debtsRes.rows.map((d) => ({
        debt_id: d.id,
        reference: d.reference,
        debtor_id: d.debtor_id,
        debtor_name: d.debtor_name,
        creditor_id: d.creditor_id,
        creditor_name: d.creditor_name,
        amount_bdt: paisaToBdtString(d.amount_paisa),
        amount_display: formatBdt(d.amount_paisa),
        description: d.description,
        kind: d.kind,
        status: d.status,
        settlement_reference: d.settlement_reference,
        created_at: d.created_at,
      })),
    };
  },

  async addMember(idOrRef: string, userId: string, targetUserId: string) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);
    const u = await pool.query(
      `SELECT 1 FROM users WHERE id = $1 AND account_status = 'ACTIVE'`,
      [targetUserId]
    );
    if (!u.rowCount) throw Errors.userNotFound('That user cannot be added');
    await pool.query(
      `INSERT INTO debt_group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [group.id, targetUserId]
    );
    return this.getGroup(group.id, userId);
  },

  async addDebt(
    idOrRef: string,
    userId: string,
    input: {
      debtor_id: string;
      creditor_id: string;
      amount_bdt: string | number;
      description?: string | null;
    }
  ) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);
    if (input.debtor_id === input.creditor_id) {
      throw Errors.invalidRequest('A debt needs two different people');
    }
    const members = await memberIdSet(group.id);
    if (!members.has(input.debtor_id)) throw Errors.notAMember('Debtor is not in this group');
    if (!members.has(input.creditor_id)) throw Errors.notAMember('Creditor is not in this group');

    const amount = parseAmount(input.amount_bdt);
    const { rows } = await pool.query(
      `INSERT INTO debts
         (reference, group_id, debtor_id, creditor_id, amount_paisa, description, kind, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'DEBT', $7, NOW())
       RETURNING id`,
      [
        newDebtReference(),
        group.id,
        input.debtor_id,
        input.creditor_id,
        amount.toString(),
        input.description?.trim() || null,
        userId,
      ]
    );
    logger.info('debt recorded', { groupId: group.id, debtId: rows[0].id });
    return this.getGroup(group.id, userId);
  },

  /** An expense paid by one member, split equally among participants. */
  async addExpense(
    idOrRef: string,
    userId: string,
    input: {
      payer_id: string;
      amount_bdt: string | number;
      participant_ids: string[];
      description?: string | null;
    }
  ) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);
    const members = await memberIdSet(group.id);

    const participants = [...new Set(input.participant_ids)];
    if (participants.length < 1) throw Errors.invalidRequest('Add at least one participant');
    if (!members.has(input.payer_id)) throw Errors.notAMember('Payer is not in this group');
    for (const p of participants) {
      if (!members.has(p)) throw Errors.notAMember('A participant is not in this group');
    }

    const total = parseAmount(input.amount_bdt);
    const n = BigInt(participants.length);
    const base = total / n;
    let remainder = total % n;
    // deterministic remainder distribution: sorted participant ids get +1 paisa
    const ordered = [...participants].sort();
    const share = new Map<string, bigint>();
    for (const p of ordered) {
      let s = base;
      if (remainder > 0n) {
        s += 1n;
        remainder -= 1n;
      }
      share.set(p, s);
    }

    const created = await withSerializableTransaction(async (client) => {
      const ids: string[] = [];
      for (const p of participants) {
        if (p === input.payer_id) continue; // payer's own share isn't a debt
        const s = share.get(p)!;
        if (s <= 0n) continue;
        const r = await client.query(
          `INSERT INTO debts
             (reference, group_id, debtor_id, creditor_id, amount_paisa, description, kind, created_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'EXPENSE_SHARE', $7, NOW())
           RETURNING id`,
          [
            newDebtReference(),
            group.id,
            p,
            input.payer_id,
            s.toString(),
            input.description?.trim() || 'Shared expense',
            userId,
          ]
        );
        ids.push(r.rows[0].id);
      }
      return ids;
    });
    logger.info('expense split', { groupId: group.id, debts: created.length });
    return this.getGroup(group.id, userId);
  },

  async previewSettlement(idOrRef: string, userId: string) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);

    const pd = await pendingDebts(group.id);
    const edges = pd as DebtEdge[];
    const net = computeNetBalances(edges);
    const plan = optimizeSettlement(net);
    const members = await groupMembers(group.id);
    const names = new Map(members.map((m) => [m.user_id, m.full_name]));
    const outstanding = edges.reduce((a, e) => a + e.amount_paisa, 0n);

    return {
      group_reference: group.reference,
      total_outstanding_paisa: outstanding.toString(),
      total_outstanding_bdt: paisaToBdtString(outstanding),
      original_debt_count: pd.length,
      optimized_transfer_count: plan.length,
      transfers_saved: Math.max(pd.length - plan.length, 0),
      plan_hash: planHash(pd.map((d) => d.id), plan),
      plan: plan.map((p, i) => ({
        seq: i + 1,
        from_user: p.from,
        from_name: names.get(p.from) ?? 'Unknown',
        to_user: p.to,
        to_name: names.get(p.to) ?? 'Unknown',
        amount_paisa: p.amount_paisa.toString(),
        amount_bdt: paisaToBdtString(p.amount_paisa),
        amount_display: formatBdt(p.amount_paisa),
      })),
      balances: balancesFromDebts(edges, members),
    };
  },

  // ---- settlement execution (exactly-once, resumable) ------------------

  _running: new Set<string>(),

  async _findSettlementByKey(groupId: string, key: string) {
    const { rows } = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM debt_settlements WHERE group_id = $1 AND idempotency_key = $2`,
      [groupId, key]
    );
    return rows[0] ?? null;
  },

  async settle(
    idOrRef: string,
    userId: string,
    idempotencyKey: string,
    input: { plan_hash?: string }
  ) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);

    const prior = await this._findSettlementByKey(group.id, idempotencyKey);
    if (prior) {
      if (prior.status === 'PROCESSING') await this._run(prior.id);
      return this.getSettlement(prior.id, userId);
    }

    const settlementId = await withSerializableTransaction(async (client) => {
      // Lock the outstanding debts so no concurrent settlement can grab them.
      const locked = await client.query<{
        id: string;
        debtor_id: string;
        creditor_id: string;
        amount_paisa: bigint;
      }>(
        `SELECT id, debtor_id, creditor_id, amount_paisa
           FROM debts WHERE group_id = $1 AND status = 'PENDING'
           FOR UPDATE`,
        [group.id]
      );
      if (locked.rows.length === 0) throw Errors.nothingToSettle();

      const edges = locked.rows as DebtEdge[];
      const net = computeNetBalances(edges);
      const plan = optimizeSettlement(net);
      const computedHash = planHash(locked.rows.map((d) => d.id), plan);
      if (input.plan_hash && input.plan_hash !== computedHash) {
        throw Errors.settlementPlanStale();
      }
      if (plan.length === 0) throw Errors.nothingToSettle();

      const outstanding = edges.reduce((a, e) => a + e.amount_paisa, 0n);
      const ins = await client.query<{ id: string }>(
        `INSERT INTO debt_settlements
           (reference, group_id, idempotency_key, initiated_by, status,
            total_outstanding_paisa, original_debt_count, optimized_transfer_count,
            plan_hash, last_progress_at)
         VALUES ($1, $2, $3, $4, 'PROCESSING', $5, $6, $7, $8, NOW())
         ON CONFLICT (group_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          newSettlementReference(),
          group.id,
          idempotencyKey,
          userId,
          outstanding.toString(),
          locked.rows.length,
          plan.length,
          computedHash,
        ]
      );
      if (ins.rows.length === 0) return null; // lost a race

      const sid = ins.rows[0].id;
      await client.query(
        `UPDATE debts SET status = 'PROCESSING', settlement_id = $1, updated_at = NOW()
          WHERE group_id = $2 AND status = 'PENDING'`,
        [sid, group.id]
      );
      let seq = 0;
      for (const line of plan) {
        seq += 1;
        await client.query(
          `INSERT INTO debt_settlement_transfers
             (settlement_id, seq, from_user, to_user, amount_paisa, status)
           VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
          [sid, seq, line.from, line.to, line.amount_paisa.toString()]
        );
      }
      return sid;
    });

    let sid = settlementId;
    if (sid === null) {
      const again = await this._findSettlementByKey(group.id, idempotencyKey);
      if (!again) throw Errors.internal('Could not create settlement');
      sid = again.id;
    }

    await this._run(sid);
    return this.getSettlement(sid, userId);
  },

  async _run(settlementId: string): Promise<void> {
    if (this._running.has(settlementId)) return;
    this._running.add(settlementId);
    try {
      const sRes = await pool.query(
        `SELECT s.*, g.name AS group_name FROM debt_settlements s
           JOIN debt_groups g ON g.id = s.group_id WHERE s.id = $1`,
        [settlementId]
      );
      if (sRes.rows.length === 0) return;
      const s = sRes.rows[0];
      if (s.status !== 'PROCESSING') return;
      const note = `Settlement · ${s.group_name} (${s.reference})`;

      const lines = await pool.query(
        `SELECT id, seq, from_user, to_user, amount_paisa
           FROM debt_settlement_transfers
          WHERE settlement_id = $1 AND status IN ('PENDING', 'FAILED')
          ORDER BY seq ASC`,
        [settlementId]
      );

      for (const ln of lines.rows) {
        const key = `stl-${settlementId}-${ln.seq}`;
        let status: 'COMPLETED' | 'FAILED' = 'FAILED';
        let reason: string | null = null;
        let transferId: string | null = null;

        const already = await TransferService.getByIdempotencyKey(ln.from_user, key);
        if (already && already.status === 'COMPLETED') {
          status = 'COMPLETED';
          transferId = already.transfer_id;
        } else {
          try {
            const t = await TransferService.execute({
              senderId: ln.from_user,
              receiverId: ln.to_user,
              amount: BigInt(ln.amount_paisa),
              note,
              idempotencyKey: key,
              type: 'TRANSFER',
              onPriorFailure: 'retry',
            });
            status = 'COMPLETED';
            transferId = t.transfer_id;
          } catch (err) {
            status = 'FAILED';
            reason = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
          }
        }

        await pool.query(
          `UPDATE debt_settlement_transfers
              SET status = $2, transfer_id = $3, failure_reason = $4
            WHERE id = $1`,
          [ln.id, status, transferId, reason]
        );
        await pool.query(
          `UPDATE debt_settlements SET last_progress_at = NOW() WHERE id = $1`,
          [settlementId]
        );
      }

      await this._finalize(settlementId);
    } finally {
      this._running.delete(settlementId);
    }
  },

  async _finalize(settlementId: string): Promise<void> {
    await withSerializableTransaction(async (client) => {
      const sRes = await client.query(
        `SELECT * FROM debt_settlements WHERE id = $1 FOR UPDATE`,
        [settlementId]
      );
      const s = sRes.rows[0];
      if (!s || s.status !== 'PROCESSING') return;

      const agg = await client.query<{ status: string; c: string }>(
        `SELECT status, COUNT(*)::text AS c FROM debt_settlement_transfers
          WHERE settlement_id = $1 GROUP BY status`,
        [settlementId]
      );
      const by = new Map(agg.rows.map((r) => [r.status, Number(r.c)]));
      const success = by.get('COMPLETED') ?? 0;
      const failed = by.get('FAILED') ?? 0;
      const total = s.optimized_transfer_count as number;
      const finalStatus =
        success === total ? 'COMPLETED' : success > 0 ? 'PARTIAL' : 'FAILED';

      if (finalStatus === 'COMPLETED') {
        await client.query(
          `UPDATE debts SET status = 'COMPLETED', updated_at = NOW()
            WHERE settlement_id = $1 AND status = 'PROCESSING'`,
          [settlementId]
        );
      } else {
        // Revert the original debts (immutable audit — back to their prior state).
        await client.query(
          `UPDATE debts SET status = 'PENDING', settlement_id = NULL, updated_at = NOW()
            WHERE settlement_id = $1 AND status = 'PROCESSING'`,
          [settlementId]
        );
        if (finalStatus === 'PARTIAL') {
          // Record each completed transfer as a live payment so the group's net
          // balances reflect what actually moved.
          const done = await client.query(
            `SELECT from_user, to_user, amount_paisa
               FROM debt_settlement_transfers
              WHERE settlement_id = $1 AND status = 'COMPLETED'`,
            [settlementId]
          );
          for (const d of done.rows) {
            await client.query(
              `INSERT INTO debts
                 (reference, group_id, debtor_id, creditor_id, amount_paisa, description,
                  kind, status, settlement_id, created_by, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, 'SETTLEMENT_PAYMENT', 'PENDING', $7, $8, NOW())`,
              [
                newDebtReference(),
                s.group_id,
                d.to_user, // recipient now "owes" the payer in group terms
                d.from_user,
                d.amount_paisa,
                `Settlement payment · ${s.reference}`,
                settlementId,
                s.initiated_by,
              ]
            );
          }
        }
      }

      await client.query(
        `UPDATE debt_settlements
            SET status = $2, success_count = $3, failed_count = $4,
                completed_at = NOW(), last_progress_at = NOW()
          WHERE id = $1`,
        [settlementId, finalStatus, success, failed]
      );
    });
    logger.info('settlement finalized', { settlementId });
  },

  async getSettlement(idOrRef: string, userId: string) {
    const isUuid = UUID_RE.test(idOrRef);
    const sRes = await pool.query(
      `SELECT s.*, g.reference AS group_reference, g.name AS group_name
         FROM debt_settlements s JOIN debt_groups g ON g.id = s.group_id
        WHERE s.${isUuid ? 'id' : 'reference'} = $1`,
      [isUuid ? idOrRef : idOrRef.toUpperCase()]
    );
    if (sRes.rows.length === 0) throw Errors.settlementNotFound();
    const s = sRes.rows[0];
    await assertMember(s.group_id, userId);

    const lines = await pool.query(
      `SELECT t.seq, t.from_user, t.to_user, t.amount_paisa, t.status, t.failure_reason,
              t.transfer_id, tr.reference AS transfer_reference,
              fu.full_name AS from_name, tu.full_name AS to_name
         FROM debt_settlement_transfers t
         JOIN users fu ON fu.id = t.from_user
         JOIN users tu ON tu.id = t.to_user
         LEFT JOIN transfers tr ON tr.id = t.transfer_id
        WHERE t.settlement_id = $1
        ORDER BY t.seq ASC`,
      [s.id]
    );

    const members = await groupMembers(s.group_id);
    const resulting = balancesFromDebts((await pendingDebts(s.group_id)) as DebtEdge[], members);

    return {
      settlement_id: s.id,
      reference: s.reference,
      group_reference: s.group_reference,
      group_name: s.group_name,
      status: s.status,
      total_outstanding_bdt: paisaToBdtString(s.total_outstanding_paisa),
      original_debt_count: s.original_debt_count,
      optimized_transfer_count: s.optimized_transfer_count,
      success_count: s.success_count,
      failed_count: s.failed_count,
      created_at: s.created_at,
      completed_at: s.completed_at,
      transfers: lines.rows.map((l) => ({
        seq: l.seq,
        from_user: l.from_user,
        from_name: l.from_name,
        to_user: l.to_user,
        to_name: l.to_name,
        amount_bdt: paisaToBdtString(l.amount_paisa),
        amount_display: formatBdt(l.amount_paisa),
        status: l.status,
        failure_reason: l.failure_reason,
        transfer_reference: l.transfer_reference,
      })),
      resulting_balances: resulting,
    };
  },

  async listSettlements(idOrRef: string, userId: string) {
    const group = await loadGroup(idOrRef);
    await assertMember(group.id, userId);
    const { rows } = await pool.query(
      `SELECT id, reference, status, total_outstanding_paisa, original_debt_count,
              optimized_transfer_count, success_count, failed_count, created_at, completed_at
         FROM debt_settlements WHERE group_id = $1 ORDER BY created_at DESC`,
      [group.id]
    );
    return rows.map((s) => ({
      settlement_id: s.id,
      reference: s.reference,
      status: s.status,
      total_outstanding_bdt: paisaToBdtString(s.total_outstanding_paisa),
      original_debt_count: s.original_debt_count,
      optimized_transfer_count: s.optimized_transfer_count,
      success_count: s.success_count,
      failed_count: s.failed_count,
      created_at: s.created_at,
      completed_at: s.completed_at,
    }));
  },

  /** Crash recovery: finish any settlement stuck in PROCESSING. */
  async resumeStuckSettlements(): Promise<number> {
    const { rows } = await pool.query(
      `SELECT id FROM debt_settlements
        WHERE status = 'PROCESSING'
          AND COALESCE(last_progress_at, created_at) < NOW() - INTERVAL '90 seconds'`
    );
    let resumed = 0;
    for (const r of rows) {
      if (this._running.has(r.id)) continue;
      resumed += 1;
      logger.warn('resuming interrupted settlement', { settlementId: r.id });
      void this._run(r.id).catch((e) => logger.error('settlement resume failed', e));
    }
    return resumed;
  },
};

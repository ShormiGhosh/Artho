// Smart Debt Settlement — end-to-end.
const B = 'http://localhost:3000/api';
const j = async (p, o = {}) => {
  const r = await fetch(B + p, {
    ...o,
    headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let d = null;
  try { d = await r.json(); } catch {}
  return { s: r.status, d };
};
const rnd = () => Math.random().toString(36).slice(2, 10);
const H = (t) => ({ Authorization: `Bearer ${t}` });
const IK = () => `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const wal = async (t) => BigInt((await j('/wallet', { headers: H(t) })).d.data.wallet.balance_paisa);
const phone = () =>
  '01' + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const reg = async () => {
  const e = `stl_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'U' + rnd().slice(0, 4), phone: phone() },
  });
  const code = r.d.data.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(r.d.data.token), body: { code } });
  return { t: r.d.data.token, id: r.d.data.user_id };
};
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };
const netOf = (bals, id) => bals.find((b) => b.user_id === id)?.net_bdt;

const [A, C_, Bu, D, E, Gx] = await Promise.all([reg(), reg(), reg(), reg(), reg(), reg()]);
// name them A, B, C to match the spec example
const B_ = Bu;
const mkGroup = (owner, ids, name = 'G ' + rnd()) =>
  j('/debt-groups', { method: 'POST', headers: H(owner.t), body: { name, member_ids: ids } });
const addDebt = (owner, ref, debtor, creditor, amt, desc) =>
  j(`/debt-groups/${ref}/debts`, { method: 'POST', headers: H(owner.t), body: { debtor_id: debtor, creditor_id: creditor, amount_bdt: String(amt), description: desc } });

// =====================================================================
// 1. The spec example: A owes B 500, B owes C 800, C owes A 300
// =====================================================================
{
  const g = await mkGroup(A, [B_.id, C_.id], 'Trip');
  ck('create group -> 201 with GRP- reference', g.s === 201 && /^GRP-\d{8}-[A-F0-9]{8}$/.test(g.d.data.reference), g.d.data.reference);
  const ref = g.d.data.reference;
  await addDebt(A, ref, A.id, B_.id, 500, 'A owes B');
  await addDebt(A, ref, B_.id, C_.id, 800, 'B owes C');
  await addDebt(A, ref, C_.id, A.id, 300, 'C owes A');

  const grp = await j(`/debt-groups/${ref}`, { headers: H(B_.t) });
  // A owes B 500 (-500) and is owed 300 by C (+300) => net(A) = -200
  ck('net(A) = -200.00', netOf(grp.d.data.balances, A.id) === '-200.00',
    JSON.stringify(grp.d.data.balances.map((b) => [b.full_name, b.net_bdt])));
  ck('net(B) = -300.00', netOf(grp.d.data.balances, B_.id) === '-300.00', netOf(grp.d.data.balances, B_.id));
  ck('net(C) = 500.00', netOf(grp.d.data.balances, C_.id) === '500.00', netOf(grp.d.data.balances, C_.id));
  ck('net balances sum to zero', grp.d.data.balances.reduce((a, b) => a + Math.round(Number(b.net_bdt) * 100), 0) === 0);

  const pre = await j(`/debt-groups/${ref}/settlement-preview`, { headers: H(A.t) });
  ck('preview: total outstanding = 1600.00 (500+800+300)', pre.d.data.total_outstanding_bdt === '1600.00', pre.d.data.total_outstanding_bdt);
  ck('preview: original debt count 3', pre.d.data.original_debt_count === 3);
  ck('preview: optimized transfer count 2', pre.d.data.optimized_transfer_count === 2, String(pre.d.data.optimized_transfer_count));
  const planNorm = pre.d.data.plan.map((p) => `${p.from_user === A.id ? 'A' : p.from_user === B_.id ? 'B' : 'C'}->${p.to_user === A.id ? 'A' : p.to_user === B_.id ? 'B' : 'C'}:${p.amount_bdt}`).sort();
  ck('preview: plan is A->C 200 and B->C 300 (the spec answer)',
    JSON.stringify(planNorm) === JSON.stringify(['A->C:200.00', 'B->C:300.00']), JSON.stringify(planNorm));

  const aW = await wal(A.t), bW = await wal(B_.t), cW = await wal(C_.t);
  const KEY = IK();
  const st = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': KEY }, body: { plan_hash: pre.d.data.plan_hash },
  });
  ck('settle -> COMPLETED, 2/2 transfers', st.d.data.status === 'COMPLETED' && st.d.data.success_count === 2 && st.d.data.optimized_transfer_count === 2, JSON.stringify({ st: st.d.data.status, ok: st.d.data.success_count }));
  ck('settle: A debited 20000 paisa', aW - (await wal(A.t)) === 20000n, `${aW} -> ${await wal(A.t)}`);
  ck('settle: B debited 30000 paisa', bW - (await wal(B_.t)) === 30000n);
  ck('settle: C credited 50000 paisa', (await wal(C_.t)) - cW === 50000n);
  ck('settle: every resulting balance is SETTLED (0)', st.d.data.resulting_balances.every((b) => b.role === 'SETTLED' && b.net_bdt === '0.00'));
  ck('settle: each transfer line links a real TXN-', st.d.data.transfers.every((t) => /^TXN-/.test(t.transfer_reference || '')));

  const after = await j(`/debt-groups/${ref}`, { headers: H(A.t) });
  ck('original 3 debts preserved as audit, now COMPLETED', after.d.data.debts.filter((d) => d.kind !== 'SETTLEMENT_PAYMENT').length === 3 && after.d.data.debts.filter((d) => d.status === 'COMPLETED').length === 3);
  ck('original debt amounts unchanged', after.d.data.debts.some((d) => d.amount_bdt === '800.00') && after.d.data.debts.some((d) => d.amount_bdt === '500.00'));

  // idempotency
  const cW2 = await wal(C_.t);
  const stAgain = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': KEY }, body: {},
  });
  ck('same key -> returns the same settlement', stAgain.d.data.reference === st.d.data.reference);
  ck('same key -> no additional money moved', (await wal(C_.t)) === cW2);

  // nothing left to settle
  const empty = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': IK() }, body: {},
  });
  ck('settle with no pending debts -> 422 NOTHING_TO_SETTLE', empty.s === 422 && empty.d.error.code === 'NOTHING_TO_SETTLE', `s=${empty.s}`);
}

// =====================================================================
// 2. Stale plan detection (concurrent change between preview & confirm)
// =====================================================================
{
  const g = await mkGroup(A, [B_.id], 'Stale');
  const ref = g.d.data.reference;
  await addDebt(A, ref, A.id, B_.id, 100);
  const pre = await j(`/debt-groups/${ref}/settlement-preview`, { headers: H(A.t) });
  await addDebt(A, ref, B_.id, A.id, 40); // debts changed after preview
  const stale = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': IK() }, body: { plan_hash: pre.d.data.plan_hash },
  });
  ck('stale plan_hash -> 409 SETTLEMENT_PLAN_STALE', stale.s === 409 && stale.d.error.code === 'SETTLEMENT_PLAN_STALE', `s=${stale.s}`);
  const fresh = await j(`/debt-groups/${ref}/settlement-preview`, { headers: H(A.t) });
  const okSettle = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': IK() }, body: { plan_hash: fresh.d.data.plan_hash },
  });
  ck('re-preview then settle -> COMPLETED (net A owes B 60)', okSettle.d.data.status === 'COMPLETED' && okSettle.d.data.transfers[0].amount_bdt === '60.00', JSON.stringify(okSettle.d.data.transfers.map((t) => t.amount_bdt)));
}

// =====================================================================
// 3. Insufficient balance -> PARTIAL, originals reverted, residual recorded
// =====================================================================
{
  // D and E both owe Gx; D can pay, E cannot (debt > wallet)
  const g = await mkGroup(D, [E.id, Gx.id], 'Partial');
  const ref = g.d.data.reference;
  await addDebt(D, ref, D.id, Gx.id, 200, 'D can pay this');
  await addDebt(D, ref, E.id, Gx.id, 500000, 'E cannot pay this'); // 500000 BDT > 100000 wallet

  const pre = await j(`/debt-groups/${ref}/settlement-preview`, { headers: H(D.t) });
  ck('partial: preview optimized to 2 transfers', pre.d.data.optimized_transfer_count === 2);
  const dW = await wal(D.t), gW = await wal(Gx.t);
  const st = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(D.t), 'Idempotency-Key': IK() }, body: { plan_hash: pre.d.data.plan_hash },
  });
  ck('partial: settlement status PARTIAL (1 ok, 1 failed)', st.d.data.status === 'PARTIAL' && st.d.data.success_count === 1 && st.d.data.failed_count === 1, JSON.stringify({ s: st.d.data.status, ok: st.d.data.success_count, f: st.d.data.failed_count }));
  ck('partial: the failed line has INSUFFICIENT_BALANCE reason', st.d.data.transfers.some((t) => t.status === 'FAILED' && t.failure_reason === 'INSUFFICIENT_BALANCE'));
  ck('partial: D actually paid 20000 paisa', dW - (await wal(D.t)) === 20000n);
  ck('partial: Gx received only the 20000 that cleared', (await wal(Gx.t)) - gW === 20000n);

  const after = await j(`/debt-groups/${ref}`, { headers: H(D.t) });
  const origPending = after.d.data.debts.filter((d) => d.kind !== 'SETTLEMENT_PAYMENT');
  ck('partial: original debts reverted to PENDING (audit intact)', origPending.length === 2 && origPending.every((d) => d.status === 'PENDING'));
  ck('partial: a SETTLEMENT_PAYMENT record was added for the cleared transfer', after.d.data.debts.some((d) => d.kind === 'SETTLEMENT_PAYMENT' && d.amount_bdt === '200.00'));
  // net now: D settled, E still owes Gx 500000, Gx owed 500000
  ck('partial: residual balance — D is SETTLED', netOf(after.d.data.balances, D.id) === '0.00', netOf(after.d.data.balances, D.id));
  ck('partial: residual balance — E still owes 500000.00', netOf(after.d.data.balances, E.id) === '-500000.00', netOf(after.d.data.balances, E.id));
}

// =====================================================================
// 4. Concurrent settlement (different keys) — money moves once
// =====================================================================
{
  const g = await mkGroup(A, [B_.id], 'Concurrent');
  const ref = g.d.data.reference;
  await addDebt(A, ref, A.id, B_.id, 111);
  const bW = await wal(B_.t);
  const [c1, c2] = await Promise.all([
    j(`/debt-groups/${ref}/settle`, { method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': IK() }, body: {} }),
    j(`/debt-groups/${ref}/settle`, { method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': IK() }, body: {} }),
  ]);
  const completed = [c1, c2].filter((r) => r.d.data?.status === 'COMPLETED');
  const rejected = [c1, c2].filter((r) => r.s === 422);
  ck('concurrent: exactly one settlement completed', completed.length === 1, `${completed.length}`);
  ck('concurrent: the other got NOTHING_TO_SETTLE', rejected.length === 1, `codes=${[c1, c2].map((r) => r.s).join()}`);
  ck('concurrent: B credited exactly once (11100 paisa)', (await wal(B_.t)) - bW === 11100n, `${bW} -> ${await wal(B_.t)}`);
}

// =====================================================================
// 5. Expense split (equal), arbitrary group size, access control
// =====================================================================
{
  const g = await mkGroup(A, [B_.id, C_.id, D.id, E.id], 'Dinner5');
  const ref = g.d.data.reference;
  const exp = await j(`/debt-groups/${ref}/expenses`, {
    method: 'POST', headers: H(A.t),
    body: { payer_id: A.id, amount_bdt: '1000', participant_ids: [A.id, B_.id, C_.id, D.id, E.id], description: 'Dinner' },
  });
  const shares = exp.d.data.debts.filter((d) => d.kind === 'EXPENSE_SHARE');
  ck('expense split: 4 debts created (payer excluded)', shares.length === 4);
  ck('expense split: shares sum to 1000 and are ~200 each', shares.reduce((a, d) => a + Math.round(Number(d.amount_bdt) * 100), 0) === 80000, JSON.stringify(shares.map((d) => d.amount_bdt)));
  ck('expense split: every share creditor is the payer', shares.every((d) => d.creditor_id === A.id));

  const pre = await j(`/debt-groups/${ref}/settlement-preview`, { headers: H(A.t) });
  ck('expense split: optimized to <= 4 transfers (n-1)', pre.d.data.optimized_transfer_count <= 4 && pre.d.data.optimized_transfer_count >= 1);
  const st = await j(`/debt-groups/${ref}/settle`, {
    method: 'POST', headers: { ...H(A.t), 'Idempotency-Key': IK() }, body: { plan_hash: pre.d.data.plan_hash },
  });
  ck('expense split: settlement COMPLETED, all balances 0', st.d.data.status === 'COMPLETED' && st.d.data.resulting_balances.every((b) => b.net_bdt === '0.00'));

  // access control
  const outsider = Gx;
  ck('non-member cannot view the group -> 403', (await j(`/debt-groups/${ref}`, { headers: H(outsider.t) })).s === 403);
  ck('non-member cannot settle -> 403', (await j(`/debt-groups/${ref}/settle`, { method: 'POST', headers: { ...H(outsider.t), 'Idempotency-Key': IK() }, body: {} })).s === 403);
}

// =====================================================================
// invariant
// =====================================================================
{
  const inv = await j('/health/invariants');
  ck('system invariant: Σ wallets == Σ ledger, zero drift', inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));
}

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

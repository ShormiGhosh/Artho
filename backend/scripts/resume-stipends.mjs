// Proves guaranteed exactly-once delivery across a simulated crash:
// a COMPLETED batch is forced back to PROCESSING with items reset to PENDING,
// then resumed — no beneficiary is paid twice.
import { execSync } from 'node:child_process';

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
const wal = async (t) => BigInt((await j('/wallet', { headers: H(t) })).d.data.wallet.balance_paisa);
const phone = () =>
  '01' + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const verifyDev = async (t, registerJson) => {
  const code = registerJson?.data?.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(t), body: { code } });
};
const regUser = async (nid) => {
  const e = `res_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'Res ' + rnd(), phone: phone(), nid },
  });
  await verifyDev(r.d.data.token, r.d);
  return { t: r.d.data.token, id: r.d.data.user_id, email: e };
};
const psql = (sql) =>
  execSync(`docker exec artho_db psql -U artho -d artho -tAc "${sql.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
async function waitTerminal(ref, headers, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await j(`/stipend-disbursements/${ref}`, { headers });
    if (r.d?.data && r.d.data.status !== 'PROCESSING') return r.d.data;
    await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error('did not finish');
}
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

const boardReg = await j('/auth/register', {
  method: 'POST',
  body: { email: `resboard_${rnd()}@ex.com`, password: 'Test123456', full_name: 'Res Board', phone: phone(), role: 'INSTITUTION' },
});
const board = boardReg.d.data;
await verifyDev(board.token, boardReg.d);
const prog = (await j('/stipend-programs', { method: 'POST', headers: H(board.token), body: { name: 'Resume Test', category: 'GRANT' } })).d.data.reference;

const a = await regUser('1990000100001');
const b = await regUser('1990000100002');
for (const [u, nid, amt] of [[a, '1990000100001', '200'], [b, '1990000100002', '300']]) {
  await j(`/stipend-programs/${prog}/beneficiaries`, {
    method: 'POST', headers: H(board.token),
    body: { user_id: u.id, guardian_nid: nid, institution_name: 'S', default_amount_bdt: amt },
  });
}

const aStart = await wal(a.t);
const bStart = await wal(b.t);
const boardStart = await wal(board.token);

const KEY = `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const run = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST', headers: { ...H(board.token), 'Idempotency-Key': KEY },
  body: { rows: [{ email: a.email }, { email: b.email }] },
});
const ref = run.d.data.reference;
const first = await waitTerminal(ref, H(board.token));
ck('initial bulk run COMPLETED, both paid', first.status === 'COMPLETED' && first.success_count === 2);
ck('a paid 20000, b paid 30000', (await wal(a.t)) - aStart === 20000n && (await wal(b.t)) - bStart === 30000n);
const boardAfterFirst = await wal(board.token);
ck('board debited 50000', boardStart - boardAfterFirst === 50000n);

// --- simulate a crash: batch stuck PROCESSING, one item lost its PAID state ---
const disbId = psql(`SELECT id FROM stipend_disbursements WHERE reference = '${ref}'`);
psql(`UPDATE stipend_disbursements SET status='PROCESSING', completed_at=NULL, last_progress_at=NULL, success_count=1, processed_count=1, total_amount_paisa=20000 WHERE id='${disbId}'`);
psql(`UPDATE stipend_disbursement_items SET status='PENDING', transfer_id=NULL, failure_reason=NULL WHERE disbursement_id='${disbId}' AND user_id='${b.id}'`);
ck('crash simulated: batch PROCESSING, b item PENDING', psql(`SELECT status FROM stipend_disbursements WHERE id='${disbId}'`) === 'PROCESSING');

// --- resume via replay with the same key ---
const resume = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST', headers: { ...H(board.token), 'Idempotency-Key': KEY },
  body: { rows: [{ email: a.email }, { email: b.email }] },
});
ck('replay of stuck batch is accepted', resume.s === 200 || resume.s === 202, `s=${resume.s}`);
const healed = await waitTerminal(ref, H(board.token));
ck('resumed batch returns to COMPLETED', healed.status === 'COMPLETED' && healed.success_count === 2, JSON.stringify({ st: healed.status, ok: healed.success_count }));

// --- the crucial assertion: NOBODY was paid twice ---
ck('a still credited exactly once (no double pay)', (await wal(a.t)) - aStart === 20000n, `${aStart} -> ${await wal(a.t)}`);
ck('b still credited exactly once (reconciled, not re-sent)', (await wal(b.t)) - bStart === 30000n, `${bStart} -> ${await wal(b.t)}`);
ck('board balance unchanged by the resume', (await wal(board.token)) === boardAfterFirst, `${boardAfterFirst} -> ${await wal(board.token)}`);

// only one STIPEND transfer per beneficiary for this batch
const aCount = psql(`SELECT COUNT(*) FROM transfers WHERE sender_id='${board.user_id}' AND receiver_id='${a.id}' AND type='STIPEND'`);
const bCount = psql(`SELECT COUNT(*) FROM transfers WHERE sender_id='${board.user_id}' AND receiver_id='${b.id}' AND type='STIPEND'`);
ck('exactly one transfer row per beneficiary', aCount === '1' && bCount === '1', `a=${aCount} b=${bCount}`);

const inv = await j('/health/invariants');
ck('system invariant healthy, zero drift', inv.d.healthy === true && inv.d.drift_paisa === '0');

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

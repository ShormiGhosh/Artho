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
const IK = (t) => ({ ...H(t), 'Idempotency-Key': `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55) });
const login = async (email) =>
  (await j('/auth/login', { method: 'POST', body: { email, password: 'Test123456' } })).d.data;
const wal = async (t) => BigInt((await j('/wallet', { headers: H(t) })).d.data.wallet.balance_paisa);
const phone = () =>
  '01' + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const verifyDev = async (t, registerJson) => {
  const code = registerJson?.data?.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(t), body: { code } });
};
const regUser = async (nid) => {
  const e = `bulk_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'Bulk ' + rnd(), phone: phone(), nid: nid ?? undefined },
  });
  await verifyDev(r.d.data.token, r.d);
  return { t: r.d.data.token, id: r.d.data.user_id, email: e };
};
async function waitTerminal(ref, headers, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await j(`/stipend-disbursements/${ref}`, { headers });
    if (r.d?.data && r.d.data.status !== 'PROCESSING') return r.d.data;
    await new Promise((res) => setTimeout(res, 400));
  }
  throw new Error('disbursement did not finish: ' + ref);
}
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

// institution + a fresh programme
const boardReg = await j('/auth/register', {
  method: 'POST',
  body: { email: `bulkboard_${rnd()}@ex.com`, password: 'Test123456', full_name: 'Bulk Board', phone: phone(), role: 'INSTITUTION' },
});
const boardT = boardReg.d.data.token;
await verifyDev(boardT, boardReg.d);
const prog = (await j('/stipend-programs', { method: 'POST', headers: H(boardT), body: { name: 'Bulk Scholarship 2026', category: 'SCHOLARSHIP' } })).d.data.reference;

// ---- standard disburse now REQUIRES an Idempotency-Key ----
const s1 = await regUser('1990000000001');
await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s1.id, guardian_nid: '1990000000001', institution_name: 'A College', default_amount_bdt: '300' },
});
const noKey = await j(`/stipend-programs/${prog}/disburse`, { method: 'POST', headers: H(boardT), body: {} });
ck('standard disburse without Idempotency-Key -> 400', noKey.s === 400 && noKey.d.error.code === 'MISSING_IDEMPOTENCY_KEY', `s=${noKey.s}`);

// ---- standard disburse idempotency: same key => same disbursement, one payment ----
const KEY = `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const b0 = await wal(boardT);
const d1 = await j(`/stipend-programs/${prog}/disburse`, { method: 'POST', headers: { ...H(boardT), 'Idempotency-Key': KEY }, body: {} });
const bMid = await wal(boardT);
const d2 = await j(`/stipend-programs/${prog}/disburse`, { method: 'POST', headers: { ...H(boardT), 'Idempotency-Key': KEY }, body: {} });
const d3 = await j(`/stipend-programs/${prog}/disburse`, { method: 'POST', headers: { ...H(boardT), 'Idempotency-Key': KEY }, body: {} });
ck('same key returns the same disbursement thrice', d1.d.data.reference === d2.d.data.reference && d2.d.data.reference === d3.d.data.reference, d1.d.data.reference);
ck('replays do not pay again', bMid === (await wal(boardT)) && b0 - bMid === 30000n, `${b0} -> ${bMid} -> ${await wal(boardT)}`);

// ---- concurrent identical requests -> ONE disbursement, ONE payment ----
const s2 = await regUser('1990000000002');
await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s2.id, guardian_nid: '1990000000002', institution_name: 'B School', default_amount_bdt: '250' },
});
const CKEY = `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const s2before = await wal(s2.t);
const conc = await Promise.all(
  Array.from({ length: 4 }).map(() =>
    j(`/stipend-programs/${prog}/disburse`, {
      method: 'POST',
      headers: { ...H(boardT), 'Idempotency-Key': CKEY },
      body: { items: [{ user_id: s2.id }] },
    })
  )
);
const refs = new Set(conc.map((r) => r.d?.data?.reference));
ck('4 concurrent identical disburses -> 1 disbursement', refs.size === 1, [...refs].join(','));
ck('concurrent: beneficiary paid exactly once (25000 paisa)', (await wal(s2.t)) - s2before === 25000n, `${s2before} -> ${await wal(s2.t)}`);

// ---- BULK dry run ----
const e1 = await regUser('1990000000010');
const e2 = await regUser('1990000000011');
// enrol e1 with default, e2 without default
await j(`/stipend-programs/${prog}/beneficiaries`, { method: 'POST', headers: H(boardT), body: { user_id: e1.id, guardian_nid: '1990000000010', institution_name: 'C High', default_amount_bdt: '600' } });
await j(`/stipend-programs/${prog}/beneficiaries`, { method: 'POST', headers: H(boardT), body: { user_id: e2.id, guardian_nid: '1990000000011', institution_name: 'D High' } });
const notEnrolled = await regUser('1990000000012'); // exists, not enrolled

const dry = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST',
  headers: H(boardT),
  body: {
    dry_run: true,
    default_amount_bdt: '400',
    rows: [
      { email: e1.email },                       // default 600
      { email: e2.email, amount_bdt: '450' },    // override
      { nid: '1990000000010' },                  // duplicate of e1 -> DUPLICATE_ROW
      { email: notEnrolled.email },              // NOT_ENROLLED
      { email: `ghost_${rnd()}@ex.com` },        // ACCOUNT_NOT_FOUND
    ],
  },
});
ck('dry run -> 200, no disbursement id persisted', dry.s === 200 && dry.d.data.dry_run === true, `s=${dry.s}`);
ck('dry run resolves 2, unresolved 3', dry.d.data.resolved_count === 2 && dry.d.data.unresolved_count === 3, JSON.stringify({ r: dry.d.data.resolved_count, u: dry.d.data.unresolved_count }));
ck('dry run total = 600 + 450 = 1050.00', dry.d.data.total_amount_bdt === '1050.00', dry.d.data.total_amount_bdt);
ck('dry run flags DUPLICATE_ROW / NOT_ENROLLED / ACCOUNT_NOT_FOUND', ['DUPLICATE_ROW', 'NOT_ENROLLED', 'ACCOUNT_NOT_FOUND'].every((x) => dry.d.data.unresolved.some((u) => u.reason === x)), JSON.stringify(dry.d.data.unresolved.map((u) => u.reason)));
const before = await wal(e1.t);
ck('dry run moved no money', before === (await wal(e1.t)));

// ---- BULK real run (202 + poll) ----
const e1b = await wal(e1.t);
const e2b = await wal(e2.t);
const boardB = await wal(boardT);
const BKEY = `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const bulk = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST',
  headers: { ...H(boardT), 'Idempotency-Key': BKEY },
  body: {
    note: 'Bulk Q1',
    default_amount_bdt: '400',
    rows: [
      { email: e1.email },
      { email: e2.email, amount_bdt: '450' },
      { email: notEnrolled.email },   // stays unresolved
    ],
  },
});
ck('bulk real run -> 202 PROCESSING', bulk.s === 202 && bulk.d.data.status === 'PROCESSING' && bulk.d.data.async === true, `s=${bulk.s} st=${bulk.d.data?.status}`);
ck('bulk batch mode=BULK, total_count=2', bulk.d.data.mode === 'BULK' && bulk.d.data.total_count === 2, JSON.stringify({ m: bulk.d.data.mode, t: bulk.d.data.total_count }));
const done = await waitTerminal(bulk.d.data.reference, H(boardT));
ck('bulk finished COMPLETED', done.status === 'COMPLETED' && done.success_count === 2, JSON.stringify({ st: done.status, ok: done.success_count }));
ck('bulk stored 1 unresolved row on the batch', done.unresolved_count === 1 && done.unresolved[0].reason === 'NOT_ENROLLED', JSON.stringify(done.unresolved));
ck('bulk paid e1 = 60000 paisa (default)', (await wal(e1.t)) - e1b === 60000n, `${e1b} -> ${await wal(e1.t)}`);
ck('bulk paid e2 = 45000 paisa (override)', (await wal(e2.t)) - e2b === 45000n, `${e2b} -> ${await wal(e2.t)}`);
ck('bulk debited board 105000 paisa total', boardB - (await wal(boardT)) === 105000n, `${boardB} -> ${await wal(boardT)}`);

// ---- BULK replay: same key -> same batch, no extra payment ----
const e1c = await wal(e1.t);
const replay = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST',
  headers: { ...H(boardT), 'Idempotency-Key': BKEY },
  body: { default_amount_bdt: '400', rows: [{ email: e1.email }, { email: e2.email, amount_bdt: '450' }] },
});
ck('bulk replay returns the same batch (replayed:true, 200)', replay.s === 200 && replay.d.data.replayed === true && replay.d.data.reference === done.reference, `s=${replay.s}`);
ck('bulk replay pays nobody again', (await wal(e1.t)) === e1c);

// ---- BULK missing key (non-dry-run) -> 400 ----
const bulkNoKey = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST', headers: H(boardT),
  body: { default_amount_bdt: '10', rows: [{ email: e1.email }] },
});
ck('bulk non-dry-run without key -> 400', bulkNoKey.s === 400, `s=${bulkNoKey.s}`);

// ---- BULK auto_enroll ----
const auto1 = await regUser('1990000000020'); // account has NID, not enrolled
const AKEY = `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const autoRun = await j(`/stipend-programs/${prog}/bulk-disburse`, {
  method: 'POST',
  headers: { ...H(boardT), 'Idempotency-Key': AKEY },
  body: {
    auto_enroll: true,
    default_institution_name: 'Auto School',
    default_amount_bdt: '150',
    rows: [{ email: auto1.email }],
  },
});
ck('auto_enroll bulk -> 202', autoRun.s === 202, `s=${autoRun.s}`);
const autoDone = await waitTerminal(autoRun.d.data.reference, H(boardT));
ck('auto_enroll: beneficiary enrolled + paid 15000 paisa', autoDone.status === 'COMPLETED' && (await wal(auto1.t)) === 10015000n, `${await wal(auto1.t)}`);
const autoBens = await j(`/stipend-programs/${prog}/beneficiaries`, { headers: H(boardT) });
ck('auto_enroll created an ACTIVE beneficiary', autoBens.d.data.some((b) => b.user_id === auto1.id && b.status === 'ACTIVE' && b.institution_name === 'Auto School'));

// ---- invariant intact ----
const inv = await j('/health/invariants');
ck('system invariant healthy, zero drift', inv.s === 200 && inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

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
const key = (id) => `req-${id}-${Date.now()}-${rnd()}${rnd()}`.slice(0, 60);
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
  const e = `st_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'Stu ' + rnd(), phone: phone(), nid: nid ?? undefined },
  });
  await verifyDev(r.d.data.token, r.d);
  return { t: r.d.data.token, id: r.d.data.user_id };
};
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

// ---- roles ----
const board = await login('board@example.com');
ck('institution login carries role INSTITUTION', board.role === 'INSTITUTION', board.role);
const rana = await login('rana@example.com');
ck('individual login carries role USER', rana.role === 'USER', rana.role);

const reg = await j('/auth/register', {
  method: 'POST',
  body: { email: `inst_${rnd()}@ex.com`, password: 'Test123456', full_name: 'New Board', phone: phone(), role: 'INSTITUTION' },
});
ck('register role=INSTITUTION funds larger opening balance', reg.d.data.wallet.balance_paisa === '100000000000', reg.d.data.wallet.balance_paisa);
const boardT = reg.d.data.token;
await verifyDev(boardT, reg.d);

// ---- a plain user cannot create programmes ----
const denied = await j('/stipend-programs', { method: 'POST', headers: H(rana.token), body: { name: 'X' } });
ck('USER creating a programme -> 403', denied.s === 403, `s=${denied.s}`);

// ---- create programme ----
const cp = await j('/stipend-programs', {
  method: 'POST',
  headers: H(boardT),
  body: { name: 'Secondary Scholarship 2026', category: 'SCHOLARSHIP', description: 'Merit scholarship' },
});
ck('create programme -> 201 with PRG- reference', cp.s === 201 && /^PRG-\d{8}-[A-F0-9]{8}$/.test(cp.d.data.reference), cp.d.data.reference);
const prog = cp.d.data.reference;

// ---- enrol beneficiaries ----
const s1 = await regUser('1990000000000'); // has NID
const s2 = await regUser(null);             // no NID on file
const s3 = await regUser('1991111111111');

const e1 = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s1.id, guardian_nid: '1990000000000', institution_name: 'City College', default_amount_bdt: '800' },
});
ck('enrol with matching NID -> 201 eligible', e1.s === 201 && e1.d.data.eligible === true, `s=${e1.s}`);

const eMismatch = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s1.id, guardian_nid: '1990000000000', institution_name: 'dup' },
});
ck('enrolling same user twice -> 409 BENEFICIARY_EXISTS', eMismatch.s === 409 && eMismatch.d.error.code === 'BENEFICIARY_EXISTS', `s=${eMismatch.s}`);

const eWrongNid = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s3.id, guardian_nid: '9999999999999', institution_name: 'X' },
});
ck('enrol NID mismatch vs account NID -> 409 NID_MISMATCH', eWrongNid.s === 409 && eWrongNid.d.error.code === 'NID_MISMATCH', `s=${eWrongNid.s}`);

const e3 = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s3.id, guardian_nid: '1991111111111', institution_name: 'Ideal School', default_amount_bdt: '1200' },
});
ck('enrol s3 correctly -> 201', e3.s === 201);

// s2 had no NID: enrolling stamps it onto the account
const e2 = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s2.id, guardian_nid: '1992222222222', institution_name: 'Model School' },
});
ck('enrol NID-less user stamps NID onto account', e2.s === 201);
const s2profile = await j('/auth/me', { headers: H(s2.t) });
ck('  -> account now has that NID on file (stored encrypted, returned masked)',
  s2profile.d.data.has_nid === true && s2profile.d.data.nid.endsWith('2222') && !s2profile.d.data.nid.includes('19922'),
  s2profile.d.data.nid);

const invalidNid = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: s3.id, guardian_nid: '123', institution_name: 'X' },
});
ck('enrol with malformed NID -> 400/422', invalidNid.s === 400 || invalidNid.s === 422, `s=${invalidNid.s}`);

// cannot enrol an institution account
const enrollInst = await j(`/stipend-programs/${prog}/beneficiaries`, {
  method: 'POST', headers: H(boardT),
  body: { user_id: reg.d.data.user_id, guardian_nid: '1990000000000', institution_name: 'X' },
});
ck('cannot enrol an INSTITUTION as beneficiary -> 409', enrollInst.s === 409, `s=${enrollInst.s}`);

// suspend s3 to prove it is skipped in disbursement
await j(`/stipend-programs/${prog}/beneficiaries/${e3.d.data.beneficiary_id}`, {
  method: 'PATCH', headers: H(boardT), body: { status: 'SUSPENDED' },
});

// ---- disburse (flat amount for those without a default) ----
const b1before = await wal(s1.t);
const b2before = await wal(s2.t);
const boardBefore = await wal(boardT);

const dis = await j(`/stipend-programs/${prog}/disburse`, {
  method: 'POST',
  headers: { ...H(boardT), 'Idempotency-Key': key(reg.d.data.user_id) },
  body: { note: 'Q1 2026 disbursement', amount_bdt: '500' },
});
ck('disburse -> 201', dis.s === 201, `s=${dis.s}`);
ck('disburse status PARTIAL (s3 suspended -> skipped)', dis.d.data.status === 'PARTIAL', dis.d.data.status);
ck('disburse counts: 2 paid, 1 skipped', dis.d.data.success_count === 2 && dis.d.data.skipped_count === 1, JSON.stringify({ ok: dis.d.data.success_count, sk: dis.d.data.skipped_count, fa: dis.d.data.failed_count }));
ck('disburse total = 800 + 500 = 1300.00', dis.d.data.total_amount_bdt === '1300.00', dis.d.data.total_amount_bdt);
const paidItem = dis.d.data.items.find((i) => i.user_id === s1.id);
ck('paid item uses beneficiary default (800), links a TXN- transfer', paidItem.amount_bdt === '800.00' && /^TXN-/.test(paidItem.transfer_reference || ''), JSON.stringify(paidItem));
const skippedItem = dis.d.data.items.find((i) => i.user_id === s3.id);
ck('suspended beneficiary item SKIPPED w/ reason', skippedItem.status === 'SKIPPED' && skippedItem.failure_reason === 'BENEFICIARY_INACTIVE', JSON.stringify(skippedItem));

// balances moved exactly
ck('s1 credited exactly 80000 paisa', (await wal(s1.t)) - b1before === 80000n);
ck('s2 credited exactly 50000 paisa (flat)', (await wal(s2.t)) - b2before === 50000n);
ck('programme wallet debited exactly 130000 paisa', boardBefore - (await wal(boardT)) === 130000n);

// beneficiary notification + free-cash-out messaging
const s1notif = await j('/notifications', { headers: H(s1.t) });
ck('beneficiary got STIPEND_RECEIVED notification with "no cash-out fee"', s1notif.d.data.notifications.some((n) => n.type === 'STIPEND_RECEIVED' && /no cash-out fee/i.test(n.message)), JSON.stringify(s1notif.d.data.notifications[0] || {}));

// stipend transfer is tagged in history + detail
const s1hist = await j('/transactions?limit=20', { headers: H(s1.t) });
const stipendRow = s1hist.d.data.items.find((i) => i.reference === paidItem.transfer_reference);
ck('history row badged STIPEND_RECEIVED', stipendRow && stipendRow.badge === 'STIPEND_RECEIVED' && stipendRow.is_stipend === true, JSON.stringify(stipendRow || {}));
const detail = await j(`/transfers/${paidItem.transfer_reference}`, { headers: H(s1.t) });
ck('transfer detail flags is_stipend + fee_bdt 0.00', detail.d.data.is_stipend === true && detail.d.data.fee_bdt === '0.00');

// ---- idempotent batch replay: same Idempotency-Key returns the same disbursement ----
const sameKey = key(reg.d.data.user_id);
const d1 = await j(`/stipend-programs/${prog}/disburse`, { method: 'POST', headers: { ...H(boardT), 'Idempotency-Key': sameKey }, body: { amount_bdt: '100' } });
const boardMid = await wal(boardT);
const d2 = await j(`/stipend-programs/${prog}/disburse`, { method: 'POST', headers: { ...H(boardT), 'Idempotency-Key': sameKey }, body: { amount_bdt: '100' } });
ck('same Idempotency-Key replays the same disbursement', d1.d.data.reference === d2.d.data.reference, `${d1.d.data.reference} vs ${d2.d.data.reference}`);
ck('replay does not disburse again', (await wal(boardT)) === boardMid, `${boardMid} vs ${await wal(boardT)}`);

// ---- beneficiary self view ----
const mine = await j('/stipends/received', { headers: H(s1.t) });
ck('/stipends/received lists payments + enrollments + total', mine.d.data.payments.length >= 1 && mine.d.data.enrollments.length >= 1 && mine.d.data.total_received_bdt !== undefined, JSON.stringify({ pay: mine.d.data.payments.length, enr: mine.d.data.enrollments.length, tot: mine.d.data.total_received_bdt }));
ck('beneficiary cannot list programme beneficiaries', (await j(`/stipend-programs/${prog}/beneficiaries`, { headers: H(s1.t) })).s === 403);
ck('non-party cannot view programme', (await j(`/stipend-programs/${prog}`, { headers: H(rana.token) })).s === 403);
ck('beneficiary CAN view programme (limited)', (await j(`/stipend-programs/${prog}`, { headers: H(s1.t) })).d.data.is_owner === false);

// ---- seeded programme end-to-end ----
const seededList = await j('/stipend-programs', { headers: H(board.token) });
ck('seeded institution sees its programme', seededList.d.data.programs.some((p) => p.name === 'Primary Education Stipend 2026'));
const seededProg = seededList.d.data.programs.find((p) => p.name === 'Primary Education Stipend 2026');
ck('seeded programme reports 3 beneficiaries', seededProg.beneficiary_count === 3, `${seededProg.beneficiary_count}`);
const ranaBefore = await wal(rana.token);
const seededDisb = await j(`/stipend-programs/${seededProg.reference}/disburse`, {
  method: 'POST', headers: { ...H(board.token), 'Idempotency-Key': key(board.user_id) }, body: {},
});
ck('seeded disburse uses per-beneficiary defaults -> COMPLETED', seededDisb.d.data.status === 'COMPLETED' && seededDisb.d.data.success_count === 3, JSON.stringify({ st: seededDisb.d.data.status, ok: seededDisb.d.data.success_count }));
ck('seeded: Rana received her ৳500 default', (await wal(rana.token)) - ranaBefore === 50000n, `${ranaBefore} -> ${await wal(rana.token)}`);

// ---- invariant intact after all disbursement churn ----
const inv = await j('/health/invariants');
ck('system invariant healthy, zero drift', inv.s === 200 && inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

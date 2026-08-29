// Smart Money Recovery — "What happened to my money?" investigation flow.
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
  const e = `rec_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'Rec ' + rnd(), phone: phone() },
  });
  const code = r.d.data.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(r.d.data.token), body: { code } });
  return { t: r.d.data.token, id: r.d.data.user_id };
};
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };
const events = (arr) => (arr || []).map((e) => e.event);

const alice = await reg();
const bob = await reg();
const carol = await reg();

// ---- 1. a normal transfer records the full lifecycle timeline ----
const okKey = IK();
const t1 = await j('/transfers', {
  method: 'POST', headers: { ...H(alice.t), 'Idempotency-Key': okKey },
  body: { receiver_id: bob.id, amount_bdt: '100', note: 'normal' },
});
ck('normal transfer -> 202 COMPLETED', t1.s === 202 && t1.d.data.status === 'COMPLETED');
const t1detail = await j(`/transfers/${t1.d.data.reference}`, { headers: H(alice.t) });
ck('timeline = INITIATED, BALANCE_LOCKED, PROCESSED, COMPLETED',
  JSON.stringify(events(t1detail.d.data.events)) ===
  JSON.stringify(['INITIATED', 'BALANCE_LOCKED', 'PROCESSED', 'COMPLETED']),
  JSON.stringify(events(t1detail.d.data.events)));
ck('normal transfer is not flagged uncertain', t1detail.d.data.is_uncertain === false);

// ---- 2. simulate LOST RESPONSE: money moved, client never heard back ----
const aliceBefore = await wal(alice.t);
const bobBefore = await wal(bob.t);
const lostKey = IK();
const lost = await j('/transfers', {
  method: 'POST', headers: { ...H(alice.t), 'Idempotency-Key': lostKey },
  body: { receiver_id: bob.id, amount_bdt: '2500.50', simulate: 'lost_response' },
});
ck('lost_response -> 504 NETWORK_UNCERTAIN', lost.s === 504 && lost.d.error.code === 'NETWORK_UNCERTAIN', `s=${lost.s}`);
const lostRef = lost.d.error.details.transfer_reference;
ck('error carries transfer_reference for investigation', /^TXN-\d{8}-[A-F0-9]{8}$/.test(lostRef || ''), lostRef);
ck('money DID move server-side (debited once)', aliceBefore - (await wal(alice.t)) === 250050n);
ck('receiver credited once', (await wal(bob.t)) - bobBefore === 250050n);

// "What happened to my money?" -> verify
const v1 = await j(`/transfers/${lostRef}/verify`, { method: 'POST', headers: H(alice.t) });
ck('verify -> outcome DELIVERED', v1.s === 200 && v1.d.data.outcome === 'DELIVERED', JSON.stringify(v1.d.data?.outcome));
ck('verify: money_moved true, 2 ledger entries, net 0', v1.d.data.reconciliation.money_moved === true && v1.d.data.reconciliation.ledger_entry_count === 2 && v1.d.data.reconciliation.net_ledger_paisa === '0', JSON.stringify(v1.d.data.reconciliation));
ck('verify: status COMPLETED, snapshot consistent', v1.d.data.transfer.status === 'COMPLETED' && v1.d.data.reconciliation.snapshot_consistent === true);
ck('timeline gained CLIENT_CONFIRMATION_LOST + VERIFIED',
  events(v1.d.data.timeline).includes('CLIENT_CONFIRMATION_LOST') && events(v1.d.data.timeline).slice(-1)[0] === 'VERIFIED',
  JSON.stringify(events(v1.d.data.timeline)));

// verify is idempotent — no duplicate events, no double charge
const seqLenAfterV1 = v1.d.data.timeline.length;
const aliceAfterV1 = await wal(alice.t);
const v2 = await j(`/transfers/${lostRef}/verify`, { method: 'POST', headers: H(alice.t) });
ck('verify again -> still DELIVERED, timeline unchanged', v2.d.data.outcome === 'DELIVERED' && v2.d.data.timeline.length === seqLenAfterV1, `${seqLenAfterV1} -> ${v2.d.data.timeline.length}`);
ck('verify again -> sender NOT charged twice', (await wal(alice.t)) === aliceAfterV1);

// genuine client retry with the SAME idempotency key just replays the completed transfer
const retry = await j('/transfers', {
  method: 'POST', headers: { ...H(alice.t), 'Idempotency-Key': lostKey },
  body: { receiver_id: bob.id, amount_bdt: '2500.50' },
});
ck('retry with same key -> replays same transfer, no new charge', (retry.d.data?.reference === lostRef || retry.d.data?.transfer_id) && (await wal(alice.t)) === aliceAfterV1, `ref=${retry.d.data?.reference}`);

// ---- 3. simulate CRASH BEFORE PROCESSING: nothing moved, row left PENDING ----
const cBefore = await wal(carol.t);
const bobBefore2 = await wal(bob.t);
const crashKey = IK();
const crash = await j('/transfers', {
  method: 'POST', headers: { ...H(carol.t), 'Idempotency-Key': crashKey },
  body: { receiver_id: bob.id, amount_bdt: '999', simulate: 'crash_before_processing' },
});
ck('crash_before_processing -> 500 SIMULATED_CRASH', crash.s === 500 && crash.d.error.code === 'SIMULATED_CRASH', `s=${crash.s}`);
const crashRef = crash.d.error.details.transfer_reference;
ck('crash error carries a reference', /^TXN-/.test(crashRef || ''), crashRef);
ck('NO money left the sender (failed tx does not deduct)', (await wal(carol.t)) === cBefore, `${cBefore} -> ${await wal(carol.t)}`);
ck('receiver not credited', (await wal(bob.t)) === bobBefore2);

const crashDetail = await j(`/transfers/${crashRef}`, { headers: H(carol.t) });
ck('stuck transfer is PENDING + flagged uncertain', crashDetail.d.data.status === 'PENDING' && crashDetail.d.data.is_uncertain === true, crashDetail.d.data.status);
ck('stuck timeline is just INITIATED', JSON.stringify(events(crashDetail.d.data.events)) === JSON.stringify(['INITIATED']));

// "What happened to my money?" -> verify reconciles to NOT_SENT
const v3 = await j(`/transfers/${crashRef}/verify`, { method: 'POST', headers: H(carol.t) });
ck('verify -> outcome NOT_SENT', v3.d.data.outcome === 'NOT_SENT', JSON.stringify(v3.d.data?.outcome));
ck('verify: 0 ledger entries', v3.d.data.reconciliation.ledger_entry_count === 0 && v3.d.data.reconciliation.money_moved === false);
ck('verify: status now FAILED (money safely not sent)', v3.d.data.transfer.status === 'FAILED');
ck('verify timeline: INITIATED, CLIENT_CONFIRMATION_LOST, VERIFIED',
  JSON.stringify(events(v3.d.data.timeline)) === JSON.stringify(['INITIATED', 'CLIENT_CONFIRMATION_LOST', 'VERIFIED']),
  JSON.stringify(events(v3.d.data.timeline)));
ck('sender balance still untouched after reconcile', (await wal(carol.t)) === cBefore);

// audit trail is append-only + contiguous seqs
const seqs = v3.d.data.timeline.map((e) => e.seq);
ck('event seqs are 1..N contiguous', JSON.stringify(seqs) === JSON.stringify(seqs.map((_, i) => i + 1)), JSON.stringify(seqs));

// the idempotency key is immutable: re-sending with the SAME key replays the failure
const sameKeyResend = await j('/transfers', {
  method: 'POST', headers: { ...H(carol.t), 'Idempotency-Key': crashKey },
  body: { receiver_id: bob.id, amount_bdt: '999' },
});
ck('same-key re-send -> replays the reconciled failure (not a new transfer)',
  sameKeyResend.s >= 400 && sameKeyResend.d.error?.details?.replayed_failure === true,
  `s=${sameKeyResend.s} code=${sameKeyResend.d.error?.code}`);
ck('same-key re-send moved no money', (await wal(carol.t)) === cBefore);

// a NEW user action (new key) sends successfully, exactly once
const resend = await j('/transfers', {
  method: 'POST', headers: { ...H(carol.t), 'Idempotency-Key': IK() },
  body: { receiver_id: bob.id, amount_bdt: '999' },
});
ck('re-send with a NEW key -> COMPLETED', resend.s === 202 && resend.d.data.status === 'COMPLETED', `s=${resend.s}`);
ck('re-send moved money exactly once (99900 paisa)', cBefore - (await wal(carol.t)) === 99900n, `${cBefore} -> ${await wal(carol.t)}`);
ck('re-send is a distinct transfer from the failed one', resend.d.data.reference !== crashRef);

// ---- 4. access control ----
const forbidden = await j(`/transfers/${lostRef}/verify`, { method: 'POST', headers: H(carol.t) });
ck('third party cannot verify -> 403', forbidden.s === 403, `s=${forbidden.s}`);

// receiver CAN verify (they are a party)
const byReceiver = await j(`/transfers/${lostRef}/verify`, { method: 'POST', headers: H(bob.t) });
ck('receiver can verify -> DELIVERED', byReceiver.s === 200 && byReceiver.d.data.outcome === 'DELIVERED');

// ---- 5. system invariant intact through all recovery churn ----
const inv = await j('/health/invariants');
ck('system invariant healthy, zero drift', inv.s === 200 && inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

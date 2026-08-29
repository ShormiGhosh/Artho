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
const reg = async () => {
  const e = `p3b_${rnd()}@ex.com`;
  const r = await j('/auth/register', { method: 'POST', body: { email: e, password: 'Test123456', full_name: 'P3b ' + rnd() } });
  return { t: r.d.data.token, id: r.d.data.user_id, name: r.d.data.full_name };
};
const key = (id) => `req-${id}-${Date.now()}-${rnd()}${rnd()}`.slice(0, 60);
const H = (t) => ({ Authorization: `Bearer ${t}` });
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

const alice = await reg(), bob = await reg(), carol = await reg();

// ---- request detail endpoint ----
const cr = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '300', reason: 'Dinner' } });
const ref = cr.d.data.reference;
const id = cr.d.data.request_id;

const dA = await j(`/money-requests/${ref}`, { headers: H(alice.t) });
ck('requester can GET request by reference', dA.s === 200 && dA.d.data.reference === ref && dA.d.data.direction === 'SENT');
const dB = await j(`/money-requests/${id}`, { headers: H(bob.t) });
ck('requestee can GET request by uuid', dB.s === 200 && dB.d.data.direction === 'RECEIVED');
const dC = await j(`/money-requests/${ref}`, { headers: H(carol.t) });
ck('third party -> 403', dC.s === 403, `s=${dC.s}`);
const dX = await j(`/money-requests/REQ-20200101-DEADBEEF`, { headers: H(alice.t) });
ck('unknown reference -> 404', dX.s === 404, `s=${dX.s}`);
ck('detail exposes resolution fields (null while pending)', dA.d.data.approved_at === null && dA.d.data.rejected_at === null && dA.d.data.resolved_at === null && 'rejection_reason' in dA.d.data);

// ---- reject with reason ----
const cr2 = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '40', reason: 'Tea' } });
const rej = await j(`/money-requests/${cr2.d.data.request_id}/reject`, { method: 'POST', headers: H(bob.t), body: { reason: 'Wrong amount' } });
ck('reject with reason -> 200 REJECTED', rej.s === 200 && rej.d.data.status === 'REJECTED', `s=${rej.s}`);
ck('reject stores rejection_reason + rejected_at', rej.d.data.rejection_reason === 'Wrong amount' && !!rej.d.data.rejected_at);
const aNotif = await j('/notifications', { headers: H(alice.t) });
ck('rejection notification includes the reason', aNotif.d.data.notifications.some((n) => n.type === 'REQUEST_REJECTED' && n.message.includes('Wrong amount')));
// reject with no body still works
const cr2b = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '41' } });
const rejNB = await fetch(B + `/money-requests/${cr2b.d.data.request_id}/reject`, { method: 'POST', headers: H(bob.t) });
ck('reject with NO body -> 200', rejNB.status === 200, `s=${rejNB.status}`);

// ---- approve sets approved_at + related_transfer_reference ----
const appr = await j(`/money-requests/${id}/approve`, { method: 'POST', headers: { ...H(bob.t), 'Idempotency-Key': key(bob.id) } });
ck('approve -> 200', appr.s === 200, `s=${appr.s}`);
ck('approve response carries approved_at', !!appr.d.data.request.approved_at);
ck('approve links related_transfer_reference (TXN-…)', /^TXN-\d{8}-[A-F0-9]{8}$/.test(appr.d.data.request.related_transfer_reference || ''), appr.d.data.request.related_transfer_reference);
const dApproved = await j(`/money-requests/${ref}`, { headers: H(alice.t) });
ck('detail after approve shows APPROVED + resolved_at + transfer ref', dApproved.d.data.status === 'APPROVED' && !!dApproved.d.data.resolved_at && !!dApproved.d.data.related_transfer_reference);

// ---- unified lookup ----
const txRef = appr.d.data.transfer.reference;
const luTx = await j(`/transactions/lookup?ref=${txRef}`, { headers: H(alice.t) });
ck('lookup TXN- -> kind TRANSFER', luTx.s === 200 && luTx.d.data.kind === 'TRANSFER' && luTx.d.data.data.reference === txRef, JSON.stringify(luTx.d.data?.kind));
const luReq = await j(`/transactions/lookup?ref=${ref}`, { headers: H(bob.t) });
ck('lookup REQ- -> kind REQUEST', luReq.s === 200 && luReq.d.data.kind === 'REQUEST' && luReq.d.data.data.reference === ref);
const luLower = await j(`/transactions/lookup?ref=${txRef.toLowerCase()}`, { headers: H(alice.t) });
ck('lookup is case-insensitive on prefix', luLower.s === 200 && luLower.d.data.kind === 'TRANSFER');
const luUuid = await j(`/transactions/lookup?ref=${appr.d.data.transfer.transfer_id}`, { headers: H(alice.t) });
ck('lookup by bare transfer UUID -> TRANSFER', luUuid.s === 200 && luUuid.d.data.kind === 'TRANSFER');
const luReqUuid = await j(`/transactions/lookup?ref=${id}`, { headers: H(alice.t) });
ck('lookup by bare request UUID -> REQUEST (falls through)', luReqUuid.s === 200 && luReqUuid.d.data.kind === 'REQUEST', JSON.stringify(luReqUuid.d.data?.kind));
const luForbidden = await j(`/transactions/lookup?ref=${ref}`, { headers: H(carol.t) });
ck('lookup enforces party-only -> 403', luForbidden.s === 403, `s=${luForbidden.s}`);
const luMissing = await j(`/transactions/lookup?ref=TXN-20200101-DEADBEEF`, { headers: H(alice.t) });
ck('lookup unknown -> 404', luMissing.s === 404, `s=${luMissing.s}`);
const luBad = await j(`/transactions/lookup?ref=x`, { headers: H(alice.t) });
ck('lookup rejects too-short ref -> 400', luBad.s === 400, `s=${luBad.s}`);

// ---- regression: list + old smoke still good ----
const lst = await j('/money-requests', { headers: H(alice.t) });
ck('list still returns {sent,received}', Array.isArray(lst.d.data.sent) && Array.isArray(lst.d.data.received));
ck('list items now include related_transfer_reference field', lst.d.data.sent.every((r) => 'related_transfer_reference' in r));

const inv = await j('/health/invariants');
ck('invariant healthy', inv.s === 200 && inv.d.healthy === true && inv.d.drift_paisa === '0');

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

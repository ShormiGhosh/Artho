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
  const e = `p3_${rnd()}@ex.com`;
  const r = await j('/auth/register', { method: 'POST', body: { email: e, password: 'Test123456', full_name: 'P3 ' + rnd() } });
  return { t: r.d.data.token, id: r.d.data.user_id, name: r.d.data.full_name };
};
const wal = async (t) => BigInt((await j('/wallet', { headers: { Authorization: `Bearer ${t}` } })).d.data.wallet.balance_paisa);
const key = (id) => `req-${id}-${Date.now()}-${rnd()}${rnd()}`.slice(0, 60);
const H = (t) => ({ Authorization: `Bearer ${t}` });
let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

const alice = await reg(), bob = await reg();

const cr = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '1200.50', reason: 'Books' } });
ck('create -> 201 PENDING', cr.s === 201 && cr.d.data.status === 'PENDING', `s=${cr.s}`);
ck('request has REQ- reference', /^REQ-\d{8}-[A-F0-9]{8}$/.test(cr.d.data.reference || ''), cr.d.data.reference);
ck('expires_at ~30d out', (new Date(cr.d.data.expires_at) - new Date(cr.d.data.created_at)) > 28 * 864e5, cr.d.data.expires_at);
const reqId = cr.d.data.request_id;

const selfR = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: alice.id, amount_bdt: '5' } });
ck('self-request -> 409', selfR.s === 409, `s=${selfR.s}`);

const aList = await j('/money-requests', { headers: H(alice.t) });
const bList = await j('/money-requests', { headers: H(bob.t) });
ck('requester sees it under sent', aList.d.data.sent.some((r) => r.request_id === reqId) && aList.d.data.received.length === 0);
ck('requestee sees it under received', bList.d.data.received.some((r) => r.request_id === reqId));
ck('list item carries amount+reason+counterparty+status', (() => {
  const r = bList.d.data.received.find((x) => x.request_id === reqId);
  return r && r.amount_bdt === '1200.50' && r.reason === 'Books' && r.counterparty_name === alice.name && r.status === 'PENDING';
})());

const bNotif = await j('/notifications', { headers: H(bob.t) });
ck('requestee got REQUEST_RECEIVED notification', bNotif.d.data.notifications.some((n) => n.type === 'REQUEST_RECEIVED' && n.related_request_id === reqId));

const broke = await reg();
const cr3 = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: broke.id, amount_bdt: '999999', reason: 'too much' } });
const apprBroke = await j(`/money-requests/${cr3.d.data.request_id}/approve`, { method: 'POST', headers: { ...H(broke.t), 'Idempotency-Key': key(broke.id) } });
ck('approve w/ insufficient balance -> 402', apprBroke.s === 402, `s=${apprBroke.s}`);
const stillPending = await j('/money-requests', { headers: H(broke.t) });
ck('request stays PENDING after failed approve', stillPending.d.data.received.find((r) => r.request_id === cr3.d.data.request_id)?.status === 'PENDING');

const bob0 = await wal(bob.t), alice0 = await wal(alice.t);
const appr = await j(`/money-requests/${reqId}/approve`, { method: 'POST', headers: { ...H(bob.t), 'Idempotency-Key': key(bob.id) } });
ck('approve -> 200, request APPROVED + transfer COMPLETED', appr.s === 200 && appr.d.data.request.status === 'APPROVED' && appr.d.data.transfer.status === 'COMPLETED', `s=${appr.s}`);
ck('approve links related_transfer_id to the transfer', appr.d.data.request.related_transfer_id === appr.d.data.transfer.transfer_id);
const bob1 = await wal(bob.t), alice1 = await wal(alice.t);
ck('approver (bob) debited 120050 paisa', bob0 - bob1 === 120050n, `${bob0}->${bob1}`);
ck('requester (alice) credited 120050 paisa', alice1 - alice0 === 120050n, `${alice0}->${alice1}`);

const aN2 = await j('/notifications', { headers: H(alice.t) });
ck('requester got REQUEST_APPROVED notification', aN2.d.data.notifications.some((n) => n.type === 'REQUEST_APPROVED' && n.related_request_id === reqId));

const bob2a = await wal(bob.t);
const apprAgain = await j(`/money-requests/${reqId}/approve`, { method: 'POST', headers: { ...H(bob.t), 'Idempotency-Key': key(bob.id) } });
const bob2b = await wal(bob.t);
ck('re-approve of resolved request -> 409', apprAgain.s === 409, `s=${apprAgain.s}`);
ck('re-approve moves no money', bob2a === bob2b, `${bob2a} vs ${bob2b}`);

const cr4 = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '50', reason: 'Tea' } });
const bBefore = await wal(bob.t);
const rej = await j(`/money-requests/${cr4.d.data.request_id}/reject`, { method: 'POST', headers: H(bob.t) });
ck('reject -> 200 REJECTED', rej.s === 200 && rej.d.data.status === 'REJECTED', `s=${rej.s}`);
ck('reject moves no money', (await wal(bob.t)) === bBefore);
ck('requester got REQUEST_REJECTED notification', (await j('/notifications', { headers: H(alice.t) })).d.data.notifications.some((n) => n.type === 'REQUEST_REJECTED'));
ck('reject already-rejected -> 409', (await j(`/money-requests/${cr4.d.data.request_id}/reject`, { method: 'POST', headers: H(bob.t) })).s === 409);

const cr5 = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '75' } });
const can = await j(`/money-requests/${cr5.d.data.request_id}`, { method: 'DELETE', headers: H(alice.t) });
ck('cancel -> 200 CANCELLED', can.s === 200 && can.d.data.status === 'CANCELLED', `s=${can.s}`);
ck('requestee got REQUEST_CANCELLED notification', (await j('/notifications', { headers: H(bob.t) })).d.data.notifications.some((n) => n.type === 'REQUEST_CANCELLED'));

const cr6 = await j('/money-requests', { method: 'POST', headers: H(alice.t), body: { requestee_id: bob.id, amount_bdt: '9' } });
ck('requestee cannot cancel a request they received -> 403', (await j(`/money-requests/${cr6.d.data.request_id}`, { method: 'DELETE', headers: H(bob.t) })).s === 403);
ck('requester cannot approve their own request -> 403', (await j(`/money-requests/${cr6.d.data.request_id}/approve`, { method: 'POST', headers: { ...H(alice.t), 'Idempotency-Key': key(alice.id) } })).s === 403);

const feed = await j('/transactions?limit=50', { headers: H(alice.t) });
const items = feed.d.data.items;
ck('history feed merges TRANSFER + REQUEST', items.some((i) => i.kind === 'TRANSFER') && items.some((i) => i.kind === 'REQUEST'));
ck('history is reverse-chronological', items.every((it, i) => i === 0 || new Date(items[i - 1].created_at) >= new Date(it.created_at)));
ck('history items carry badge+status+counterparty+amount_display', items.every((i) => i.badge && i.status && i.counterparty_name && i.amount_display));
ck('history pagination shape {page,limit,total,pages}', (() => { const p = feed.d.data.pagination; return p && 'page' in p && 'limit' in p && 'total' in p && 'pages' in p; })());
const onlyReq = await j('/transactions?kind=REQUEST', { headers: H(alice.t) });
ck('filter kind=REQUEST', onlyReq.d.data.items.length > 0 && onlyReq.d.data.items.every((i) => i.kind === 'REQUEST'));
const onlyApproved = await j('/transactions?status=APPROVED', { headers: H(alice.t) });
ck('filter status=APPROVED', onlyApproved.d.data.items.length > 0 && onlyApproved.d.data.items.every((i) => i.status === 'APPROVED'));
const dated = await j('/transactions?from=2020-01-01&to=2020-01-02', { headers: H(alice.t) });
ck('API supports date-range from/to', dated.d.data.items.length === 0, `got ${dated.d.data.items.length}`);

const led = await j('/transactions/ledger', { headers: H(alice.t) });
ck('ledger endpoint returns entries with balance_after', led.d.data.entries.length > 0 && led.d.data.entries.every((e) => e.balance_after_bdt !== undefined));

const lookupReq = await j(`/transfers/${cr.d.data.reference}`, { headers: H(alice.t) });
ck('GAP: /transfers/:ref does not resolve REQ- references (404)', lookupReq.s === 404, `s=${lookupReq.s}`);

const inv = await j('/health/invariants');
ck('system invariant healthy, zero drift after churn', inv.s === 200 && inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

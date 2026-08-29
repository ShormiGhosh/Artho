// Ad-hoc end-to-end smoke test against a running API on :3000
const BASE = process.env.BASE ?? 'http://localhost:3000/api';
let pass = 0;
let fail = 0;

function check(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

async function api(path, { method = 'GET', token, body, key } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const rnd = () => Math.random().toString(36).slice(2, 10);

async function main() {
  // login as two seeded users
  const rana = await api('/auth/login', {
    method: 'POST',
    body: { email: 'rana@example.com', password: 'Test123456' },
  });
  check('login rana', rana.status === 200 && !!rana.json.data.token);
  const fatima = await api('/auth/login', {
    method: 'POST',
    body: { email: 'fatima@example.com', password: 'Test123456' },
  });
  check('login fatima', fatima.status === 200);

  const ranaT = rana.json.data.token;
  const fatimaT = fatima.json.data.token;
  const fatimaId = fatima.json.data.user_id;
  const ranaId = rana.json.data.user_id;

  // wallet
  const w1 = await api('/wallet', { token: ranaT });
  check('wallet balance shape', w1.json.data.wallet.balance_bdt !== undefined, JSON.stringify(w1.json.data?.wallet));
  const startRana = BigInt(w1.json.data.wallet.balance_paisa);

  // register fresh user to keep invariant math clean
  const email = `test_${rnd()}@example.com`;
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email, password: 'Test123456', full_name: 'Test User' },
  });
  check('register new user + funded', reg.status === 201 && reg.json.data.wallet.balance_paisa === '10000000');

  // self transfer rejected
  const self = await api('/transfers', {
    method: 'POST',
    token: ranaT,
    key: `req-${ranaId}-${Date.now()}-${rnd()}`,
    body: { receiver_id: ranaId, amount_bdt: 10 },
  });
  check('self transfer 409', self.status === 409 && self.json.error.code === 'SELF_TRANSFER_NOT_ALLOWED');

  // invalid amount
  const bad = await api('/transfers', {
    method: 'POST',
    token: ranaT,
    key: `req-${ranaId}-${Date.now()}-${rnd()}`,
    body: { receiver_id: fatimaId, amount_bdt: '10.999' },
  });
  check('invalid amount 400/422', bad.status === 400 || bad.status === 422, `got ${bad.status}`);

  // successful transfer 2500.50
  const key1 = `req-${ranaId}-${Date.now()}-${rnd()}`;
  const t1 = await api('/transfers', {
    method: 'POST',
    token: ranaT,
    key: key1,
    body: { receiver_id: fatimaId, amount_bdt: '2500.50', note: 'Lunch' },
  });
  check('transfer completed', t1.status === 202 && t1.json.data.status === 'COMPLETED', JSON.stringify(t1.json));
  check('transfer has reference', /^TXN-\d{8}-[A-F0-9]{8}$/.test(t1.json.data.reference || ''), t1.json.data?.reference);

  // idempotent replay -> same transfer id, no double debit
  const t1replay = await api('/transfers', {
    method: 'POST',
    token: ranaT,
    key: key1,
    body: { receiver_id: fatimaId, amount_bdt: '2500.50', note: 'Lunch' },
  });
  check('idempotent replay same id', t1replay.json.data.transfer_id === t1.json.data.transfer_id);
  check('idempotent replay header', t1replay.json.data.reference === t1.json.data.reference);

  // balance moved exactly once
  const w2 = await api('/wallet', { token: ranaT });
  const afterRana = BigInt(w2.json.data.wallet.balance_paisa);
  check('debited exactly 250050 paisa once', startRana - afterRana === 250050n, `${startRana} -> ${afterRana}`);

  // same key, different body -> conflict
  const conflict = await api('/transfers', {
    method: 'POST',
    token: ranaT,
    key: key1,
    body: { receiver_id: fatimaId, amount_bdt: '999' },
  });
  check('idempotency key reuse conflict 409', conflict.status === 409, `got ${conflict.status}`);

  // insufficient balance
  const poor = await api('/auth/register', {
    method: 'POST',
    body: { email: `poor_${rnd()}@example.com`, password: 'Test123456', full_name: 'Poor User' },
  });
  const poorT = poor.json.data.token;
  const broke = await api('/transfers', {
    method: 'POST',
    token: poorT,
    key: `req-x-${Date.now()}-${rnd()}`,
    body: { receiver_id: fatimaId, amount_bdt: '200000' },
  });
  check('insufficient balance 402', broke.status === 402 && broke.json.error.code === 'INSUFFICIENT_BALANCE', `got ${broke.status}`);

  // concurrency: 5 parallel transfers of 30000 from a user with exactly 100000 -> 3 succeed, 2 fail, balance 10000
  const cu = await api('/auth/register', {
    method: 'POST',
    body: { email: `conc_${rnd()}@example.com`, password: 'Test123456', full_name: 'Conc User' },
  });
  const cuT = cu.json.data.token;
  const results = await Promise.all(
    Array.from({ length: 5 }).map((_, i) =>
      api('/transfers', {
        method: 'POST',
        token: cuT,
        key: `req-conc-${Date.now()}-${i}-${rnd()}`,
        body: { receiver_id: fatimaId, amount_bdt: '30000' },
      })
    )
  );
  const okCount = results.filter((r) => r.status === 202).length;
  const failCount = results.filter((r) => r.status === 402).length;
  const cw = await api('/wallet', { token: cuT });
  check('concurrency: 3 succeed', okCount === 3, `okCount=${okCount}`);
  check('concurrency: 2 fail insufficient', failCount === 2, `failCount=${failCount}`);
  check('concurrency: final balance 10000.00', cw.json.data.wallet.balance_bdt === '10000.00', cw.json.data.wallet.balance_bdt);

  // money request flow: fatima requests 1200 from rana, rana approves
  const mr = await api('/money-requests', {
    method: 'POST',
    token: fatimaT,
    body: { requestee_id: ranaId, amount_bdt: '1200', reason: 'Books' },
  });
  check('money request created', mr.status === 201 && mr.json.data.status === 'PENDING');
  const reqId = mr.json.data.request_id;

  const beforeApprove = BigInt((await api('/wallet', { token: ranaT })).json.data.wallet.balance_paisa);
  const appr = await api(`/money-requests/${reqId}/approve`, {
    method: 'POST',
    token: ranaT,
    key: `req-appr-${Date.now()}-${rnd()}`,
  });
  check('request approved + transfer', appr.status === 200 && appr.json.data.request.status === 'APPROVED' && appr.json.data.transfer.status === 'COMPLETED', JSON.stringify(appr.json));
  const afterApprove = BigInt((await api('/wallet', { token: ranaT })).json.data.wallet.balance_paisa);
  check('approver debited 120000 paisa', beforeApprove - afterApprove === 120000n, `${beforeApprove} -> ${afterApprove}`);

  // reject flow
  const mr2 = await api('/money-requests', {
    method: 'POST',
    token: fatimaT,
    body: { requestee_id: ranaId, amount_bdt: '50', reason: 'Tea' },
  });
  const rej = await api(`/money-requests/${mr2.json.data.request_id}/reject`, { method: 'POST', token: ranaT });
  check('request rejected', rej.status === 200 && rej.json.data.status === 'REJECTED');

  // cancel flow
  const mr3 = await api('/money-requests', {
    method: 'POST',
    token: fatimaT,
    body: { requestee_id: ranaId, amount_bdt: '75', reason: 'Snacks' },
  });
  const can = await api(`/money-requests/${mr3.json.data.request_id}`, { method: 'DELETE', token: fatimaT });
  check('request cancelled', can.status === 200 && can.json.data.status === 'CANCELLED');

  // history + ledger
  const hist = await api('/transactions?limit=5', { token: ranaT });
  check('history feed returns items', Array.isArray(hist.json.data.items) && hist.json.data.items.length > 0);
  const led = await api('/transactions/ledger', { token: ranaT });
  check('ledger returns entries', Array.isArray(led.json.data.entries) && led.json.data.entries.length > 0);

  // transfer detail by reference
  const det = await api(`/transfers/${t1.json.data.reference}`, { token: fatimaT });
  check('receiver can view transfer by reference', det.status === 200 && det.json.data.direction === 'RECEIVED');

  // notifications for fatima
  const notif = await api('/notifications', { token: fatimaT });
  check('fatima has notifications', notif.json.data.notifications.length > 0 && notif.json.data.unread_count > 0);

  // search
  const search = await api('/users/search?q=arjun', { token: ranaT });
  check('search finds Arjun, no balance leaked', search.json.data.results.some((r) => r.full_name === 'Arjun Roy') && !('balance_paisa' in (search.json.data.results[0] || {})));

  // system invariant intact
  const inv = await api('/health/invariants');
  check('system invariant healthy', inv.status === 200 && inv.json.healthy === true && inv.json.drift_paisa === '0', JSON.stringify(inv.json));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

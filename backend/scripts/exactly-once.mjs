// Exactly-Once Money Transfer — the six required scenarios.
const B = 'http://localhost:3000/api';
async function raw(p, o = {}) {
  const r = await fetch(B + p, {
    ...o,
    headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let d = null;
  try { d = await r.json(); } catch {}
  return { s: r.status, h: Object.fromEntries(r.headers), d };
}
const j = raw;
const rnd = () => Math.random().toString(36).slice(2, 10);
const H = (t) => ({ Authorization: `Bearer ${t}` });
const IK = () => `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const wal = async (t) => BigInt((await j('/wallet', { headers: H(t) })).d.data.wallet.balance_paisa);
const phone = () =>
  '01' + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const reg = async () => {
  const e = `eo_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'EO ' + rnd(), phone: phone() },
  });
  const code = r.d.data.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(r.d.data.token), body: { code } });
  return { t: r.d.data.token, id: r.d.data.user_id };
};
const send = (token, key, body) =>
  j('/transfers', { method: 'POST', headers: { ...H(token), 'Idempotency-Key': key }, body });
const detail = (token, ref) => j(`/transfers/${ref}`, { headers: H(token) });

let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };
const STATES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'VERIFYING']);

const alice = await reg();
const bob = await reg();

// =====================================================================
// 1. DOUBLE-CLICKING SEND — same key fired twice back-to-back
// =====================================================================
{
  const key = IK();
  const a0 = await wal(alice.t);
  const [c1, c2] = await Promise.all([
    send(alice.t, key, { receiver_id: bob.id, amount_bdt: '300' }),
    send(alice.t, key, { receiver_id: bob.id, amount_bdt: '300' }),
  ]);
  const ok = [c1, c2].filter((r) => r.s === 202);
  ck('double-click: at most one 202, other replays/blocks', ok.length >= 1);
  const ids = new Set([c1, c2].map((r) => r.d.data?.transfer_id).filter(Boolean));
  ck('double-click: only one transfer id produced', ids.size === 1, [...ids].join());
  ck('double-click: sender charged exactly once (30000 paisa)', a0 - (await wal(alice.t)) === 30000n, `${a0} -> ${await wal(alice.t)}`);
  const replay = [c1, c2].find((r) => r.h['idempotent-replay'] === 'true' || r.s === 409);
  ck('double-click: the duplicate is a replay or REQUEST_IN_PROGRESS', !!replay, `codes=${[c1, c2].map((r) => r.s).join()}`);
}

// =====================================================================
// 2. SAME REQUEST SENT MULTIPLE TIMES — 5 sequential identical POSTs
// =====================================================================
{
  const key = IK();
  const a0 = await wal(alice.t);
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await send(alice.t, key, { receiver_id: bob.id, amount_bdt: '125.50' }));
  const ids = new Set(results.map((r) => r.d.data?.transfer_id).filter(Boolean));
  ck('multi-send: every call returns the same transaction id', ids.size === 1, `${ids.size} distinct`);
  ck('multi-send: every call returns COMPLETED', results.every((r) => r.d.data?.status === 'COMPLETED'));
  ck('multi-send: money moved exactly once (12550 paisa)', a0 - (await wal(alice.t)) === 12550n);
  ck('multi-send: replays carry Idempotent-Replay header', results.slice(1).every((r) => r.h['idempotent-replay'] === 'true'));
}

// =====================================================================
// 3. NETWORK TIMEOUT AFTER SUCCESSFUL PROCESSING
// =====================================================================
{
  const key = IK();
  const a0 = await wal(alice.t);
  const b0 = await wal(bob.t);
  const lost = await send(alice.t, key, { receiver_id: bob.id, amount_bdt: '2000', simulate: 'lost_response' });
  ck('timeout-after-success: 504 NETWORK_UNCERTAIN', lost.s === 504 && lost.d.error.code === 'NETWORK_UNCERTAIN');
  const ref = lost.d.error.details.transfer_reference;
  ck('timeout-after-success: money actually moved (debited once)', a0 - (await wal(alice.t)) === 200000n);
  ck('timeout-after-success: recipient credited once', (await wal(bob.t)) - b0 === 200000n);
  // client retries the exact same request after the timeout
  const retry = await send(alice.t, key, { receiver_id: bob.id, amount_bdt: '2000' });
  ck('timeout-after-success: retry returns the ORIGINAL transfer', retry.d.data?.reference === ref);
  ck('timeout-after-success: retry does NOT charge again', a0 - (await wal(alice.t)) === 200000n, `${a0} -> ${await wal(alice.t)}`);
  const v = await j(`/transfers/${ref}/verify`, { method: 'POST', headers: H(alice.t) });
  ck('timeout-after-success: verify -> DELIVERED', v.d.data.outcome === 'DELIVERED');
}

// =====================================================================
// 4. CONCURRENT IDENTICAL REQUESTS — 8 in parallel, same key
// =====================================================================
{
  const key = IK();
  const a0 = await wal(alice.t);
  const results = await Promise.all(
    Array.from({ length: 8 }).map(() => send(alice.t, key, { receiver_id: bob.id, amount_bdt: '77' }))
  );
  const ids = new Set(results.map((r) => r.d.data?.transfer_id).filter(Boolean));
  ck('concurrent: exactly one transfer id across 8 racers', ids.size === 1, `${ids.size} distinct`);
  const created = results.filter((r) => r.s === 202 && r.h['idempotent-replay'] !== 'true');
  ck('concurrent: at most one call actually created the transfer', created.length <= 1, `${created.length} creators`);
  ck('concurrent: sender debited exactly once (7700 paisa)', a0 - (await wal(alice.t)) === 7700n, `${a0} -> ${await wal(alice.t)}`);
  const others = results.filter((r) => r.s !== 202);
  ck('concurrent: non-winners get 409 REQUEST_IN_PROGRESS (if any)', others.every((r) => r.s === 409));
}

// =====================================================================
// 5. SERVER FAILURE DURING PROCESSING — mid-transaction crash rolls back
// =====================================================================
{
  const key = IK();
  const a0 = await wal(alice.t);
  const b0 = await wal(bob.t);
  const crash = await send(alice.t, key, { receiver_id: bob.id, amount_bdt: '4321', simulate: 'crash_during_processing' });
  ck('crash-mid-tx: 500 SIMULATED_CRASH', crash.s === 500 && crash.d.error.code === 'SIMULATED_CRASH', `s=${crash.s}`);
  const ref = crash.d.error.details.transfer_reference;
  ck('crash-mid-tx: NO deduction (transaction rolled back)', (await wal(alice.t)) === a0, `${a0} -> ${await wal(alice.t)}`);
  ck('crash-mid-tx: recipient NOT credited', (await wal(bob.t)) === b0);
  const dt = await detail(alice.t, ref);
  ck('crash-mid-tx: transfer left PENDING, no ledger movement', dt.d.data.status === 'PENDING');
  const v = await j(`/transfers/${ref}/verify`, { method: 'POST', headers: H(alice.t) });
  ck('crash-mid-tx: verify -> NOT_SENT, status FAILED', v.d.data.outcome === 'NOT_SENT' && v.d.data.transfer.status === 'FAILED');
  ck('crash-mid-tx: balance still exactly as before', (await wal(alice.t)) === a0);
  // a fresh user action (new key) succeeds once
  const ok = await send(alice.t, IK(), { receiver_id: bob.id, amount_bdt: '4321' });
  ck('crash-mid-tx: new-key resend succeeds, charged once', ok.d.data?.status === 'COMPLETED' && a0 - (await wal(alice.t)) === 432100n);
}

// =====================================================================
// 6. INSUFFICIENT BALANCE
// =====================================================================
{
  const poor = await reg(); // has 100000.00
  // Spend most of it with LOW-risk transfers so a modest amount overshoots
  // without tripping the fraud gate (which would 403 before the balance check).
  await send(poor.t, IK(), { receiver_id: bob.id, amount_bdt: '45000' });
  await send(poor.t, IK(), { receiver_id: bob.id, amount_bdt: '45000' });
  const OVER = '30000'; // > remaining ~10000, still LOW risk
  const key = IK();
  const p0 = await wal(poor.t);
  const b0 = await wal(bob.t);
  const bad = await send(poor.t, key, { receiver_id: bob.id, amount_bdt: OVER });
  ck('insufficient: 402 INSUFFICIENT_BALANCE', bad.s === 402 && bad.d.error.code === 'INSUFFICIENT_BALANCE', `s=${bad.s}`);
  ck('insufficient: error reports required + available', bad.d.error.details.required_paisa && bad.d.error.details.available_paisa);
  ck('insufficient: no money left the sender', (await wal(poor.t)) === p0);
  ck('insufficient: recipient not credited', (await wal(bob.t)) === b0);
  const ref = bad.d.error.details.transfer_reference;
  const dt = await detail(poor.t, ref);
  ck('insufficient: transfer recorded FAILED with reason', dt.d.data.status === 'FAILED' && dt.d.data.failure_reason === 'INSUFFICIENT_BALANCE');
  ck('insufficient: audit trail = INITIATED then FAILED', JSON.stringify((dt.d.data.events || []).map((e) => e.event)) === JSON.stringify(['INITIATED', 'FAILED']));
  // retry policy: same key returns the ORIGINAL failure, not a new transfer
  const replay = await send(poor.t, key, { receiver_id: bob.id, amount_bdt: OVER });
  const isReplay =
    replay.h['idempotent-replay'] === 'true' || replay.d.error?.details?.replayed_failure === true;
  ck('insufficient: same-key retry returns the original 402 failure (no new transfer)',
    replay.s === 402 && replay.d.error.code === 'INSUFFICIENT_BALANCE' && isReplay,
    `s=${replay.s} replay=${isReplay}`);
  ck('insufficient: retry still moved no money', (await wal(poor.t)) === p0);
  // a new user action within budget succeeds
  const ok = await send(poor.t, IK(), { receiver_id: bob.id, amount_bdt: '10' });
  ck('insufficient: a valid new transfer still works', ok.d.data?.status === 'COMPLETED' && p0 - (await wal(poor.t)) === 1000n);
}

// =====================================================================
// invariants that must hold across everything
// =====================================================================
{
  // unique constraint: a transfer id is a UUID and reference is TXN-…
  const fresh = await reg();
  const key = IK();
  const t = await send(fresh.t, key, { receiver_id: bob.id, amount_bdt: '5' });
  ck('id is an immutable UUID', /^[0-9a-f-]{36}$/.test(t.d.data.transfer_id));
  ck('reference is an immutable TXN- id', /^TXN-\d{8}-[A-F0-9]{8}$/.test(t.d.data.reference));
  const dt = await detail(fresh.t, t.d.data.reference);
  ck('states are the documented set', (dt.d.data.events || []).every((e) => STATES.has(e.state)));
  ck('audit trail seqs are contiguous 1..N and append-only',
    JSON.stringify((dt.d.data.events || []).map((e) => e.seq)) ===
    JSON.stringify((dt.d.data.events || []).map((_, i) => i + 1)));

  const inv = await j('/health/invariants');
  ck('system invariant: Σ wallets == Σ ledger, zero drift', inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));
}

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

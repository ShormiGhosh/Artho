// Fraud & Security Monitoring — end-to-end.
const B = 'http://localhost:3000/api';
const j = async (p, o = {}) => {
  const r = await fetch(B + p, {
    ...o,
    headers: { 'Content-Type': 'application/json', ...(o.headers || {}) },
    body: o.body ? JSON.stringify(o.body) : undefined,
  });
  let d = null;
  try { d = await r.json(); } catch {}
  return { s: r.status, d, h: Object.fromEntries(r.headers) };
};
const rnd = () => Math.random().toString(36).slice(2, 10);
const H = (t) => ({ Authorization: `Bearer ${t}` });
const K = () => `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const wal = async (t) => BigInt((await j('/wallet', { headers: H(t) })).d.data.wallet.balance_paisa);
const phone = () =>
  '01' + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const reg = async () => {
  const e = `fraud_${rnd()}@ex.com`;
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: e, password: 'Test123456', full_name: 'Fr ' + rnd(), phone: phone() },
  });
  const code = r.d.data.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(r.d.data.token), body: { code } });
  return { t: r.d.data.token, id: r.d.data.user_id, email: e };
};
const send = (token, key, body) =>
  j('/transfers', { method: 'POST', headers: { ...H(token), 'Idempotency-Key': key }, body });

let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

const admin = (await j('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'Test123456' } })).d.data;
ck('admin login has ADMIN role', admin.role === 'ADMIN', admin.role);
ck('non-admin cannot open the security dashboard', (await j('/security/dashboard', { headers: H((await reg()).t) })).s === 403);
const cfg0 = await j('/security/config', { headers: H(admin.token) });
ck('admin can read risk config', cfg0.s === 200 && cfg0.d.data.high_threshold > cfg0.d.data.medium_threshold);

// =====================================================================
// 1. NORMAL transfer -> LOW -> allowed
// =====================================================================
{
  const a = await reg(), b = await reg();
  const before = await wal(a.t);
  const r = await send(a.t, K(), { receiver_id: b.id, amount_bdt: '250' });
  ck('normal transfer -> 202 COMPLETED', r.s === 202 && r.d.data.status === 'COMPLETED');
  ck('normal transfer scored LOW / no hold', r.d.data.risk?.band === 'LOW' || r.d.data.risk === null || r.d.data.risk?.decision === 'ALLOWED');
  ck('normal transfer moved money once', before - (await wal(a.t)) === 25000n);
}

// =====================================================================
// 2. HIGH-VALUE transfer -> MEDIUM -> additional verification -> proceed
// =====================================================================
{
  const a = await reg(), b = await reg();
  const before = await wal(a.t);
  const key = K();
  const r1 = await send(a.t, key, { receiver_id: b.id, amount_bdt: '60000' }); // > large threshold
  ck('high-value -> 200 VERIFICATION_REQUIRED', r1.s === 200 && r1.d.data.status === 'VERIFICATION_REQUIRED');
  ck('verification response is transparent (score + reasons)', typeof r1.d.data.score === 'number' && Array.isArray(r1.d.data.reasons) && r1.d.data.reasons.some((x) => x.code === 'LARGE_AMOUNT'));
  ck('no money moved while awaiting verification', (await wal(a.t)) === before);
  const tok = r1.d.data.verification_token;
  ck('a wrong token is rejected', (await send(a.t, key, { receiver_id: b.id, amount_bdt: '60000', risk_ack: 'nope' })).d.data.status === 'VERIFICATION_REQUIRED');
  const r2 = await send(a.t, key, { receiver_id: b.id, amount_bdt: '60000', risk_ack: tok });
  ck('confirming with the token completes the SAME transfer', r2.s === 202 && r2.d.data.status === 'COMPLETED');
  ck('exactly-once: money moved once after verification', before - (await wal(a.t)) === 6000000n, `${before} -> ${await wal(a.t)}`);
  // retry after completion -> replay, no re-score, no extra charge
  const balAfter = await wal(a.t);
  const r3 = await send(a.t, key, { receiver_id: b.id, amount_bdt: '60000', risk_ack: tok });
  ck('retry after completion replays (no second transfer)', r3.d.data.transfer_id === r2.d.data.transfer_id && (await wal(a.t)) === balAfter);
}

// =====================================================================
// 3. HIGH risk (hard cap) -> BLOCKED -> notify -> admin release -> proceed
// =====================================================================
{
  // Lower the hard cap so a spendable amount trips it, then restore.
  await j('/security/config', { method: 'PUT', headers: H(admin.token), body: { hard_cap_paisa: 8000000 } }); // BDT 80,000
  const a = await reg(), b = await reg();
  const before = await wal(a.t);
  const key = K();
  const r1 = await send(a.t, key, { receiver_id: b.id, amount_bdt: '90000' }); // > hard cap, <= wallet
  ck('over-hard-cap -> 403 TRANSFER_BLOCKED_RISK', r1.s === 403 && r1.d.error.code === 'TRANSFER_BLOCKED_RISK');
  ck('block reasons include the critical AMOUNT_OVER_HARD_CAP', r1.d.error.details.reasons.some((x) => x.code === 'AMOUNT_OVER_HARD_CAP' && x.critical));
  ck('blocked transfer moved no money', (await wal(a.t)) === before);
  const ref = r1.d.error.details.assessment_reference;

  const notif = await j('/notifications', { headers: H(a.t) });
  ck('user notified of the hold (SECURITY_ALERT)', notif.d.data.notifications.some((n) => n.type === 'SECURITY_ALERT'));

  // a retry with the same key stays blocked (retries cannot bypass fraud)
  ck('same-key retry stays BLOCKED', (await send(a.t, key, { receiver_id: b.id, amount_bdt: '90000' })).s === 403);

  // admin sees it and releases
  const dash = await j('/security/dashboard', { headers: H(admin.token) });
  ck('admin dashboard shows the flagged transfer', dash.d.data.flagged.some((x) => x.reference === ref) && dash.d.data.currently_blocked >= 1);
  const detail = await j(`/security/assessments/${ref}`, { headers: H(admin.token) });
  ck('assessment detail carries reasons + related security events', detail.d.data.reasons.length > 0 && Array.isArray(detail.d.data.related_events));
  const rel = await j(`/security/assessments/${detail.d.data.assessment_id}/release`, {
    method: 'POST', headers: H(admin.token), body: { note: 'Manually reviewed — customer confirmed' },
  });
  ck('admin release -> decision RELEASED', rel.s === 200 && rel.d.data.decision === 'RELEASED');

  const r2 = await send(a.t, key, { receiver_id: b.id, amount_bdt: '90000' });
  ck('after release, same key proceeds and completes', r2.s === 202 && r2.d.data.status === 'COMPLETED');
  ck('released transfer moved money exactly once', before - (await wal(a.t)) === 9000000n, `${before} -> ${await wal(a.t)}`);

  await j('/security/config', { method: 'PUT', headers: H(admin.token), body: { hard_cap_paisa: 50000000 } }); // restore
}

// =====================================================================
// 4. VELOCITY — many transfers in a short window trip MEDIUM
// =====================================================================
{
  const a = await reg();
  const rcpts = await Promise.all(Array.from({ length: 6 }).map(() => reg()));
  let mediumHit = 0, completed = 0;
  for (let i = 0; i < rcpts.length; i++) {
    const r = await send(a.t, K(), { receiver_id: rcpts[i].id, amount_bdt: '200' });
    if (r.d.data?.status === 'VERIFICATION_REQUIRED') {
      mediumHit++;
      if (r.d.data.reasons.some((x) => x.code === 'MULTIPLE_TRANSFERS' || x.code === 'MANY_RECIPIENTS')) {
        // confirm and continue
        await send(a.t, K().slice(0, 40) + i, { receiver_id: rcpts[i].id, amount_bdt: '200' }); // fresh key, will re-assess
      }
    } else if (r.d.data?.status === 'COMPLETED') completed++;
  }
  ck('velocity: later rapid transfers get held for verification', mediumHit >= 1, `mediumHit=${mediumHit} completed=${completed}`);
}

// =====================================================================
// 5. RAPID REPEATED FAILED TRANSFERS -> risk reason RAPID_FAILED_TRANSFERS
// =====================================================================
{
  const poor = await reg();
  const b = await reg();
  // Spend most of the balance with small (LOW-risk) transfers, then let small
  // transfers fail on insufficient balance — a real failed-transfer burst.
  await send(poor.t, K(), { receiver_id: b.id, amount_bdt: '48000' });
  await send(poor.t, K(), { receiver_id: b.id, amount_bdt: '48000' });
  let failed = 0;
  for (let i = 0; i < 5; i++) {
    const r = await send(poor.t, K(), { receiver_id: b.id, amount_bdt: '9000' });
    if (r.s === 402) failed++;
  }
  // Some fail on balance; once the burst is detected the rest are held instead.
  ck('a burst of transfers really failed on balance', failed >= 3, `failed=${failed}`);
  const r = await send(poor.t, K(), { receiver_id: b.id, amount_bdt: '30' });
  const reasons = (r.d.data?.reasons || r.d.error?.details?.reasons || []).map((x) => x.code);
  ck('rapid failed transfers surface as a risk reason', reasons.includes('RAPID_FAILED_TRANSFERS'), JSON.stringify(reasons));
  ck('the flagged transfer is held for verification (not silently allowed)', r.d.data?.status === 'VERIFICATION_REQUIRED' || r.s === 403, `s=${r.s}`);
}

// =====================================================================
// 6. CONCURRENT identical requests -> one assessment, one transfer
// =====================================================================
{
  const a = await reg(), b = await reg();
  const before = await wal(a.t);
  const key = K();
  const results = await Promise.all(
    Array.from({ length: 6 }).map(() => send(a.t, key, { receiver_id: b.id, amount_bdt: '300' }))
  );
  const ids = new Set(results.map((r) => r.d.data?.transfer_id).filter(Boolean));
  ck('concurrent: exactly one transfer produced', ids.size === 1, `${ids.size}`);
  ck('concurrent: charged exactly once (30000 paisa)', before - (await wal(a.t)) === 30000n, `${before} -> ${await wal(a.t)}`);
  const list = await j(`/security/assessments`, { headers: H(admin.token) });
  const forThisKey = list.d.data.assessments.filter((x) => x.user_id === a.id && x.amount_bdt === '300.00');
  ck('concurrent: exactly one risk assessment stored', forThisKey.length === 1, `${forThisKey.length}`);
}

// =====================================================================
// 7. MULTIPLE FAILED LOGINS -> events + temporary lockout (not permanent)
// =====================================================================
{
  const u = await reg();
  let locked = false;
  for (let i = 0; i < 7; i++) {
    const r = await j('/auth/login', { method: 'POST', body: { email: u.email, password: 'WRONG' + i } });
    if (r.s === 429 && r.d.error.code === 'ACCOUNT_TEMPORARILY_LOCKED') locked = true;
  }
  ck('repeated bad passwords -> ACCOUNT_TEMPORARILY_LOCKED (429)', locked);
  const stillLocked = await j('/auth/login', { method: 'POST', body: { email: u.email, password: 'Test123456' } });
  ck('correct password is refused while locked (temporary, not permanent)', stillLocked.s === 429 && stillLocked.d.error.details.retry_after_s > 0);
  const events = await j(`/security/events?type=LOGIN_FAILED`, { headers: H(admin.token) });
  ck('failed logins are in the auditable security log', events.d.data.events.length >= 5);
}

// =====================================================================
// 8. AUDIT LOG + config are transparent
// =====================================================================
{
  const ev = await j('/security/events', { headers: H(admin.token) });
  const types = new Set(ev.d.data.events.map((e) => e.type));
  ck('security log contains RISK_ASSESSED events', types.has('RISK_ASSESSED'));
  // Filtered by type rather than hoping it survives in the unfiltered "latest
  // 50" — this script now registers many more users (each also logging
  // ACCOUNT_CREATED + EMAIL_VERIFIED), which pushes older event types off
  // that unfiltered page well before the run ends.
  const blocked = await j('/security/events?type=TRANSFER_BLOCKED', { headers: H(admin.token) });
  ck('security log contains TRANSFER_BLOCKED events', blocked.d.data.events.length > 0);
  const verified = await j('/security/events?type=VERIFICATION_PASSED', { headers: H(admin.token) });
  ck('security log contains VERIFICATION_PASSED events', verified.d.data.events.length > 0);
  const cfg = await j('/security/config', { headers: H(admin.token) });
  ck('config exposes all thresholds', ['medium_threshold', 'high_threshold', 'large_amount_paisa', 'velocity_max_transfers'].every((k) => k in cfg.d.data));
}

// =====================================================================
// 9. secure-by-default: NID is never returned in full
// =====================================================================
{
  const u = await reg();
  await j('/auth/me', { headers: H(u.t) }); // no nid
  await j('/auth/me', { method: 'PATCH', headers: H(u.t), body: { nid: '1990555444333' } });
  const me = await j('/auth/me', { headers: H(u.t) });
  ck('profile NID is masked, not plaintext', me.d.data.nid && !me.d.data.nid.includes('1990555') && me.d.data.nid.endsWith('4333') && me.d.data.has_nid === true, me.d.data.nid);
  const w = await j('/wallet', { headers: H(u.t) });
  ck('wallet NID is masked too', w.d.data.nid && !w.d.data.nid.includes('1990555'), w.d.data.nid);
}

// =====================================================================
const inv = await j('/health/invariants');
ck('system invariant: Σ wallets == Σ ledger, zero drift', inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

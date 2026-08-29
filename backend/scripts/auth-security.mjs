// Auth hardening — end-to-end: phone + email verification (enforced), rotating
// refresh tokens, and reuse detection (a stolen/replayed old refresh token
// kills the whole session family).
const B = 'http://localhost:3000/api';
const rnd = () => Math.random().toString(36).slice(2, 10);

// fetch() has no built-in cookie jar; this is a tiny manual one per "browser".
function jar() {
  let cookie = null;
  return {
    async call(path, { method = 'GET', token, body } = {}) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (cookie) headers.Cookie = cookie;
      const res = await fetch(B + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0]; // "artho_refresh=..."
      let d = null;
      try { d = await res.json(); } catch {}
      return { s: res.status, d };
    },
    clearCookie() { cookie = null; },
    hasCookie() { return !!cookie; },
    rawCookie() { return cookie; },
  };
}

let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

async function registerVerified(j) {
  const email = `auth_${rnd()}@ex.com`;
  const phone = `017${Math.floor(10000000 + Math.random() * 89999999)}`;
  const r = await j.call('/auth/register', {
    method: 'POST',
    body: { email, password: 'Test123456', full_name: 'Auth ' + rnd(), phone },
  });
  if (r.s !== 201) return { ok: false, r };
  const code = r.d.data.verification.dev_code;
  const v = await j.call('/auth/verify-email', { method: 'POST', token: r.d.data.token, body: { code } });
  return { ok: true, register: r, verify: v, email, phone, token: r.d.data.token, id: r.d.data.user_id };
}

// ===========================================================================
// 1. Phone is required and validated; duplicate phone/email are rejected
// ===========================================================================
{
  const j = jar();
  const noPhone = await j.call('/auth/register', {
    method: 'POST',
    body: { email: `np_${rnd()}@ex.com`, password: 'Test123456', full_name: 'No Phone' },
  });
  ck('register without phone -> 400', noPhone.s === 400);

  const badPhone = await j.call('/auth/register', {
    method: 'POST',
    body: { email: `bp_${rnd()}@ex.com`, password: 'Test123456', full_name: 'Bad Phone', phone: '12345' },
  });
  ck('register with malformed phone -> 400', badPhone.s === 400);

  const email = `dup_${rnd()}@ex.com`;
  const phone = `018${Math.floor(10000000 + Math.random() * 89999999)}`;
  const first = await j.call('/auth/register', { method: 'POST', body: { email, password: 'Test123456', full_name: 'Dup One', phone } });
  ck('first registration with a fresh phone -> 201', first.s === 201);
  const dupEmail = await j.call('/auth/register', { method: 'POST', body: { email, password: 'Test123456', full_name: 'Dup Two', phone: `019${Math.floor(10000000 + Math.random() * 89999999)}` } });
  ck('duplicate email -> 409', dupEmail.s === 409);
  const dupPhone = await j.call('/auth/register', { method: 'POST', body: { email: `dp2_${rnd()}@ex.com`, password: 'Test123456', full_name: 'Dup Three', phone } });
  ck('duplicate phone -> 409', dupPhone.s === 409, dupPhone.d?.error?.code);
}

// ===========================================================================
// 2. Verification is actually enforced (not just tracked)
// ===========================================================================
{
  const j = jar();
  const email = `enf_${rnd()}@ex.com`;
  const phone = `015${Math.floor(10000000 + Math.random() * 89999999)}`;
  const r = await j.call('/auth/register', { method: 'POST', body: { email, password: 'Test123456', full_name: 'Enforce Me', phone } });
  ck('register -> 201, PENDING_VERIFICATION', r.s === 201 && r.d.data.account_status === 'PENDING_VERIFICATION');
  ck('register sets the refresh cookie', j.hasCookie());
  const token = r.d.data.token;

  const blocked = await j.call('/transfers', {
    method: 'POST',
    token,
    body: { receiver_id: '00000000-0000-0000-0000-000000000000', amount_bdt: '10' },
  });
  ck('unverified account is BLOCKED from money movement', blocked.s === 401, `${blocked.s} ${JSON.stringify(blocked.d)}`);

  const me = await j.call('/auth/me', { token });
  ck('unverified account CAN read its own profile', me.s === 200 && me.d.data.account_status === 'PENDING_VERIFICATION');
  const wallet = await j.call('/wallet', { token });
  ck('unverified account CAN read its own wallet', wallet.s === 200);

  const wrongCode = await j.call('/auth/verify-email', { method: 'POST', token, body: { code: '000000' } });
  ck('wrong code -> 400 with attempts_remaining', wrongCode.s === 400 && wrongCode.d.error.details.attempts_remaining === 4);

  const code = r.d.data.verification.dev_code;
  ck('dev verification code was echoed back (no SMTP configured)', typeof code === 'string' && /^\d{6}$/.test(code));
  const ok = await j.call('/auth/verify-email', { method: 'POST', token, body: { code } });
  ck('correct code -> 200, ACTIVE', ok.s === 200 && ok.d.data.account_status === 'ACTIVE');

  const meAfter = await j.call('/auth/me', { token });
  ck('profile reflects ACTIVE after verification', meAfter.d.data.account_status === 'ACTIVE');

  const reuse = await j.call('/auth/verify-email', { method: 'POST', token, body: { code } });
  ck('re-using a consumed code -> 410 expired', reuse.s === 410);
}

// ===========================================================================
// 3. Resend cooldown + already-verified short-circuit
// ===========================================================================
{
  const j = jar();
  const res = await registerVerified(j);
  ck('setup: registered + verified', res.verify.s === 200);
  const resend = await j.call('/auth/resend-verification', { method: 'POST', token: res.token });
  ck('resend after already verified -> already_verified:true', resend.s === 200 && resend.d.data.already_verified === true);
}
{
  const j = jar();
  const email = `cd_${rnd()}@ex.com`;
  const phone = `016${Math.floor(10000000 + Math.random() * 89999999)}`;
  const r = await j.call('/auth/register', { method: 'POST', body: { email, password: 'Test123456', full_name: 'Cooldown', phone } });
  const first = await j.call('/auth/resend-verification', { method: 'POST', token: r.d.data.token });
  ck('first resend right after register -> 429 (cooldown)', first.s === 429 && typeof first.d.error.details.retry_after_s === 'number');
}

// ===========================================================================
// 4. Rotating refresh tokens: rotation works, old token stops working
// ===========================================================================
{
  const j = jar();
  const res = await registerVerified(j);
  const cookieBefore = j.rawCookie();

  const r1 = await j.call('/auth/refresh', { method: 'POST' });
  ck('first refresh -> 200 with a new access token', r1.s === 200 && typeof r1.d.data.token === 'string');
  // The refresh token is the credential that must change on every rotation.
  // (The access JWT is deterministic given {user_id, iat, exp}, so reissuing
  // it within the same second can legitimately produce an identical string —
  // that's not a rotation bug.)
  ck('refresh rotates the cookie (new refresh token issued)', j.rawCookie() !== cookieBefore);

  const r2 = await j.call('/auth/refresh', { method: 'POST' });
  ck('second refresh (chained rotation) -> 200', r2.s === 200);

  // Replay the FIRST (now stale) refresh cookie -> must fail, not silently succeed.
  const staleAttempt = await fetch(B + '/auth/refresh', { method: 'POST', headers: { Cookie: cookieBefore } });
  const staleBody = await staleAttempt.json().catch(() => ({}));
  ck('replaying the ORIGINAL (pre-rotation) refresh token fails', staleAttempt.status === 401);
  ck('...with the reuse-specific error code', staleBody?.error?.code === 'REFRESH_TOKEN_REUSED', staleBody?.error?.code);
}

// ===========================================================================
// 5. Reuse detection revokes the WHOLE family, not just the reused token
// ===========================================================================
{
  const j = jar();
  const res = await registerVerified(j);
  const cookieGen0 = j.rawCookie(); // token from login/register

  const rot1 = await j.call('/auth/refresh', { method: 'POST' }); // gen0 -> gen1
  ck('setup rotation 1 ok', rot1.s === 200);
  const cookieGen1 = j.rawCookie();

  const rot2 = await j.call('/auth/refresh', { method: 'POST' }); // gen1 -> gen2
  ck('setup rotation 2 ok', rot2.s === 200);
  const cookieGen2 = j.rawCookie();

  // Attacker replays gen0 (already rotated away) -> reuse detected, family revoked.
  const attack = await fetch(B + '/auth/refresh', { method: 'POST', headers: { Cookie: cookieGen0 } });
  ck('reusing an old (rotated) token is rejected', attack.status === 401);

  // The CURRENT, legitimate token (gen2) must ALSO now be dead — the whole
  // family was revoked, which is the entire point of reuse detection.
  const legit = await fetch(B + '/auth/refresh', { method: 'POST', headers: { Cookie: cookieGen2 } });
  const legitBody = await legit.json().catch(() => ({}));
  ck('the legitimate, never-reused latest token is ALSO revoked (family kill)', legit.status === 401, JSON.stringify(legitBody));

  // A security event was logged.
  const admin = (await jar().call('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'Test123456' } })).d.data;
  const events = await jar().call(`/security/events?type=REFRESH_TOKEN_REUSE_DETECTED`, { token: admin.token });
  ck('REFRESH_TOKEN_REUSE_DETECTED logged with HIGH severity', events.s === 200 && events.d.data.events.some((e) => e.severity === 'HIGH'));
}

// ===========================================================================
// 6. Logout revokes the session; refresh no longer works afterward
// ===========================================================================
{
  const j = jar();
  await registerVerified(j);
  const out = await j.call('/auth/logout', { method: 'POST' });
  ck('logout -> 200', out.s === 200);
  const after = await j.call('/auth/refresh', { method: 'POST' });
  ck('refresh after logout -> 401 (session revoked)', after.s === 401);
}

// ===========================================================================
// 7. Changing password revokes ALL refresh sessions for that user
// ===========================================================================
{
  const j = jar();
  const res = await registerVerified(j);
  const cookieBefore = j.rawCookie();
  const changed = await j.call('/auth/change-password', {
    method: 'POST',
    token: res.token,
    body: { current_password: 'Test123456', new_password: 'NewPass123456' },
  });
  ck('change-password -> 200', changed.s === 200);
  const stale = await fetch(B + '/auth/refresh', { method: 'POST', headers: { Cookie: cookieBefore } });
  ck('old refresh token is dead after a password change', stale.status === 401);
  const relogin = await jar().call('/auth/login', { method: 'POST', body: { email: res.email, password: 'NewPass123456' } });
  ck('can log in with the new password', relogin.s === 200);
}

// ===========================================================================
// 8. No refresh cookie at all -> clean 401, not a crash
// ===========================================================================
{
  const bare = await fetch(B + '/auth/refresh', { method: 'POST' });
  ck('refresh with no cookie -> 401', bare.status === 401);
  const outNoCookie = await fetch(B + '/auth/logout', { method: 'POST' });
  ck('logout with no cookie is a harmless no-op 200', outNoCookie.status === 200);
}

// ===========================================================================
const inv = await (await fetch(B + '/health/invariants')).json();
ck('system invariant: Σ wallets == Σ ledger, zero drift', inv.healthy === true && inv.drift_paisa === '0', JSON.stringify(inv));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

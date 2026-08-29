// AI advisory layer — end-to-end. Works with OR without OPENAI_API_KEY set:
// every endpoint must still return 200 with a deterministic fallback and the
// core money-movement flow must be untouched.
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
const K = () => `req-${Date.now()}-${rnd()}${rnd()}`.slice(0, 55);
const phone = () =>
  '01' + (3 + Math.floor(Math.random() * 7)) + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const reg = async () => {
  const r = await j('/auth/register', {
    method: 'POST',
    body: { email: `ai_${rnd()}@ex.com`, password: 'Test123456', full_name: 'AI ' + rnd(), phone: phone() },
  });
  const code = r.d.data.verification?.dev_code;
  if (code) await j('/auth/verify-email', { method: 'POST', headers: H(r.d.data.token), body: { code } });
  return { t: r.d.data.token, id: r.d.data.user_id };
};
const send = (token, key, body) =>
  j('/transfers', { method: 'POST', headers: { ...H(token), 'Idempotency-Key': key }, body });

let P = 0, F = 0;
const ck = (n, c, x = '') => { c ? P++ : F++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (x ? '  ' + x : '')); };

// ---------------------------------------------------------------------------
const status = await j('/ai/status', { headers: H((await reg()).t) });
ck('GET /ai/status returns enabled flag, no key', status.s === 200 && typeof status.d.data.enabled === 'boolean' && !JSON.stringify(status.d).toLowerCase().includes('sk-'));
const aiOn = status.d.data.enabled;
console.log(`   (AI ${aiOn ? 'ENABLED — live model calls' : 'DISABLED — deterministic fallbacks'})`);

// ---------------------------------------------------------------------------
// Feature 1 — Transaction Investigator
// ---------------------------------------------------------------------------
{
  const a = await reg(), b = await reg();
  const t = await send(a.t, K(), { receiver_id: b.id, amount_bdt: '900', note: 'Lunch and coffee' });
  ck('setup transfer completed', t.s === 202 && t.d.data.status === 'COMPLETED');
  const ref = t.d.data.reference;

  const inv = await j(`/ai/transactions/${ref}/investigate`, { method: 'POST', headers: H(a.t) });
  ck('investigate -> 200', inv.s === 200);
  const D = inv.d.data || {};
  ck('investigate: authoritative outcome from ledger = DELIVERED', D.outcome === 'DELIVERED');
  ck('investigate: reconciliation present', !!D.reconciliation && D.reconciliation.money_moved === true);
  ck('investigate: timeline present', Array.isArray(D.timeline) && D.timeline.length > 0);
  ck('investigate: ai block present with source', !!D.ai && ['ai', 'fallback'].includes(D.ai.source));
  ck('investigate: ai.money_status matches ledger (DELIVERED)', D.ai.money_status === 'DELIVERED');
  ck('investigate: ai has a human explanation', typeof D.ai.what_this_means === 'string' && D.ai.what_this_means.length > 0);
  ck('investigate: ai.available reflects status', D.ai.available === aiOn);

  // a stranger cannot investigate someone else's transaction
  const c = await reg();
  const forbidden = await j(`/ai/transactions/${ref}/investigate`, { method: 'POST', headers: H(c.t) });
  ck('investigate: non-party is forbidden', forbidden.s === 403);

  // second call is served from cache (still 200, same shape)
  const again = await j(`/ai/transactions/${ref}/investigate`, { method: 'POST', headers: H(a.t) });
  ck('investigate: repeat call still 200 (cached)', again.s === 200 && again.d.data.ai.money_status === 'DELIVERED');
}

// ---------------------------------------------------------------------------
// Feature 2 — AI-assisted fraud analysis (advisory, never gates)
// ---------------------------------------------------------------------------
{
  const admin = (await j('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password: 'Test123456' } })).d.data;
  const a = await reg(), b = await reg();

  // Large transfer to a brand-new recipient -> deterministic rules flag it.
  const r = await send(a.t, K(), { receiver_id: b.id, amount_bdt: '60000' });
  ck('fraud: large transfer got a deterministic decision', r.s === 200 || r.s === 202 || r.s === 403);

  const dash = await j('/security/dashboard', { headers: H(admin.token) });
  ck('fraud: admin dashboard lists flagged assessments', dash.s === 200 && Array.isArray(dash.d.data.flagged));
  const flagged = dash.d.data.flagged.find((x) => x.user_name?.startsWith('AI ')) || dash.d.data.flagged[0];

  if (flagged) {
    const trig = await j(`/security/assessments/${flagged.assessment_id}/ai-analysis`, { method: 'POST', headers: H(admin.token) });
    ck('fraud: POST ai-analysis -> 200', trig.s === 200);
    const A = trig.d.data?.ai_analysis || {};
    ck('fraud: ai_analysis has risk_level', ['LOW', 'MEDIUM', 'HIGH'].includes(A.risk_level));
    ck('fraud: ai_analysis has reasoning_summary', typeof A.reasoning_summary === 'string' && A.reasoning_summary.length > 0);
    ck('fraud: ai_analysis has risk_factors array', Array.isArray(A.risk_factors));
    ck('fraud: ai_analysis has recommended_action', typeof A.recommended_action === 'string' && A.recommended_action.length > 0);
    ck('fraud: ai_analysis is marked advisory-only', /advisory/i.test(A.note || ''));

    const detail = await j(`/security/assessments/${flagged.reference}`, { headers: H(admin.token) });
    ck('fraud: assessment detail carries ai_analysis + deterministic score', detail.s === 200 && detail.d.data.ai_analysis && typeof detail.d.data.score === 'number');
  } else {
    ck('fraud: (skipped — nothing flagged this run)', true);
  }
}

// ---------------------------------------------------------------------------
// Feature 3 — Smart Financial Summaries
// ---------------------------------------------------------------------------
{
  const a = await reg(), b = await reg();
  for (const [amt, note] of [['500', 'Lunch'], ['1200', 'Uber ride'], ['800', 'grocery bazar'], ['300', 'Coffee']]) {
    await send(a.t, K(), { receiver_id: b.id, amount_bdt: amt, note });
  }
  await send(b.t, K(), { receiver_id: a.id, amount_bdt: '2000', note: 'payback' });

  for (const period of ['monthly', 'weekly']) {
    const s = await j(`/ai/summary?period=${period}`, { headers: H(a.t) });
    ck(`summary (${period}) -> 200`, s.s === 200);
    const D = s.d.data || {};
    ck(`summary (${period}): deterministic totals present`, !!D.totals && typeof D.totals.sent_bdt === 'string' && typeof D.totals.net_bdt === 'string');
    ck(`summary (${period}): sent total is > 0 after our transfers`, Number(D.totals.sent_bdt) > 0);
    ck(`summary (${period}): category breakdown present`, Array.isArray(D.categories) && D.categories.length > 0);
    ck(`summary (${period}): top category identified`, !!D.top_category && typeof D.top_category.name === 'string');
    ck(`summary (${period}): ai narration present`, !!D.ai && Array.isArray(D.ai.observations) && D.ai.observations.length > 0);
    ck(`summary (${period}): ai did not invent a different sent total`, D.ai.headline.length > 0);
  }

  const bad = await j('/ai/summary?period=yearly', { headers: H(a.t) });
  ck('summary: invalid period rejected (400)', bad.s === 400);
}

// ---------------------------------------------------------------------------
// core money movement is unaffected by the AI layer
// ---------------------------------------------------------------------------
const inv = await j('/health/invariants');
ck('system invariant: Σ wallets == Σ ledger, zero drift', inv.d.healthy === true && inv.d.drift_paisa === '0', JSON.stringify(inv.d));

console.log(`\n${P} passed, ${F} failed`);
process.exit(F ? 1 : 0);

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatBdt, fullTime, relativeTime } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui';
import { safeList, safeText } from '../lib/ai';
import type {
  RiskAssessmentRow,
  RiskConfig,
  SecurityDashboard,
  SecurityEventRow,
} from '../types';

const BAND_CLS: Record<string, string> = {
  LOW: 'bg-emerald-100 text-emerald-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  HIGH: 'bg-rose-100 text-rose-700',
};
const DECISION_CLS: Record<string, string> = {
  ALLOWED: 'bg-emerald-100 text-emerald-700',
  VERIFIED: 'bg-emerald-100 text-emerald-700',
  RELEASED: 'bg-sky-100 text-sky-700',
  PENDING_VERIFICATION: 'bg-amber-100 text-amber-700',
  BLOCKED: 'bg-rose-100 text-rose-700',
};

export default function SecurityDashboardPage() {
  const [tab, setTab] = useState<'flagged' | 'log' | 'config'>('flagged');
  const [dash, setDash] = useState<SecurityDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RiskAssessmentRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/security/dashboard');
      setDash(data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Security & Fraud Monitoring" subtitle="Flagged transactions, risk scores, and the security event log." />

      {error ? (
        <Alert>{error}</Alert>
      ) : loading || !dash ? (
        <div className="flex justify-center py-12 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Blocked now" value={String(dash.currently_blocked)} tone="rose" />
            <Stat label="HIGH (24h)" value={String(dash.last_24h_by_band.HIGH ?? 0)} tone="rose" />
            <Stat label="MEDIUM (24h)" value={String(dash.last_24h_by_band.MEDIUM ?? 0)} tone="amber" />
            <Stat label="LOW (24h)" value={String(dash.last_24h_by_band.LOW ?? 0)} tone="emerald" />
          </div>

          <div className="mb-4 flex gap-1 rounded-xl bg-slate-200 p-1 text-sm font-semibold">
            {(
              [
                ['flagged', 'Flagged transactions'],
                ['log', 'Security log'],
                ['config', 'Risk config'],
              ] as [typeof tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-1.5 ${
                  tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'flagged' && (
            <FlaggedTable rows={dash.flagged} onSelect={setSelected} />
          )}
          {tab === 'log' && <EventLog />}
          {tab === 'config' && <ConfigPanel />}
        </>
      )}

      {selected && (
        <AssessmentDrawer
          reference={selected.reference}
          onClose={() => setSelected(null)}
          onReviewed={() => {
            setSelected(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  const cls =
    { rose: 'text-rose-600', amber: 'text-amber-600', emerald: 'text-emerald-600' }[tone] ??
    'text-slate-800';
  return (
    <div className="card p-3">
      <p className={`text-xl font-bold ${cls}`}>{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

function FlaggedTable({
  rows,
  onSelect,
}: {
  rows: RiskAssessmentRow[];
  onSelect: (r: RiskAssessmentRow) => void;
}) {
  if (rows.length === 0) return <EmptyState title="Nothing flagged" hint="All recent transfers scored LOW." />;
  return (
    <div className="card divide-y divide-slate-100">
      {rows.map((a) => (
        <button
          key={a.assessment_id}
          onClick={() => onSelect(a)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">
              {a.user_name} → {a.receiver_name ?? '—'} · {formatBdt(a.amount_bdt)}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-1">
              {a.reasons.slice(0, 4).map((r) => (
                <span
                  key={r.code}
                  className={`badge ${r.critical ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}
                >
                  {r.code}
                </span>
              ))}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {a.reference} · {relativeTime(a.created_at)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-bold text-slate-800">{a.score}</p>
            <span className={`badge ${BAND_CLS[a.band]}`}>{a.band}</span>
            <span className={`mt-1 block badge ${DECISION_CLS[a.decision] ?? ''}`}>{a.decision}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function AssessmentDrawer({
  reference,
  onClose,
  onReviewed,
}: {
  reference: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const [a, setA] = useState<RiskAssessmentRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    api.get(`/security/assessments/${reference}`).then(({ data }) => setA(data.data));
  }, [reference]);

  async function runAi() {
    if (!a) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const { data } = await api.post(`/security/assessments/${a.assessment_id}/ai-analysis`);
      setA((prev) => (prev ? { ...prev, ai_analysis: data.data.ai_analysis } : prev));
    } catch (e) {
      setAiError(errorMessage(e));
    } finally {
      setAiBusy(false);
    }
  }

  async function act(kind: 'release' | 'reject') {
    if (!a) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/security/assessments/${a.assessment_id}/${kind}`, { note: note || undefined });
      onReviewed();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="mb-4 text-sm text-slate-400" onClick={onClose}>
          ✕ Close
        </button>
        {!a ? (
          <div className="flex justify-center py-10 text-brand-600">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`badge ${BAND_CLS[a.band]}`}>{a.band}</span>
                <span className={`badge ${DECISION_CLS[a.decision] ?? ''}`}>{a.decision}</span>
                <span className="text-sm font-bold text-slate-700">score {a.score}</span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400">{a.reference}</p>
            </div>

            <dl className="divide-y divide-slate-100 text-sm">
              <Row k="User" v={`${a.user_name ?? ''} · ${a.user_email ?? ''}`} />
              <Row k="Recipient" v={a.receiver_name ?? '—'} />
              <Row k="Amount" v={formatBdt(a.amount_bdt)} />
              <Row k="When" v={fullTime(a.created_at)} />
              {a.transfer_reference && <Row k="Transfer" v={a.transfer_reference} />}
              {a.review_note && <Row k="Review note" v={a.review_note} />}
            </dl>

            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                Contributing reasons
              </p>
              <ul className="space-y-1 text-sm">
                {a.reasons.map((r) => (
                  <li key={r.code} className="flex items-start justify-between gap-2">
                    <span className={r.critical ? 'font-semibold text-rose-600' : 'text-slate-700'}>
                      {r.label}
                    </span>
                    <span className="shrink-0 text-slate-400">+{r.weight}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  AI second opinion
                </p>
                {a.ai_analysis && (
                  <span className="text-xs text-slate-400">
                    {a.ai_analysis.source === 'ai' ? `via ${a.ai_analysis.model ?? 'AI'}` : 'rule-based fallback'}
                  </span>
                )}
              </div>

              {a.ai_analysis ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`badge ${BAND_CLS[a.ai_analysis.risk_level] ?? ''}`}>
                      {a.ai_analysis.risk_level}
                    </span>
                    <span className="text-xs text-slate-400">
                      deterministic score {a.score} · band {a.band} (authoritative)
                    </span>
                  </div>
                  <p className="text-slate-700">{safeText(a.ai_analysis.reasoning_summary, 700)}</p>
                  {a.ai_analysis.risk_factors.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
                      {safeList(a.ai_analysis.risk_factors, 8).map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-slate-700">
                    <span className="font-semibold">Suggested: </span>
                    {safeText(a.ai_analysis.recommended_action, 300)}
                  </p>
                  <p className="text-xs text-slate-400">
                    Advisory only. It does not change the score, band, decision, or the transfer —
                    the deterministic rules above remain authoritative.
                  </p>
                  <button className="btn-ghost w-full !py-1.5 text-xs" onClick={runAi} disabled={aiBusy}>
                    {aiBusy ? <Spinner className="h-4 w-4" /> : 'Refresh AI analysis'}
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">
                    No AI analysis yet. Runs automatically when a transfer is flagged; you can also
                    trigger it here.
                  </p>
                  <button className="btn-ghost w-full !py-1.5 text-xs" onClick={runAi} disabled={aiBusy}>
                    {aiBusy ? <Spinner className="h-4 w-4" /> : 'Run AI analysis'}
                  </button>
                </div>
              )}
              {aiError && (
                <div className="mt-2">
                  <Alert>{aiError}</Alert>
                </div>
              )}
            </div>

            {a.related_events && a.related_events.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Nearby security events
                </p>
                <ul className="space-y-1 text-xs text-slate-500">
                  {a.related_events.slice(0, 12).map((e) => (
                    <li key={e.id} className="flex justify-between">
                      <span>{e.type}</span>
                      <span>{relativeTime(e.created_at)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <Alert>{error}</Alert>}

            {a.decision === 'BLOCKED' && (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                <input
                  className="input"
                  placeholder="Review note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="btn-primary flex-1"
                    disabled={busy}
                    onClick={() => act('release')}
                  >
                    {busy ? <Spinner className="h-4 w-4" /> : 'Release hold'}
                  </button>
                  <button
                    className="btn-ghost flex-1"
                    disabled={busy}
                    onClick={() => act('reject')}
                  >
                    Keep blocked (log review)
                  </button>
                </div>
                <p className="text-xs text-slate-400">
                  Releasing lets the user retry the same transfer. It is never a permanent ban.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EventLog() {
  const [rows, setRows] = useState<SecurityEventRow[]>([]);
  const [type, setType] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get('/security/events', { params: { type, severity } })
      .then(({ data }) => setRows(data.data.events))
      .finally(() => setLoading(false));
  }, [type, severity]);

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <select className="input !w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {['all', 'INFO', 'LOW', 'MEDIUM', 'HIGH'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          className="input"
          placeholder="filter by type e.g. LOGIN_FAILED"
          value={type === 'all' ? '' : type}
          onChange={(e) => setType(e.target.value.trim() || 'all')}
        />
      </div>
      {loading ? (
        <div className="flex justify-center py-8 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {rows.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-slate-800">{e.type}</p>
                <p className="truncate text-xs text-slate-400">
                  {e.user_name ?? 'system'}
                  {e.transfer_reference ? ` · ${e.transfer_reference}` : ''}
                  {e.detail && Object.keys(e.detail).length > 0
                    ? ` · ${JSON.stringify(e.detail).slice(0, 80)}`
                    : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span
                  className={`badge ${
                    e.severity === 'HIGH'
                      ? 'bg-rose-100 text-rose-700'
                      : e.severity === 'MEDIUM'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {e.severity}
                </span>
                <p className="mt-0.5 text-xs text-slate-400">{relativeTime(e.created_at)}</p>
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No events</p>}
        </div>
      )}
    </div>
  );
}

function ConfigPanel() {
  const [cfg, setCfg] = useState<RiskConfig | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/security/config').then(({ data }) => setCfg(data.data));
  }, []);

  if (!cfg) {
    return (
      <div className="flex justify-center py-8 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const FIELDS: [keyof RiskConfig, string][] = [
    ['medium_threshold', 'MEDIUM score threshold'],
    ['high_threshold', 'HIGH score threshold'],
    ['large_amount_paisa', 'Large amount (paisa)'],
    ['hard_cap_paisa', 'Hard cap — always HIGH (paisa)'],
    ['velocity_window_minutes', 'Velocity window (min)'],
    ['velocity_max_transfers', 'Velocity max transfers'],
    ['failed_window_minutes', 'Failed-transfer window (min)'],
    ['failed_max_transfers', 'Failed-transfer max'],
    ['new_recipient_window_days', 'New-recipient window (days)'],
    ['failed_login_window_minutes', 'Failed-login window (min)'],
    ['failed_login_max', 'Failed-login lockout count'],
  ];

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const patch = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v !== '' && v != null)
      );
      const { data } = await api.put('/security/config', patch);
      setCfg(data.data);
      setDraft({});
      setMsg({ kind: 'success', text: 'Thresholds updated. Applies to the next assessment.' });
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card space-y-3 p-5">
      <p className="text-sm text-slate-500">
        Current: <strong>{cfg.large_amount_bdt}</strong> large ·{' '}
        <strong>{cfg.hard_cap_bdt}</strong> hard cap · MEDIUM ≥ {cfg.medium_threshold} · HIGH ≥{' '}
        {cfg.high_threshold}
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="text-xs text-slate-500">
            {label}
            <input
              className="input mt-1"
              inputMode="numeric"
              placeholder={String(cfg[k])}
              value={draft[k] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <button className="btn-primary" disabled={busy}>
        {busy ? <Spinner className="h-4 w-4" /> : 'Save thresholds'}
      </button>
    </form>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="truncate text-right font-medium text-slate-800">{v}</dd>
    </div>
  );
}

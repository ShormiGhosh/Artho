import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, newIdempotencyKey } from '../lib/api';
import { formatBdt, fullTime, relativeTime, validAmount } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import UserSearch from '../components/UserSearch';
import type {
  Beneficiary,
  BulkPreview,
  Disbursement,
  StipendProgram,
  UserResult,
} from '../types';

type Tab = 'beneficiaries' | 'disburse' | 'history';

export default function ProgramDetailPage() {
  const { reference } = useParams();
  const { me, refresh } = useAuth();
  const [program, setProgram] = useState<StipendProgram | null>(null);
  const [tab, setTab] = useState<Tab>('beneficiaries');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProgram = useCallback(async () => {
    try {
      const { data } = await api.get(`/stipend-programs/${reference}`);
      setProgram(data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    loadProgram();
  }, [loadProgram]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (error || !program) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Alert>{error ?? 'Not found'}</Alert>
        <Link to="/programs" className="btn-ghost">
          Back to programmes
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={program.name}
        subtitle={`${program.reference} · disbursing wallet: ${
          me ? formatBdt(me.wallet.balance_bdt) : '—'
        }`}
      />

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <span className="badge bg-gold-100 text-gold-800">{program.category}</span>
        <StatusBadge status={program.status} />
        <span className="text-sm text-slate-500">
          {program.beneficiary_count ?? 0} active beneficiaries ·{' '}
          {formatBdt(program.total_disbursed_bdt ?? '0')} disbursed
        </span>
        {program.status === 'ACTIVE' && (
          <button
            className="btn-ghost ml-auto !py-1.5 text-xs"
            onClick={async () => {
              if (!confirm('Close this programme? No further disbursements will be possible.')) return;
              await api.post(`/stipend-programs/${program.reference}/close`).catch(() => undefined);
              loadProgram();
            }}
          >
            Close programme
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-1 rounded-xl bg-slate-200 p-1 text-sm font-semibold">
        {([
          ['beneficiaries', 'Beneficiaries'],
          ['disburse', 'Disburse'],
          ['history', 'Disbursements'],
        ] as [Tab, string][]).map(([t, label]) => (
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

      {tab === 'beneficiaries' && (
        <BeneficiariesTab program={program} onChange={loadProgram} />
      )}
      {tab === 'disburse' && (
        <DisburseTab
          program={program}
          onDone={() => {
            loadProgram();
            refresh();
          }}
        />
      )}
      {tab === 'history' && <HistoryTab program={program} />}
    </div>
  );
}

/* ---------------- Beneficiaries ---------------- */

function BeneficiariesTab({
  program,
  onChange,
}: {
  program: StipendProgram;
  onChange: () => void;
}) {
  const [rows, setRows] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [picked, setPicked] = useState<UserResult | null>(null);
  const [nid, setNid] = useState('');
  const [school, setSchool] = useState('');
  const [amount, setAmount] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/stipend-programs/${program.reference}/beneficiaries`);
      setRows(data.data);
    } finally {
      setLoading(false);
    }
  }, [program.reference]);

  useEffect(() => {
    load();
  }, [load]);

  async function enroll(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!picked) return;
    if (!/^(\d{10}|\d{13}|\d{17})$/.test(nid.trim())) {
      setError('Guardian NID must be 10, 13 or 17 digits.');
      return;
    }
    if (amount && !validAmount(amount)) {
      setError('Default amount must be a positive number with at most 2 decimals.');
      return;
    }
    setEnrolling(true);
    try {
      await api.post(`/stipend-programs/${program.reference}/beneficiaries`, {
        user_id: picked.user_id,
        guardian_nid: nid.trim(),
        institution_name: school.trim(),
        default_amount_bdt: amount.trim() || undefined,
      });
      setPicked(null);
      setNid('');
      setSchool('');
      setAmount('');
      await load();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEnrolling(false);
    }
  }

  async function setStatus(b: Beneficiary, status: 'ACTIVE' | 'SUSPENDED') {
    setBusyId(b.beneficiary_id);
    try {
      await api.patch(
        `/stipend-programs/${program.reference}/beneficiaries/${b.beneficiary_id}`,
        { status }
      );
      await load();
      onChange();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(b: Beneficiary) {
    if (!confirm(`Remove ${b.user_name} from this programme?`)) return;
    setBusyId(b.beneficiary_id);
    try {
      await api.delete(
        `/stipend-programs/${program.reference}/beneficiaries/${b.beneficiary_id}`
      );
      await load();
      onChange();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {program.status === 'ACTIVE' && (
        <form onSubmit={enroll} className="card space-y-3 p-5">
          <p className="text-sm font-bold uppercase tracking-wide text-slate-500">
            Enrol a beneficiary
          </p>
          {error && <Alert>{error}</Alert>}
          {!picked ? (
            <UserSearch onSelect={setPicked} />
          ) : (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                {picked.full_name.charAt(0)}
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-slate-800">{picked.full_name}</p>
                <p className="text-xs text-slate-400">{picked.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-xs font-semibold text-brand-600 hover:underline"
              >
                Change
              </button>
            </div>
          )}
          {picked && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Guardian NID</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="10 / 13 / 17 digits"
                    value={nid}
                    onChange={(e) => setNid(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label">Default amount (optional)</label>
                  <input
                    className="input"
                    inputMode="decimal"
                    placeholder="e.g. 500"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="label">Institution / school</label>
                <input
                  className="input"
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  required
                />
              </div>
              <p className="text-xs text-slate-400">
                The guardian NID must match the NID on the beneficiary's Artho account (it is
                linked on first enrolment). Funds carry no cash-out fee.
              </p>
              <button className="btn-primary" disabled={enrolling}>
                {enrolling ? <Spinner className="h-4 w-4" /> : 'Enrol beneficiary'}
              </button>
            </>
          )}
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No beneficiaries enrolled yet" />
      ) : (
        <div className="card divide-y divide-slate-100">
          {rows.map((b) => (
            <div key={b.beneficiary_id} className="flex items-start gap-3 p-4">
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                  b.eligible ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
                title={b.eligible ? 'Eligible' : 'Not eligible for disbursement'}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800">{b.user_name}</p>
                <p className="text-xs text-slate-400">
                  {b.institution_name} · NID {b.guardian_nid} · acct {b.account_status}
                </p>
                <p className="text-xs text-slate-400">
                  {b.default_amount_bdt
                    ? `Default ${formatBdt(b.default_amount_bdt)}`
                    : 'No default amount'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <StatusBadge status={b.status} />
                <div className="flex gap-2 text-xs">
                  {b.status === 'ACTIVE' ? (
                    <button
                      className="text-amber-600 hover:underline"
                      disabled={busyId === b.beneficiary_id}
                      onClick={() => setStatus(b, 'SUSPENDED')}
                    >
                      Suspend
                    </button>
                  ) : (
                    <button
                      className="text-emerald-600 hover:underline"
                      disabled={busyId === b.beneficiary_id}
                      onClick={() => setStatus(b, 'ACTIVE')}
                    >
                      Activate
                    </button>
                  )}
                  <button
                    className="text-rose-600 hover:underline"
                    disabled={busyId === b.beneficiary_id}
                    onClick={() => remove(b)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Disburse ---------------- */

/** Parse pasted roster text: `identifier[, amount]` per line. */
function parseRoster(text: string): Array<{ email?: string; nid?: string; amount_bdt?: string }> {
  const out: Array<{ email?: string; nid?: string; amount_bdt?: string }> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [idRaw, amtRaw] = line.split(/[,\t;]/).map((s) => s.trim());
    if (!idRaw || /^(email|nid|identifier)$/i.test(idRaw)) continue; // skip header
    const row: { email?: string; nid?: string; amount_bdt?: string } = {};
    if (idRaw.includes('@')) row.email = idRaw.toLowerCase();
    else if (/^\d{10}$|^\d{13}$|^\d{17}$/.test(idRaw)) row.nid = idRaw;
    else continue;
    if (amtRaw && /^\d+(\.\d{1,2})?$/.test(amtRaw)) row.amount_bdt = amtRaw;
    out.push(row);
  }
  return out;
}

function DisburseTab({
  program,
  onDone,
}: {
  program: StipendProgram;
  onDone: () => void;
}) {
  const { me } = useAuth();
  const [tab, setTab] = useState<'standard' | 'bulk'>('standard');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Disbursement | null>(null);

  // standard
  const [amountMode, setAmountMode] = useState<'default' | 'flat'>('default');
  const [flat, setFlat] = useState('');

  // bulk
  const [roster, setRoster] = useState('');
  const [bulkDefault, setBulkDefault] = useState('');
  const [autoEnroll, setAutoEnroll] = useState(false);
  const [autoInstitution, setAutoInstitution] = useState('');
  const [preview, setPreview] = useState<BulkPreview | null>(null);

  const disabled = program.status !== 'ACTIVE';
  const rosterRows = useMemo(() => parseRoster(roster), [roster]);

  async function pollUntilDone(reference: string) {
    // Terminal states stop the poll; the batch runs server-side.
    for (let i = 0; i < 120; i++) {
      const { data } = await api.get(`/stipend-disbursements/${reference}`);
      setResult(data.data as Disbursement);
      if (data.data.status !== 'PROCESSING') {
        onDone();
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  async function runStandard() {
    setError(null);
    if (amountMode === 'flat' && !validAmount(flat)) {
      setError('Enter a valid flat amount.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { note: note.trim() || undefined };
      if (amountMode === 'flat') body.amount_bdt = flat.trim();
      const { data } = await api.post(`/stipend-programs/${program.reference}/disburse`, body, {
        headers: { 'Idempotency-Key': newIdempotencyKey(me!.user_id) },
      });
      setResult(data.data as Disbursement);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function bulkBody(dryRun: boolean) {
    return {
      dry_run: dryRun,
      note: note.trim() || undefined,
      default_amount_bdt: bulkDefault.trim() || undefined,
      auto_enroll: autoEnroll || undefined,
      default_institution_name: autoEnroll ? autoInstitution.trim() || undefined : undefined,
      rows: rosterRows,
    };
  }

  async function runPreview() {
    setError(null);
    setPreview(null);
    if (rosterRows.length === 0) {
      setError('Paste at least one row (email or NID, optionally a comma and amount).');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(
        `/stipend-programs/${program.reference}/bulk-disburse`,
        bulkBody(true)
      );
      setPreview(data.data as BulkPreview);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runBulk() {
    setError(null);
    if (rosterRows.length === 0) {
      setError('Nothing to disburse.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(
        `/stipend-programs/${program.reference}/bulk-disburse`,
        bulkBody(false),
        { headers: { 'Idempotency-Key': newIdempotencyKey(me!.user_id) } }
      );
      const d = data.data as Disbursement;
      setResult(d);
      setPreview(null);
      if (d.status === 'PROCESSING') pollUntilDone(d.reference);
      else onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const processing = result.status === 'PROCESSING';
    const pct = result.total_count
      ? Math.round(((result.processed_count ?? 0) / result.total_count) * 100)
      : 0;
    return (
      <div className="space-y-4">
        <div className="card p-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-xl">
            {processing ? '⏳' : result.status === 'COMPLETED' ? '✓' : result.status === 'FAILED' ? '✗' : '≈'}
          </div>
          <p className="mt-2 text-lg font-bold">
            {processing ? 'Disbursing…' : `Disbursement ${result.status.toLowerCase()}`}
          </p>
          <p className="text-sm text-slate-500">
            {result.reference} · {result.mode === 'BULK' ? 'bulk' : 'standard'} ·{' '}
            paid {result.success_count}/{result.total_count} · {formatBdt(result.total_amount_bdt)}
          </p>
          {processing && (
            <div className="mx-auto mt-3 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mt-2 flex flex-wrap justify-center gap-2 text-xs">
            <span className="badge bg-emerald-100 text-emerald-700">{result.success_count} paid</span>
            {result.failed_count > 0 && (
              <span className="badge bg-rose-100 text-rose-700">{result.failed_count} failed</span>
            )}
            {result.skipped_count > 0 && (
              <span className="badge bg-slate-200 text-slate-600">{result.skipped_count} skipped</span>
            )}
            {!!result.unresolved_count && (
              <span className="badge bg-amber-100 text-amber-700">
                {result.unresolved_count} unresolved
              </span>
            )}
          </div>
        </div>

        <DisbursementItems items={result.items ?? []} />
        <UnresolvedList rows={result.unresolved ?? []} />

        {!processing && (
          <button className="btn-ghost w-full" onClick={() => setResult(null)}>
            New disbursement
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="card space-y-4 p-5">
      {disabled && <Alert kind="info">This programme is closed — disbursement is disabled.</Alert>}
      {error && <Alert>{error}</Alert>}

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
        {(['standard', 'bulk'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setPreview(null);
            }}
            className={`flex-1 rounded-lg py-1.5 ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {t === 'standard' ? 'Standard' : 'Bulk roster'}
          </button>
        ))}
      </div>

      <div>
        <label className="label">Note (optional)</label>
        <input
          className="input"
          maxLength={255}
          placeholder="Q1 2026 quarterly stipend"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {tab === 'standard' ? (
        <>
          <div>
            <label className="label">Amount</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={amountMode === 'default'}
                  onChange={() => setAmountMode('default')}
                />
                Use each beneficiary's default amount
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={amountMode === 'flat'}
                  onChange={() => setAmountMode('flat')}
                />
                Flat amount for everyone
                <input
                  className="input !w-32"
                  inputMode="decimal"
                  placeholder="500.00"
                  value={flat}
                  disabled={amountMode !== 'flat'}
                  onChange={(e) => setFlat(e.target.value)}
                />
              </label>
            </div>
          </div>
          <Alert kind="info">
            Each beneficiary is paid atomically from your programme wallet. Retrying with the
            same request resumes the batch — nobody is paid twice.
          </Alert>
          <button className="btn-primary w-full" disabled={busy || disabled} onClick={runStandard}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Run disbursement'}
          </button>
        </>
      ) : (
        <>
          <div>
            <label className="label">
              Roster — one per line: <span className="font-mono text-xs">email or NID, amount</span>
            </label>
            <textarea
              className="input font-mono text-xs"
              rows={7}
              placeholder={'fatima@example.com, 500\n1990123456789, 750\narjun@example.com'}
              value={roster}
              onChange={(e) => setRoster(e.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              {rosterRows.length} valid row{rosterRows.length === 1 ? '' : 's'} detected. Amount is
              optional — falls back to the beneficiary default, then the value below.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Default amount (fallback)</label>
              <input
                className="input"
                inputMode="decimal"
                placeholder="400.00"
                value={bulkDefault}
                onChange={(e) => setBulkDefault(e.target.value)}
              />
            </div>
            <label className="flex items-end gap-2 pb-2.5 text-sm">
              <input
                type="checkbox"
                checked={autoEnroll}
                onChange={(e) => setAutoEnroll(e.target.checked)}
              />
              Auto-enrol new beneficiaries
            </label>
          </div>
          {autoEnroll && (
            <div>
              <label className="label">Institution for auto-enrolled rows</label>
              <input
                className="input"
                value={autoInstitution}
                onChange={(e) => setAutoInstitution(e.target.value)}
                placeholder="Government Primary School"
              />
              <p className="mt-1 text-xs text-slate-400">
                A row is auto-enrolled only if the account already has a matching NID on file (or the
                row carries one).
              </p>
            </div>
          )}

          {preview && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-800">
                Preview · {preview.resolved_count} will be paid ·{' '}
                {formatBdt(preview.total_amount_bdt)}
                {preview.will_auto_enroll > 0 && ` · ${preview.will_auto_enroll} new`}
              </p>
              {preview.unresolved_count > 0 && (
                <p className="mt-1 text-amber-700">
                  {preview.unresolved_count} row(s) will be skipped.
                </p>
              )}
              <UnresolvedList rows={preview.unresolved} compact />
            </div>
          )}

          <Alert kind="info">
            Bulk runs in the background; this screen polls for progress. Retrying with the same
            request resumes the same batch — exactly-once per beneficiary.
          </Alert>

          <div className="flex gap-2">
            <button
              className="btn-ghost flex-1"
              disabled={busy || rosterRows.length === 0}
              onClick={runPreview}
            >
              {busy && !preview ? <Spinner className="h-4 w-4" /> : 'Preview'}
            </button>
            <button
              className="btn-primary flex-1"
              disabled={busy || disabled || rosterRows.length === 0}
              onClick={runBulk}
            >
              Run bulk disbursement
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function UnresolvedList({
  rows,
  compact,
}: {
  rows: { row: Record<string, unknown>; reason: string }[];
  compact?: boolean;
}) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className={compact ? 'mt-2' : 'card'}>
      {!compact && (
        <p className="border-b border-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500">
          Unresolved ({rows.length})
        </p>
      )}
      <ul className={compact ? 'space-y-1 text-xs' : 'divide-y divide-slate-100'}>
        {rows.slice(0, 100).map((u, i) => (
          <li
            key={i}
            className={compact ? 'flex justify-between' : 'flex justify-between px-4 py-2 text-sm'}
          >
            <span className="truncate text-slate-600">
              {String(u.row.email ?? u.row.nid ?? u.row.user_id ?? '—')}
            </span>
            <span className="ml-2 shrink-0 font-medium text-amber-700">{u.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DisbursementItems({ items }: { items: Disbursement['items'] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="card divide-y divide-slate-100">
      {items.map((it) => (
        <div key={it.item_id} className="flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-800">
              {it.user_name}
            </span>
            {it.failure_reason && (
              <span className="block text-xs text-rose-500">{it.failure_reason}</span>
            )}
            {it.transfer_reference && (
              <Link
                to={`/tx/${it.transfer_reference}`}
                className="block font-mono text-xs text-brand-600 hover:underline"
              >
                {it.transfer_reference}
              </Link>
            )}
          </span>
          <span className="text-right">
            <span className="block text-sm font-bold text-slate-800">{it.amount_display}</span>
            <StatusBadge status={it.status} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Disbursement history ---------------- */

function HistoryTab({ program }: { program: StipendProgram }) {
  const [rows, setRows] = useState<Disbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Disbursement | null>(null);

  useEffect(() => {
    api
      .get(`/stipend-programs/${program.reference}/disbursements`)
      .then(({ data }) => setRows(data.data))
      .finally(() => setLoading(false));
  }, [program.reference]);

  async function toggle(d: Disbursement) {
    if (openId === d.disbursement_id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(d.disbursement_id);
    setDetail(null);
    const { data } = await api.get(`/stipend-disbursements/${d.reference}`);
    setDetail(data.data);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (rows.length === 0) return <EmptyState title="No disbursements yet" />;

  return (
    <div className="space-y-2">
      {rows.map((d) => (
        <div key={d.disbursement_id} className="card overflow-hidden">
          <button
            onClick={() => toggle(d)}
            className="flex w-full items-center gap-3 p-4 text-left hover:bg-slate-50"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-800">
                {formatBdt(d.total_amount_bdt)} · {d.success_count}/{d.total_count} paid
              </span>
              <span className="block text-xs text-slate-400">
                {d.reference} · {relativeTime(d.created_at)}
                {d.note ? ` · ${d.note}` : ''}
              </span>
            </span>
            <StatusBadge status={d.status} />
          </button>
          {openId === d.disbursement_id && (
            <div className="border-t border-slate-100 p-3">
              {!detail ? (
                <div className="flex justify-center py-4 text-brand-600">
                  <Spinner className="h-5 w-5" />
                </div>
              ) : (
                <>
                  <p className="mb-2 px-1 text-xs text-slate-400">
                    Created {fullTime(detail.created_at)}
                  </p>
                  <DisbursementItems items={detail.items ?? []} />
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, newIdempotencyKey } from '../lib/api';
import { formatBdt, fullTime, relativeTime, validAmount } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import UserSearch from '../components/UserSearch';
import type {
  DebtBalance,
  DebtGroup,
  Settlement,
  SettlementPreview,
} from '../types';

function BalanceRow({ b }: { b: DebtBalance }) {
  const cls =
    b.role === 'CREDITOR'
      ? 'text-emerald-600'
      : b.role === 'DEBTOR'
        ? 'text-rose-600'
        : 'text-slate-400';
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="font-medium text-slate-700">{b.full_name}</span>
      <span className={`font-bold ${cls}`}>
        {b.role === 'SETTLED'
          ? 'settled'
          : b.role === 'CREDITOR'
            ? `is owed ${formatBdt(b.net_bdt)}`
            : `owes ${formatBdt(b.net_bdt.replace('-', ''))}`}
      </span>
    </div>
  );
}

export default function GroupDetailPage() {
  const { reference } = useParams();
  const { me, refresh } = useAuth();
  const [group, setGroup] = useState<DebtGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<SettlementPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [settleBusy, setSettleBusy] = useState(false);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/debt-groups/${reference}`);
      setGroup(data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    load();
  }, [load]);

  async function runPreview() {
    setPreviewBusy(true);
    setSettleError(null);
    setSettlement(null);
    try {
      const { data } = await api.get(`/debt-groups/${reference}/settlement-preview`);
      setPreview(data.data as SettlementPreview);
    } catch (e) {
      setSettleError(errorMessage(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function confirmSettle() {
    if (!preview) return;
    setSettleBusy(true);
    setSettleError(null);
    try {
      const { data } = await api.post(
        `/debt-groups/${reference}/settle`,
        { plan_hash: preview.plan_hash },
        { headers: { 'Idempotency-Key': newIdempotencyKey(me!.user_id) } }
      );
      setSettlement(data.data as Settlement);
      setPreview(null);
      await load();
      refresh();
    } catch (e) {
      setSettleError(errorMessage(e));
    } finally {
      setSettleBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (error || !group) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Alert>{error ?? 'Not found'}</Alert>
        <Link to="/groups" className="btn-ghost">
          Back to groups
        </Link>
      </div>
    );
  }

  const canSettle = group.outstanding.pending_debt_count > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader
        title={group.name}
        subtitle={`${group.reference} · ${group.members.length} members`}
      />

      {/* Balances */}
      <div className="card p-5">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Net balances</p>
          <span className="text-sm text-slate-500">
            outstanding {formatBdt(group.outstanding.total_bdt)}
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {group.balances.map((b) => (
            <BalanceRow key={b.user_id} b={b} />
          ))}
        </div>
        <AddMember reference={reference!} onChange={load} />
      </div>

      {/* Record debts / expenses */}
      <RecordPanel group={group} onChange={load} />

      {/* Settle */}
      <div className="card p-5">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          Settle up
        </p>

        {settleError && (
          <div className="mb-3">
            <Alert>{settleError}</Alert>
          </div>
        )}

        {settlement ? (
          <SettlementResult s={settlement} onReset={() => setSettlement(null)} />
        ) : preview ? (
          <PreviewPanel
            p={preview}
            busy={settleBusy}
            onConfirm={confirmSettle}
            onCancel={() => setPreview(null)}
          />
        ) : (
          <>
            <p className="text-sm text-slate-500">
              {canSettle
                ? `Optimise ${group.outstanding.pending_debt_count} outstanding debt(s) into the fewest transfers.`
                : 'Nothing to settle — everyone is square.'}
            </p>
            <button
              className="btn-primary mt-3 w-full"
              disabled={!canSettle || previewBusy}
              onClick={runPreview}
            >
              {previewBusy ? <Spinner className="h-4 w-4" /> : 'Preview settlement'}
            </button>
          </>
        )}
      </div>

      {/* Debt ledger (audit) */}
      <div className="card p-5">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          Debt history ({group.debts.length})
        </p>
        {group.debts.length === 0 ? (
          <EmptyState title="No debts recorded yet" />
        ) : (
          <div className="divide-y divide-slate-100">
            {group.debts.map((d) => (
              <div key={d.debt_id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">
                    <span className="font-semibold">{d.debtor_name}</span> → {d.creditor_name}
                    {d.kind === 'SETTLEMENT_PAYMENT' && (
                      <span className="ml-2 badge bg-slate-200 text-slate-600">payment</span>
                    )}
                    {d.kind === 'EXPENSE_SHARE' && (
                      <span className="ml-2 badge bg-gold-100 text-gold-800">expense</span>
                    )}
                  </p>
                  {d.description && <p className="text-xs text-slate-400">{d.description}</p>}
                  <p className="text-xs text-slate-400">{relativeTime(d.created_at)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-slate-800">{formatBdt(d.amount_bdt)}</p>
                  <StatusBadge status={d.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SettlementHistory reference={reference!} refreshKey={settlement?.reference} />
    </div>
  );
}

/* ------------------------- sub-components ------------------------- */

function AddMember({ reference, onChange }: { reference: string; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      {!open ? (
        <button className="text-xs font-semibold text-brand-600" onClick={() => setOpen(true)}>
          + Add a member
        </button>
      ) : (
        <div className="space-y-2">
          <UserSearch
            onSelect={async (u) => {
              setBusy(true);
              try {
                await api.post(`/debt-groups/${reference}/members`, { user_id: u.user_id });
                onChange();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          />
          {busy && <Spinner className="h-4 w-4 text-brand-600" />}
          <button className="text-xs text-slate-400" onClick={() => setOpen(false)}>
            cancel
          </button>
        </div>
      )}
    </div>
  );
}

function RecordPanel({ group, onChange }: { group: DebtGroup; onChange: () => void }) {
  const [tab, setTab] = useState<'debt' | 'expense'>('debt');
  const members = group.members;
  const ref = group.reference;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // debt form
  const [debtor, setDebtor] = useState(members[0]?.user_id ?? '');
  const [creditor, setCreditor] = useState(members[1]?.user_id ?? '');
  const [dAmount, setDAmount] = useState('');
  const [dDesc, setDDesc] = useState('');

  // expense form
  const [payer, setPayer] = useState(members[0]?.user_id ?? '');
  const [eAmount, setEAmount] = useState('');
  const [eDesc, setEDesc] = useState('');
  const [participants, setParticipants] = useState<string[]>(members.map((m) => m.user_id));

  async function submitDebt(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (debtor === creditor) return setError('Pick two different people.');
    if (!validAmount(dAmount)) return setError('Enter a valid amount.');
    setBusy(true);
    try {
      await api.post(`/debt-groups/${ref}/debts`, {
        debtor_id: debtor,
        creditor_id: creditor,
        amount_bdt: dAmount,
        description: dDesc || undefined,
      });
      setDAmount('');
      setDDesc('');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitExpense(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validAmount(eAmount)) return setError('Enter a valid amount.');
    if (participants.length === 0) return setError('Pick at least one participant.');
    setBusy(true);
    try {
      await api.post(`/debt-groups/${ref}/expenses`, {
        payer_id: payer,
        amount_bdt: eAmount,
        participant_ids: participants,
        description: eDesc || undefined,
      });
      setEAmount('');
      setEDesc('');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => members.find((m) => m.user_id === id)?.full_name ?? '?';

  return (
    <div className="card p-5">
      <div className="mb-3 flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
        {(['debt', 'expense'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {t === 'debt' ? 'Record a debt' : 'Split an expense'}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {tab === 'debt' ? (
        <form onSubmit={submitDebt} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500">
              Who owes
              <select className="input mt-1" value={debtor} onChange={(e) => setDebtor(e.target.value)}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Owes whom
              <select className="input mt-1" value={creditor} onChange={(e) => setCreditor(e.target.value)}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input
            className="input"
            inputMode="decimal"
            placeholder="Amount (BDT)"
            value={dAmount}
            onChange={(e) => setDAmount(e.target.value)}
          />
          <input
            className="input"
            maxLength={200}
            placeholder="What for? (optional)"
            value={dDesc}
            onChange={(e) => setDDesc(e.target.value)}
          />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : `Record: ${nameOf(debtor)} owes ${nameOf(creditor)}`}
          </button>
        </form>
      ) : (
        <form onSubmit={submitExpense} className="space-y-3">
          <label className="text-xs text-slate-500">
            Paid by
            <select className="input mt-1" value={payer} onChange={(e) => setPayer(e.target.value)}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          </label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="Total amount (BDT)"
            value={eAmount}
            onChange={(e) => setEAmount(e.target.value)}
          />
          <div>
            <p className="label">Split equally between</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = participants.includes(m.user_id);
                return (
                  <button
                    key={m.user_id}
                    type="button"
                    onClick={() =>
                      setParticipants((xs) =>
                        on ? xs.filter((x) => x !== m.user_id) : [...xs, m.user_id]
                      )
                    }
                    className={`rounded-lg px-2.5 py-1 text-sm ${
                      on ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {m.full_name}
                  </button>
                );
              })}
            </div>
          </div>
          <input
            className="input"
            maxLength={200}
            placeholder="Description (optional)"
            value={eDesc}
            onChange={(e) => setEDesc(e.target.value)}
          />
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Add expense'}
          </button>
        </form>
      )}
    </div>
  );
}

function PreviewPanel({
  p,
  busy,
  onConfirm,
  onCancel,
}: {
  p: SettlementPreview;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Outstanding" value={formatBdt(p.total_outstanding_bdt)} />
        <Stat label="Original debts" value={String(p.original_debt_count)} />
        <Stat label="Optimised transfers" value={String(p.optimized_transfer_count)} />
      </div>
      {p.transfers_saved > 0 && (
        <p className="text-center text-xs text-emerald-600">
          {p.transfers_saved} fewer transfer{p.transfers_saved > 1 ? 's' : ''} than paying each debt
        </p>
      )}

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="w-full min-w-[18rem] text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Pays</th>
              <th className="px-3 py-2 text-left">To</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {p.plan.map((l) => (
              <tr key={l.seq}>
                <td className="px-3 py-2 font-medium text-slate-800">{l.from_name}</td>
                <td className="px-3 py-2 text-slate-600">{l.to_name}</td>
                <td className="px-3 py-2 text-right font-bold text-slate-900">
                  {formatBdt(l.amount_bdt)}
                </td>
              </tr>
            ))}
            {p.plan.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                  Nothing to move.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Alert kind="info">
        Confirming will move real money between members' wallets per the plan above. Retrying is
        safe — each transfer is idempotent.
      </Alert>

      <div className="flex gap-2">
        <button className="btn-ghost flex-1" onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button className="btn-primary flex-1" onClick={onConfirm} disabled={busy || p.plan.length === 0}>
          {busy ? <Spinner className="h-4 w-4" /> : 'Confirm & settle'}
        </button>
      </div>
    </div>
  );
}

function SettlementResult({ s, onReset }: { s: Settlement; onReset: () => void }) {
  const tone =
    s.status === 'COMPLETED'
      ? 'bg-emerald-100 text-emerald-700'
      : s.status === 'FAILED'
        ? 'bg-rose-100 text-rose-700'
        : 'bg-amber-100 text-amber-700';
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-50 p-4 text-center">
        <span className={`badge ${tone}`}>{s.status}</span>
        <p className="mt-1 text-sm text-slate-500">
          {s.reference} · {s.success_count}/{s.optimized_transfer_count} transfers completed
        </p>
      </div>

      <div className="divide-y divide-slate-100">
        {s.transfers.map((t) => (
          <div key={t.seq} className="flex items-center justify-between py-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium text-slate-800">{t.from_name}</span> →{' '}
              <span className="text-slate-600">{t.to_name}</span>
              {t.failure_reason && (
                <span className="block text-xs text-rose-500">{t.failure_reason}</span>
              )}
              {t.transfer_reference && (
                <Link
                  to={`/tx/${t.transfer_reference}`}
                  className="block font-mono text-xs text-brand-600 hover:underline"
                >
                  {t.transfer_reference}
                </Link>
              )}
            </span>
            <span className="text-right">
              <span className="block font-bold text-slate-800">{formatBdt(t.amount_bdt)}</span>
              <StatusBadge status={t.status} />
            </span>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-slate-50 p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">
          Final balances
        </p>
        {s.resulting_balances.map((b) => (
          <BalanceRow key={b.user_id} b={b} />
        ))}
      </div>

      <button className="btn-ghost w-full" onClick={onReset}>
        Done
      </button>
    </div>
  );
}

function SettlementHistory({
  reference,
  refreshKey,
}: {
  reference: string;
  refreshKey?: string;
}) {
  const [rows, setRows] = useState<Settlement[]>([]);
  useEffect(() => {
    api.get(`/debt-groups/${reference}/settlements`).then(({ data }) => setRows(data.data));
  }, [reference, refreshKey]);

  if (rows.length === 0) return null;
  return (
    <div className="card p-5">
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
        Past settlements
      </p>
      <div className="divide-y divide-slate-100">
        {rows.map((s) => (
          <div key={s.settlement_id} className="flex items-center justify-between py-2 text-sm">
            <span>
              <span className="font-mono text-xs text-slate-500">{s.reference}</span>
              <span className="ml-2 text-xs text-slate-400">{fullTime(s.created_at)}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="text-slate-500">
                {s.success_count}/{s.optimized_transfer_count}
              </span>
              <StatusBadge status={s.status} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-sm font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

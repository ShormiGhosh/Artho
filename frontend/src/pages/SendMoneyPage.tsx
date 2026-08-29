import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorCode, errorDetails, errorMessage, newIdempotencyKey } from '../lib/api';
import { formatBdt, validAmount } from '../lib/format';
import { Alert, PageHeader, Spinner, StatusBadge } from '../components/ui';
import UserSearch from '../components/UserSearch';
import { InvestigationPanel } from '../components/MoneyRecovery';
import type { RiskInfo, Transfer, UserResult } from '../types';

type Step =
  | 'recipient'
  | 'amount'
  | 'confirm'
  | 'result'
  | 'investigate'
  | 'verify_risk'
  | 'blocked';
type Simulate =
  | ''
  | 'lost_response'
  | 'crash_before_processing'
  | 'crash_during_processing';
const UNCERTAIN_CODES = ['NETWORK_UNCERTAIN', 'SIMULATED_CRASH', 'TRANSFER_UNCERTAIN'];

export default function SendMoneyPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('recipient');
  const [recipient, setRecipient] = useState<UserResult | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [uncertainRef, setUncertainRef] = useState<string | null>(null);
  const [simulate, setSimulate] = useState<Simulate>('');
  const [result, setResult] = useState<Transfer | null>(null);
  const [risk, setRisk] = useState<RiskInfo | null>(null);
  const [dupBusy, setDupBusy] = useState(false);
  const [dupMsg, setDupMsg] = useState<string | null>(null);

  // One idempotency key per confirmed attempt — reused on every retry so a
  // duplicate submission can never move money twice.
  const [idemKey, setIdemKey] = useState('');

  const amountValid = useMemo(() => validAmount(amount), [amount]);

  function goConfirm() {
    setError(null);
    if (!amountValid) {
      setError('Enter a positive amount with at most 2 decimal places.');
      return;
    }
    if (note.length > 500) {
      setError('Note must be 500 characters or fewer.');
      return;
    }
    if (me && Number(amount) > Number(me.wallet.balance_bdt)) {
      setError(`That is more than your balance (${formatBdt(me.wallet.balance_bdt)}).`);
      return;
    }
    setIdemKey(newIdempotencyKey(me!.user_id));
    setStep('confirm');
  }

  async function submit(riskAck?: string) {
    setBusy(true);
    setError(null);
    setUncertain(false);
    try {
      const { data } = await api.post(
        '/transfers',
        {
          receiver_id: recipient!.user_id,
          amount_bdt: amount,
          note: note || undefined,
          simulate: simulate || undefined,
          risk_ack: riskAck || undefined,
        },
        { headers: { 'Idempotency-Key': idemKey } }
      );
      // The fraud gate may ask for an extra confirmation before executing.
      if (data.data?.status === 'VERIFICATION_REQUIRED') {
        setRisk(data.data as RiskInfo);
        setStep('verify_risk');
        return;
      }
      setResult(data.data as Transfer);
      setRisk((data.data as Transfer & { risk?: RiskInfo }).risk ?? null);
      setStep('result');
      refresh();
    } catch (err) {
      const code = errorCode(err);
      const ref = errorDetails(err)?.transfer_reference ?? null;

      if (code === 'TRANSFER_BLOCKED_RISK') {
        setRisk({
          band: 'HIGH',
          decision: 'BLOCKED',
          score: errorDetails(err)?.score,
          reasons: errorDetails(err)?.reasons,
          assessment_reference: errorDetails(err)?.assessment_reference,
        });
        setStep('blocked');
      } else if (code && UNCERTAIN_CODES.includes(code)) {
        // Server told us it may have processed but the client is unsure.
        setUncertain(true);
        setUncertainRef(ref);
        setStep('investigate');
      } else if (!(err as any)?.response || code === 'REQUEST_IN_PROGRESS') {
        // Genuine no-response / still-processing: try one safe replay to learn the ref.
        try {
          const { data } = await api.post(
            '/transfers',
            { receiver_id: recipient!.user_id, amount_bdt: amount, note: note || undefined },
            { headers: { 'Idempotency-Key': idemKey } }
          );
          setResult(data.data as Transfer);
          setStep('result');
          refresh();
        } catch (err2) {
          setUncertain(true);
          setUncertainRef(errorDetails(err2)?.transfer_reference ?? null);
          setStep('investigate');
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function simulateDuplicate() {
    if (!result) return;
    setDupBusy(true);
    setDupMsg(null);
    try {
      const resp = await api.post(
        '/transfers',
        { receiver_id: recipient!.user_id, amount_bdt: amount, note: note || undefined },
        { headers: { 'Idempotency-Key': idemKey } }
      );
      const sameId = resp.data.data.transfer_id === result.transfer_id;
      const replay = resp.headers['idempotent-replay'] === 'true';
      await refresh();
      setDupMsg(
        sameId
          ? `Same idempotency key → returned the original ${result.reference}${
              replay ? ' (idempotent replay)' : ''
            }. No second transfer, balance unchanged.`
          : 'Unexpected: a different transfer id came back.'
      );
    } catch (err) {
      setDupMsg(errorMessage(err));
    } finally {
      setDupBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Send money" subtitle="Transfers are final once completed." />

      <Steps
        step={
          ['investigate', 'verify_risk', 'blocked'].includes(step) ? 'confirm' : (step as any)
        }
      />

      <div className="card mt-4 p-6">
        {step === 'recipient' && (
          <UserSearch
            onSelect={(u) => {
              setRecipient(u);
              setStep('amount');
            }}
          />
        )}

        {step === 'amount' && recipient && (
          <div className="space-y-4">
            <RecipientChip recipient={recipient} onChange={() => setStep('recipient')} />
            <div>
              <label className="label">Amount (BDT)</label>
              <input
                autoFocus
                inputMode="decimal"
                className="input text-lg"
                placeholder="2500.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                {['500', '1000', '2500', '5000'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setAmount(p)}
                    className="rounded-lg bg-slate-100 px-3 py-1 text-sm hover:bg-slate-200"
                  >
                    ৳{p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Note (optional)</label>
              <textarea
                className="input"
                rows={2}
                maxLength={500}
                placeholder="Lunch money"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="mt-1 text-right text-xs text-slate-400">{note.length}/500</p>
            </div>
            {error && <Alert>{error}</Alert>}
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setStep('recipient')}>
                Back
              </button>
              <button className="btn-primary flex-1" onClick={goConfirm} disabled={!amountValid}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && recipient && (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-4 text-center">
              <p className="text-sm text-slate-500">You are sending</p>
              <p className="my-1 text-3xl font-extrabold text-slate-900">{formatBdt(amount)}</p>
              <p className="text-sm text-slate-500">
                to <span className="font-semibold text-slate-700">{recipient.full_name}</span>
              </p>
            </div>
            <dl className="divide-y divide-slate-100 text-sm">
              <Row k="Recipient email" v={recipient.email} />
              {note && <Row k="Note" v={note} />}
              <Row k="Fee" v="৳0.00" />
            </dl>
            <Alert kind="info">This transfer is final and cannot be reversed.</Alert>
            {error && <Alert>{error}</Alert>}

            <details className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <summary className="cursor-pointer text-slate-500">Demo: simulate a problem</summary>
              <select
                className="input mt-2"
                value={simulate}
                onChange={(e) => setSimulate(e.target.value as Simulate)}
              >
                <option value="">No simulation — send normally</option>
                <option value="lost_response">
                  Lost client response (money moves, app never hears back)
                </option>
                <option value="crash_before_processing">
                  Server crash before processing (nothing moves)
                </option>
                <option value="crash_during_processing">
                  Server crash during processing (rolls back, nothing moves)
                </option>
              </select>
              <p className="mt-1 text-xs text-slate-400">
                Triggers the “What happened to my money?” recovery flow.
              </p>
            </details>

            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setStep('amount')} disabled={busy}>
                Back
              </button>
              <button className="btn-primary flex-1" onClick={() => submit()} disabled={busy}>
                {busy ? <Spinner className="h-4 w-4" /> : 'Confirm & send'}
              </button>
            </div>
          </div>
        )}

        {step === 'investigate' && recipient && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-100 text-2xl">
                ?
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900">
                We didn’t get a confirmation
              </p>
              <p className="text-sm text-slate-500">
                {formatBdt(amount)} to {recipient.full_name}. Your money is safe either way — let’s
                check what actually happened.
              </p>
            </div>

            <InvestigationPanel
              reference={uncertainRef}
              counterpartyName={recipient.full_name}
              autoStart
              onResolved={() => refresh()}
            />

            <button className="btn-ghost w-full" onClick={() => navigate('/')}>
              Back to dashboard
            </button>
          </div>
        )}

        {step === 'verify_risk' && recipient && risk && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl">
                🛡️
              </div>
              <p className="mt-2 text-lg font-bold text-slate-900">One more check</p>
              <p className="text-sm text-slate-500">
                This {formatBdt(amount)} transfer to {recipient.full_name} looks unusual. Confirm
                it’s really you.
              </p>
            </div>
            <RiskReasons reasons={risk.reasons} score={risk.score} band={risk.band} />
            {error && <Alert>{error}</Alert>}
            <div className="flex gap-3">
              <button
                className="btn-ghost flex-1"
                onClick={() => setStep('confirm')}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                className="btn-primary flex-1"
                disabled={busy}
                onClick={() => submit(risk.verification_token)}
              >
                {busy ? <Spinner className="h-4 w-4" /> : 'Yes, proceed'}
              </button>
            </div>
          </div>
        )}

        {step === 'blocked' && risk && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-2xl">
              ⛔
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900">Transfer on hold</p>
              <p className="text-sm text-slate-500">
                Our fraud checks placed this transfer on hold for review. You and our security
                team have been notified — no money has moved.
              </p>
            </div>
            <RiskReasons reasons={risk.reasons} score={risk.score} band={risk.band} />
            {risk.assessment_reference && (
              <p className="text-xs text-slate-400">Reference {risk.assessment_reference}</p>
            )}
            <button className="btn-primary w-full" onClick={() => navigate('/')}>
              Back to dashboard
            </button>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">
              ✓
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900">Transfer completed</p>
              <p className="text-sm text-slate-500">
                {formatBdt(result.amount_bdt)} sent to {recipient?.full_name}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-left text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Transaction ID</span>
                <button
                  className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                  onClick={() => navigator.clipboard?.writeText(result.reference)}
                >
                  {result.reference} ⧉
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Status</span>
                <StatusBadge status={result.status} />
              </div>
              {result.your_balance_after_bdt && (
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-slate-500">New balance</span>
                  <span className="font-semibold">{formatBdt(result.your_balance_after_bdt)}</span>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-slate-500">Idempotency key</span>
                <span className="font-mono text-xs text-slate-500">…{idemKey.slice(-14)}</span>
              </div>
            </div>

            <div className="rounded-xl bg-slate-50 p-3 text-left text-sm">
              <button
                className="btn-ghost w-full !py-2"
                onClick={simulateDuplicate}
                disabled={dupBusy}
              >
                {dupBusy ? <Spinner className="h-4 w-4" /> : 'Simulate a duplicate submit'}
              </button>
              {dupMsg && <p className="mt-2 text-xs text-emerald-700">{dupMsg}</p>}
            </div>

            <div className="flex gap-3">
              <Link to={`/tx/${result.reference}`} className="btn-ghost flex-1">
                View details
              </Link>
              <button className="btn-primary flex-1" onClick={() => navigate('/')}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const order: Step[] = ['recipient', 'amount', 'confirm', 'result'];
  const idx = order.indexOf(step);
  const labels = ['Recipient', 'Amount', 'Confirm', 'Done'];
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs font-semibold sm:gap-2">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-1.5 sm:gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              i <= idx ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {i + 1}
          </span>
          <span
            className={`${i <= idx ? 'text-slate-700' : 'text-slate-400'} ${
              i === idx ? 'inline' : 'hidden sm:inline'
            }`}
          >
            {l}
          </span>
          {i < labels.length - 1 && <span className="mx-0.5 h-px w-3 bg-slate-300 sm:mx-1 sm:w-4" />}
        </li>
      ))}
    </ol>
  );
}

function RecipientChip({
  recipient,
  onChange,
}: {
  recipient: UserResult;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
        {recipient.full_name.charAt(0)}
      </span>
      <div className="flex-1">
        <p className="text-sm font-semibold text-slate-800">{recipient.full_name}</p>
        <p className="text-xs text-slate-400">{recipient.email}</p>
      </div>
      <button onClick={onChange} className="text-xs font-semibold text-brand-600 hover:underline">
        Change
      </button>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-800">{v}</dd>
    </div>
  );
}

function RiskReasons({
  reasons,
  score,
  band,
}: {
  reasons?: RiskInfo['reasons'];
  score?: number;
  band?: string;
}) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-4 text-left text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-slate-700">Why this was flagged</span>
        {typeof score === 'number' && (
          <span
            className={`badge ${
              band === 'HIGH' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
            }`}
          >
            risk {score} · {band}
          </span>
        )}
      </div>
      <ul className="space-y-1">
        {reasons.map((r) => (
          <li key={r.code} className="flex items-start gap-2 text-slate-600">
            <span className={r.critical ? 'text-rose-500' : 'text-amber-500'}>•</span>
            <span>{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

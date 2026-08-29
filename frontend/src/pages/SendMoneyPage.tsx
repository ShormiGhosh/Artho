import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorCode, errorMessage, newIdempotencyKey } from '../lib/api';
import { formatBdt, validAmount } from '../lib/format';
import { Alert, PageHeader, Spinner, StatusBadge } from '../components/ui';
import UserSearch from '../components/UserSearch';
import type { Transfer, UserResult } from '../types';

type Step = 'recipient' | 'amount' | 'confirm' | 'result';

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
  const [result, setResult] = useState<Transfer | null>(null);

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

  async function submit() {
    setBusy(true);
    setError(null);
    setUncertain(false);
    try {
      const { data } = await api.post(
        '/transfers',
        { receiver_id: recipient!.user_id, amount_bdt: amount, note: note || undefined },
        { headers: { 'Idempotency-Key': idemKey } }
      );
      setResult(data.data as Transfer);
      setStep('result');
      refresh();
    } catch (err) {
      const code = errorCode(err);
      if (!(err as any)?.response) {
        // No response at all: the request may or may not have landed.
        setUncertain(true);
      } else if (code === 'REQUEST_IN_PROGRESS') {
        setUncertain(true);
        setError('This transfer is still being processed. Retry safely — it will not send twice.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Send money" subtitle="Transfers are final once completed." />

      <Steps step={step} />

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
            {uncertain && (
              <Alert kind="info">
                Status uncertain. Your money has <strong>not</strong> been sent twice — retrying
                uses the same secure key.
              </Alert>
            )}
            <div className="flex gap-3">
              <button className="btn-ghost flex-1" onClick={() => setStep('amount')} disabled={busy}>
                Back
              </button>
              <button className="btn-primary flex-1" onClick={submit} disabled={busy}>
                {busy ? <Spinner className="h-4 w-4" /> : uncertain ? 'Retry' : 'Confirm & send'}
              </button>
            </div>
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
    <ol className="flex items-center gap-2 text-xs font-semibold">
      {labels.map((l, i) => (
        <li key={l} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full ${
              i <= idx ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= idx ? 'text-slate-700' : 'text-slate-400'}>{l}</span>
          {i < labels.length - 1 && <span className="mx-1 h-px w-4 bg-slate-300" />}
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
    <div className="flex items-center justify-between py-2">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800">{v}</dd>
    </div>
  );
}

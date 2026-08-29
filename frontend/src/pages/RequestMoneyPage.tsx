import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBdt, validAmount } from '../lib/format';
import { Alert, PageHeader, Spinner } from '../components/ui';
import UserSearch from '../components/UserSearch';
import type { UserResult } from '../types';

export default function RequestMoneyPage() {
  const navigate = useNavigate();
  const [target, setTarget] = useState<UserResult | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const amountValid = useMemo(() => validAmount(amount), [amount]);

  async function submit() {
    setError(null);
    if (!amountValid) {
      setError('Enter a positive amount with at most 2 decimal places.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/money-requests', {
        requestee_id: target!.user_id,
        amount_bdt: amount,
        reason: reason || undefined,
      });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-violet-100 text-2xl">
            ✓
          </div>
          <p className="mt-3 text-lg font-bold">Request sent</p>
          <p className="text-sm text-slate-500">
            {target?.full_name} was asked for {formatBdt(amount)}.
          </p>
          <div className="mt-5 flex gap-3">
            <button className="btn-ghost flex-1" onClick={() => navigate('/requests')}>
              View requests
            </button>
            <button className="btn-primary flex-1" onClick={() => navigate('/')}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Request money" subtitle="Ask another user to send you funds." />
      <div className="card space-y-4 p-6">
        {!target ? (
          <UserSearch onSelect={setTarget} />
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {target.full_name.charAt(0)}
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">{target.full_name}</p>
              <p className="text-xs text-slate-400">{target.email}</p>
            </div>
            <button
              onClick={() => setTarget(null)}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Change
            </button>
          </div>
        )}

        {target && (
          <>
            <div>
              <label className="label">Amount (BDT)</label>
              <input
                autoFocus
                inputMode="decimal"
                className="input text-lg"
                placeholder="1200.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Reason (optional)</label>
              <input
                className="input"
                maxLength={200}
                placeholder="Lunch you bought for me"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {error && <Alert>{error}</Alert>}
            <button className="btn-primary w-full" onClick={submit} disabled={busy || !amountValid}>
              {busy ? <Spinner className="h-4 w-4" /> : 'Send request'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

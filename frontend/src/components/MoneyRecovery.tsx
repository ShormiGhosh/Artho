import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { fullTime, relativeTime } from '../lib/format';
import { EVENT_LABEL, STATE_DOT, eventDescription, outcomeBanner } from '../lib/recovery';
import { Alert, Spinner } from './ui';
import type { TransferEvent, VerifyResult } from '../types';

export function TransferTimeline({ events }: { events: TransferEvent[] }) {
  if (!events || events.length === 0) {
    return <p className="text-sm text-slate-400">No timeline recorded yet.</p>;
  }
  return (
    <ol className="relative ml-2 space-y-4 border-l border-slate-200 pl-5">
      {events.map((e) => (
        <li key={e.seq} className="relative">
          <span
            className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${
              STATE_DOT[e.state] ?? 'bg-slate-400'
            }`}
          />
          <p className="text-sm font-semibold text-slate-800">{EVENT_LABEL[e.event] ?? e.event}</p>
          {eventDescription(e) && (
            <p className="text-xs text-slate-500">{eventDescription(e)}</p>
          )}
          <p className="mt-0.5 text-xs text-slate-400" title={fullTime(e.created_at)}>
            {relativeTime(e.created_at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function OutcomeBanner({
  result,
  counterpartyName,
}: {
  result: VerifyResult;
  counterpartyName?: string;
}) {
  const b = outcomeBanner(result, counterpartyName);
  const styles =
    b.tone === 'success'
      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
      : 'bg-rose-50 text-rose-800 ring-rose-200';
  return (
    <div className={`rounded-xl px-4 py-3 ring-1 ${styles}`}>
      <p className="font-bold">{b.tone === 'success' ? '✓ ' : '⚠ '}{b.title}</p>
      <p className="mt-0.5 text-sm">{b.line}</p>
      <p className="mt-1 text-xs opacity-70">
        Ledger check: {result.reconciliation.ledger_entry_count} entr
        {result.reconciliation.ledger_entry_count === 1 ? 'y' : 'ies'}, net{' '}
        {result.reconciliation.net_ledger_paisa} paisa ·{' '}
        {result.reconciliation.money_moved ? 'money moved' : 'no movement'}
      </p>
    </div>
  );
}

/**
 * "What happened to my money?" — runs the reconcile call and reveals the
 * outcome + full timeline. Safe to press repeatedly.
 */
export function InvestigationPanel({
  reference,
  counterpartyName,
  autoStart = false,
  onResolved,
}: {
  reference: string | null;
  counterpartyName?: string;
  autoStart?: boolean;
  onResolved?: (r: VerifyResult) => void;
}) {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const investigate = useCallback(async () => {
    if (!reference) {
      setError('We could not locate this transaction reference. Try again in a moment.');
      return;
    }
    setStarted(true);
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post(`/transfers/${reference}/verify`);
      setResult(data.data as VerifyResult);
      onResolved?.(data.data as VerifyResult);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [reference, onResolved]);

  useEffect(() => {
    if (autoStart && reference && !started) void investigate();
  }, [autoStart, reference, started, investigate]);

  if (!started) {
    return (
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="text-sm text-slate-600">
          Not sure your money moved? Check it against the authoritative record.
        </p>
        <button className="btn-primary mt-3" onClick={investigate} disabled={loading}>
          What happened to my money?
        </button>
        {error && (
          <div className="mt-2">
            <Alert>{error}</Alert>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
        <Spinner className="h-5 w-5 text-brand-600" />
        Checking your transaction against the ledger…
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Alert>{error}</Alert>
        <button className="btn-ghost" onClick={investigate}>
          Try again
        </button>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-4">
      <OutcomeBanner result={result} counterpartyName={counterpartyName} />
      <div className="card p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
          Transaction timeline
        </p>
        <TransferTimeline events={result.timeline} />
      </div>
      <button className="btn-ghost !py-1.5 text-xs" onClick={investigate}>
        Re-check
      </button>
    </div>
  );
}

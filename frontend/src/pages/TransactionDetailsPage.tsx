import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBdt, fullTime } from '../lib/format';
import { Alert, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { Transfer } from '../types';

export default function TransactionDetailsPage() {
  const { reference } = useParams();
  const [tx, setTx] = useState<(Transfer & { counterparty?: { full_name: string } }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/transfers/${reference}`)
      .then(({ data }) => setTx(data.data))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [reference]);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !tx) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Alert>{error ?? 'Not found'}</Alert>
        <Link to="/history" className="btn-ghost">
          Back to history
        </Link>
      </div>
    );
  }

  const sent = tx.direction === 'SENT';

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Transaction details" />
      <div className="card p-6">
        <div className="text-center">
          <p className="text-sm text-slate-500">
            {sent ? 'Sent to' : 'Received from'}{' '}
            <span className="font-semibold text-slate-700">
              {tx.counterparty?.full_name ?? tx.other_party}
            </span>
          </p>
          <p className={`my-1 text-3xl font-extrabold ${sent ? 'text-rose-600' : 'text-emerald-600'}`}>
            {sent ? '−' : '+'} {formatBdt(tx.amount_bdt)}
          </p>
          <div className="flex items-center justify-center gap-2">
            <StatusBadge status={tx.status} />
            {tx.is_stipend && (
              <span className="badge bg-emerald-100 text-emerald-700">STIPEND</span>
            )}
          </div>
        </div>

        {tx.is_stipend && (
          <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-200">
            উপবৃত্তি — বাড়ির কাছের যেকোনো এজেন্ট থেকে বিনামূল্যে ক্যাশ আউট। No cash-out fee on
            stipend funds.
          </p>
        )}

        <dl className="mt-6 divide-y divide-slate-100 text-sm">
          <Row k="Transaction ID" v={tx.reference} mono copy />
          <Row
            k="Type"
            v={
              tx.is_stipend
                ? 'Stipend / grant'
                : tx.type === 'REQUEST_APPROVAL'
                  ? 'Request approval'
                  : 'Transfer'
            }
          />
          <Row k="Direction" v={tx.direction} />
          <Row k="Fee" v={formatBdt(tx.fee_bdt ?? '0')} />
          {tx.note && <Row k="Note" v={tx.note} />}
          {tx.failure_reason && <Row k="Failure reason" v={tx.failure_reason} />}
          <Row k="Created" v={fullTime(tx.created_at)} />
          {tx.your_balance_before_bdt && (
            <Row k="Your balance before" v={formatBdt(tx.your_balance_before_bdt)} />
          )}
          {tx.your_balance_after_bdt && (
            <Row k="Your balance after" v={formatBdt(tx.your_balance_after_bdt)} />
          )}
        </dl>

        <p className="mt-4 text-xs text-slate-400">
          Keep the Transaction ID for any support inquiry.
        </p>

        <Link to="/history" className="btn-ghost mt-4 w-full">
          Back to history
        </Link>
      </div>
    </div>
  );
}

function Row({
  k,
  v,
  mono,
  copy,
}: {
  k: string;
  v: string;
  mono?: boolean;
  copy?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd
        className={`text-right font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {v}
        {copy && (
          <button
            className="ml-2 text-brand-600 hover:underline"
            onClick={() => navigator.clipboard?.writeText(v)}
          >
            ⧉
          </button>
        )}
      </dd>
    </div>
  );
}

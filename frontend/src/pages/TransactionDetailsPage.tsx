import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { formatBdt, fullTime } from '../lib/format';
import { Alert, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { OutcomeBanner, TransferTimeline } from '../components/MoneyRecovery';
import { MONEY_STATUS_COPY, safeList, safeText } from '../lib/ai';
import type { AiInvestigation, Transfer, VerifyResult } from '../types';

export default function TransactionDetailsPage() {
  const { reference } = useParams();
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [tx, setTx] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/transfers/${reference}`)
      .then(({ data }) => setTx(data.data))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [reference]);

  async function runVerify() {
    setVerifying(true);
    setVerifyError(null);
    try {
      const { data } = await api.post(`/transfers/${reference}/verify`);
      const v = data.data as VerifyResult;
      setVerify(v);
      setTx((prev) => (prev ? { ...prev, ...v.transfer } : v.transfer));
      refresh();
    } catch (e) {
      setVerifyError(errorMessage(e));
    } finally {
      setVerifying(false);
    }
  }

  // Deep-link `?investigate=1` (used by the Send flow) auto-runs the check.
  useEffect(() => {
    if (tx && params.get('investigate') === '1' && !verify && !verifying) void runVerify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tx]);

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
  const timeline = verify?.timeline ?? tx.events ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-4">
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
            {tx.is_stipend && <span className="badge bg-emerald-100 text-emerald-700">STIPEND</span>}
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
          {tx.attempt_count != null && tx.attempt_count > 1 && (
            <Row k="Attempts" v={String(tx.attempt_count)} />
          )}
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

        <Link to="/history" className="btn-ghost mt-4 w-full">
          Back to history
        </Link>
      </div>

      {verify && (
        <OutcomeBanner result={verify} counterpartyName={tx.counterparty?.full_name} />
      )}

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
            Transaction timeline
          </p>
          {timeline.length > 0 && (
            <span className="text-xs text-slate-400">{timeline.length} events</span>
          )}
        </div>

        <TransferTimeline events={timeline} />

        {verifyError && (
          <div className="mt-3">
            <Alert>{verifyError}</Alert>
          </div>
        )}

        <button
          className={`mt-4 w-full ${tx.is_uncertain ? 'btn-primary' : 'btn-ghost'}`}
          onClick={runVerify}
          disabled={verifying}
        >
          {verifying ? (
            <Spinner className="h-4 w-4" />
          ) : tx.is_uncertain ? (
            'What happened to my money?'
          ) : (
            'Re-verify against the ledger'
          )}
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">
          Reconciles this transfer against the immutable ledger. Never moves money.
        </p>
      </div>

      <AiExplanationCard reference={tx.reference} autoRun={params.get('investigate') === '1'} />
    </div>
  );
}

function AiExplanationCard({ reference, autoRun }: { reference: string; autoRun?: boolean }) {
  const [data, setData] = useState<AiInvestigation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/ai/transactions/${reference}/investigate`);
      setData(res.data.data as AiInvestigation);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoRun && !data && !loading) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  const ai = data?.ai;
  const status = ai ? MONEY_STATUS_COPY[ai.money_status] : null;

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          AI explanation
        </p>
        {ai && (
          <span className="text-xs text-slate-400">
            {ai.source === 'ai' ? `via ${ai.model ?? 'AI'}` : 'rule-based fallback'}
          </span>
        )}
      </div>

      {!data && !loading && !error && (
        <>
          <p className="text-sm text-slate-500">
            Get a plain-language walkthrough of every step this transaction went through and
            what it means for your money.
          </p>
          <button className="btn-primary mt-3 w-full" onClick={run}>
            Explain what happened (AI)
          </button>
        </>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-6 text-brand-600">
          <Spinner className="h-5 w-5" />
          <span className="text-sm text-slate-500">Analysing this transaction…</span>
        </div>
      )}

      {error && (
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <button className="btn-ghost w-full" onClick={run}>
            Try again
          </button>
        </div>
      )}

      {ai && (
        <div className="space-y-3">
          {status && (
            <div
              className={`rounded-xl px-4 py-3 text-sm ring-1 ${
                status.tone === 'success'
                  ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  : 'bg-amber-50 text-amber-800 ring-amber-200'
              }`}
            >
              <p className="font-bold">{status.label}</p>
              <p className="mt-0.5">{safeText(ai.what_this_means, 400)}</p>
            </div>
          )}

          <p className="text-sm text-slate-700">{safeText(ai.summary, 900)}</p>

          {ai.timeline_explained.length > 0 && (
            <ol className="space-y-1.5 border-l border-slate-200 pl-4 text-sm text-slate-600">
              {safeList(ai.timeline_explained, 12).map((line, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-400" />
                  {line}
                </li>
              ))}
            </ol>
          )}

          <p className="text-xs text-slate-400">
            {ai.source === 'fallback'
              ? 'AI is unavailable right now — this is a deterministic explanation built from the ledger record.'
              : 'AI-generated explanation. The outcome and reconciliation above come from the ledger and are authoritative.'}
          </p>

          <button className="btn-ghost w-full" onClick={run} disabled={loading}>
            Refresh explanation
          </button>
        </div>
      )}
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
      <dd className={`text-right font-medium text-slate-800 ${mono ? 'font-mono text-xs' : ''}`}>
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

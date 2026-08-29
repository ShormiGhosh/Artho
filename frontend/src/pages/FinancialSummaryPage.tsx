import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { formatBdt } from '../lib/format';
import { safeList, safeText } from '../lib/ai';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui';
import type { FinancialSummary } from '../types';

type Period = 'weekly' | 'monthly';

export default function FinancialSummaryPage() {
  const [period, setPeriod] = useState<Period>('monthly');
  const [data, setData] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/ai/summary', { params: { period: p } });
      setData(data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [period, load]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Financial summary"
        subtitle="Your totals, computed from your transaction history — with a plain-language read-out."
      />

      <div className="mb-4 flex gap-1 rounded-xl bg-slate-200 p-1 text-sm font-semibold">
        {(['weekly', 'monthly'] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 rounded-lg py-1.5 capitalize ${
              period === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {error ? (
        <div className="space-y-3">
          <Alert>{error}</Alert>
          <button className="btn-ghost w-full" onClick={() => load(period)}>
            Try again
          </button>
        </div>
      ) : loading || !data ? (
        <div className="flex justify-center py-12 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-brand-500/30 bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-center text-white">
              <div>
                <p className="text-xs text-brand-100">Sent</p>
                <p className="mt-1 truncate text-lg font-extrabold">{formatBdt(data.totals.sent_bdt)}</p>
              </div>
              <div>
                <p className="text-xs text-brand-100">Received</p>
                <p className="mt-1 truncate text-lg font-extrabold">{formatBdt(data.totals.received_bdt)}</p>
              </div>
              <div>
                <p className="text-xs text-brand-100">Net</p>
                <p className="mt-1 truncate text-lg font-extrabold">{formatBdt(data.totals.net_bdt)}</p>
              </div>
            </div>
            <p className="px-5 py-2 text-center text-xs text-slate-400">
              {data.range.label} · {data.counts.sent} sent · {data.counts.received} received
            </p>
          </div>

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Spending by category
              </p>
              {data.top_category && (
                <span className="badge bg-gold-100 text-gold-800">
                  Top: {data.top_category.name}
                </span>
              )}
            </div>
            {data.categories.length === 0 ? (
              <EmptyState title="Nothing sent this period" hint="Categories appear once you send money." />
            ) : (
              <CategoryBars categories={data.categories} />
            )}
            {data.comparison && (
              <p className="mt-3 text-xs text-slate-500">
                Compared with the previous {period === 'weekly' ? 'week' : 'month'} (
                {formatBdt(data.comparison.previous_sent_bdt)} sent), spending{' '}
                {data.comparison.change_pct > 0
                  ? `increased by ${data.comparison.change_pct}%`
                  : data.comparison.change_pct < 0
                    ? `decreased by ${Math.abs(data.comparison.change_pct)}%`
                    : 'stayed flat'}
                .
              </p>
            )}
          </div>

          <div className="card p-5">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">AI observations</p>
              <span className="text-xs text-slate-400">
                {data.ai.source === 'ai' ? `via ${data.ai.model ?? 'AI'}` : 'rule-based fallback'}
              </span>
            </div>
            <p className="text-sm font-semibold text-slate-800">{safeText(data.ai.headline, 240)}</p>
            {data.ai.observations.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                {safeList(data.ai.observations, 6).map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            )}
            {data.ai.spending_note && (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                {safeText(data.ai.spending_note, 400)}
              </p>
            )}
            <p className="mt-3 text-xs text-slate-400">
              {data.ai.source === 'fallback'
                ? 'AI is unavailable right now — the totals above are exact; this note is a deterministic summary of them.'
                : 'The totals above are computed directly from your transactions. AI only narrates them and never changes a figure.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryBars({ categories }: { categories: FinancialSummary['categories'] }) {
  const max = Math.max(...categories.map((c) => Number(c.amount_bdt)), 1);
  return (
    <div className="space-y-2">
      {categories.map((c) => (
        <div key={c.name}>
          <div className="mb-0.5 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-700">{c.name}</span>
            <span className="text-slate-500">{formatBdt(c.amount_bdt)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-brand-500"
              style={{ width: `${Math.max((Number(c.amount_bdt) / max) * 100, 3)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

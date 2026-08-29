import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBdt, relativeTime } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { HistoryItem } from '../types';

const KINDS = ['all', 'TRANSFER', 'REQUEST'] as const;
const STATUSES = [
  'all',
  'COMPLETED',
  'PENDING',
  'PROCESSING',
  'VERIFYING',
  'FAILED',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
];

function itemPath(it: HistoryItem): string {
  return it.kind === 'TRANSFER' ? `/tx/${it.reference}` : `/requests/${it.reference}`;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);

  const [lookup, setLookup] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/transactions', {
        params: {
          page,
          limit: 20,
          kind,
          status,
          from: from || undefined,
          to: to || undefined,
        },
      });
      setItems(data.data.items);
      setPages(data.data.pagination.pages);
    } finally {
      setLoading(false);
    }
  }, [page, kind, status, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function doLookup(e: FormEvent) {
    e.preventDefault();
    const ref = lookup.trim();
    if (!ref) return;
    setLookupBusy(true);
    setLookupError(null);
    try {
      const { data } = await api.get('/transactions/lookup', { params: { ref } });
      navigate(
        data.data.kind === 'TRANSFER'
          ? `/tx/${data.data.data.reference}`
          : `/requests/${data.data.data.reference}`
      );
    } catch (err) {
      setLookupError(errorMessage(err));
    } finally {
      setLookupBusy(false);
    }
  }

  const filtersActive = kind !== 'all' || status !== 'all' || from || to;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Transaction history" />

      <form onSubmit={doLookup} className="card mb-4 p-4">
        <label className="label">Look up a transaction by ID</label>
        <div className="flex gap-2">
          <input
            className="input font-mono text-sm"
            placeholder="TXN-20260829-… or REQ-20260829-…"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
          />
          <button className="btn-primary shrink-0" disabled={lookupBusy || !lookup.trim()}>
            {lookupBusy ? <Spinner className="h-4 w-4" /> : 'Look up'}
          </button>
        </div>
        {lookupError && (
          <div className="mt-2">
            <Alert>{lookupError}</Alert>
          </div>
        )}
      </form>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select
          className="input !w-auto"
          value={kind}
          onChange={(e) => {
            setPage(1);
            setKind(e.target.value as any);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k === 'all' ? 'All types' : k === 'TRANSFER' ? 'Transfers' : 'Requests'}
            </option>
          ))}
        </select>
        <select
          className="input !w-auto"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s}
            </option>
          ))}
        </select>
        <label className="text-xs text-slate-500">
          From
          <input
            type="date"
            className="input mt-1 !w-auto"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setPage(1);
              setFrom(e.target.value);
            }}
          />
        </label>
        <label className="text-xs text-slate-500">
          To
          <input
            type="date"
            className="input mt-1 !w-auto"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setPage(1);
              setTo(e.target.value);
            }}
          />
        </label>
        {filtersActive && (
          <button
            className="btn-ghost !py-2"
            onClick={() => {
              setPage(1);
              setKind('all');
              setStatus('all');
              setFrom('');
              setTo('');
            }}
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing matches these filters" />
      ) : (
        <div className="card divide-y divide-slate-100">
          {items.map((it) => (
            <button
              key={`${it.kind}-${it.id}`}
              onClick={() => navigate(itemPath(it))}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  it.is_stipend
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {it.is_stipend ? '৳' : it.kind === 'REQUEST' ? 'REQ' : it.direction === 'SENT' ? '↑' : '↓'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {it.is_stipend ? 'Stipend' : it.kind === 'REQUEST' ? 'Request' : 'Transfer'} ·{' '}
                  {it.direction === 'SENT' ? 'to' : 'from'} {it.counterparty_name}
                </span>
                <span className="block text-xs text-slate-400">
                  {relativeTime(it.created_at)} · {it.reference}
                </span>
                {it.failure_reason && (
                  <span className="block text-xs text-rose-500">{it.failure_reason}</span>
                )}
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-bold text-slate-800">
                  {formatBdt(it.amount_bdt)}
                </span>
                <StatusBadge status={it.status} />
              </span>
            </button>
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button
            className="btn-ghost !py-1.5"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </button>
          <span className="text-slate-500">
            Page {page} of {pages}
          </span>
          <button
            className="btn-ghost !py-1.5"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

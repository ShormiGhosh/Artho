import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBdt, relativeTime } from '../lib/format';
import { EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { HistoryItem } from '../types';

const KINDS = ['all', 'TRANSFER', 'REQUEST'] as const;
const STATUSES = ['all', 'COMPLETED', 'PENDING', 'FAILED', 'APPROVED', 'REJECTED', 'CANCELLED'];

export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/transactions', {
        params: { page, limit: 20, kind, status },
      });
      setItems(data.data.items);
      setPages(data.data.pagination.pages);
    } finally {
      setLoading(false);
    }
  }, [page, kind, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Transaction history" />

      <div className="mb-4 flex flex-wrap gap-2">
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
              onClick={() => it.kind === 'TRANSFER' && navigate(`/tx/${it.reference}`)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">
                {it.kind === 'REQUEST' ? 'REQ' : it.direction === 'SENT' ? '↑' : '↓'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {it.kind === 'REQUEST' ? 'Request' : 'Transfer'} ·{' '}
                  {it.direction === 'SENT' ? 'to' : 'from'} {it.counterparty_name}
                </span>
                <span className="block text-xs text-slate-400">
                  {relativeTime(it.created_at)} · {it.reference}
                </span>
                {it.failure_reason && (
                  <span className="block text-xs text-rose-500">{it.failure_reason}</span>
                )}
              </span>
              <span className="text-right">
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

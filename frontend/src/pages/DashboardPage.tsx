import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatBdt, relativeTime } from '../lib/format';
import { StatusBadge, EmptyState } from '../components/ui';
import type { HistoryItem, MoneyRequest } from '../types';

export default function DashboardPage() {
  const { me, refresh } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [pending, setPending] = useState<MoneyRequest[]>([]);

  useEffect(() => {
    refresh();
    api.get('/transactions', { params: { limit: 6 } }).then(({ data }) => setItems(data.data.items));
    api
      .get('/money-requests', { params: { direction: 'received', status: 'PENDING' } })
      .then(({ data }) => setPending(data.data.received));
  }, [refresh]);

  return (
    <div className="space-y-6">
      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white">
          <p className="text-sm text-brand-100">Available balance</p>
          <p className="mt-1 text-4xl font-extrabold tracking-tight">
            {me ? formatBdt(me.wallet.balance_bdt) : '—'}
          </p>
          <p className="mt-1 text-xs text-brand-200">
            {me?.full_name} · updated {me ? relativeTime(me.wallet.updated_at) : ''}
          </p>
        </div>
        <div className="grid grid-cols-2 divide-x divide-slate-100 sm:grid-cols-4 sm:divide-x">
          <button onClick={() => navigate('/send')} className="p-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ➤ Send
          </button>
          <button onClick={() => navigate('/request')} className="p-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ⇐ Request
          </button>
          <button onClick={() => navigate('/requests')} className="p-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ✔ Requests
          </button>
          <button onClick={() => navigate('/history')} className="p-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ☰ History
          </button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-500">
            Pending requests for you
          </h2>
          <div className="space-y-2">
            {pending.map((r) => (
              <div key={r.request_id} className="flex items-center justify-between rounded-xl bg-amber-50 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {r.counterparty_name} requests {formatBdt(r.amount_bdt)}
                  </p>
                  {r.reason && <p className="text-xs text-slate-500">{r.reason}</p>}
                </div>
                <Link
                  to={`/requests/${r.reference}`}
                  className="btn-primary !py-1.5 !px-3 text-xs"
                >
                  Review
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Recent activity</h2>
          <Link to="/history" className="text-xs font-semibold text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {items.length === 0 ? (
          <EmptyState title="No transactions yet" hint="Send or request money to get started." />
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((it) => (
              <ActivityRow key={`${it.kind}-${it.id}`} item={it} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: HistoryItem }) {
  const navigate = useNavigate();
  const outgoing =
    (item.kind === 'TRANSFER' && item.direction === 'SENT') ||
    (item.kind === 'REQUEST' && item.direction === 'RECEIVED' && item.status === 'APPROVED');
  const sign = item.kind === 'TRANSFER' ? (item.direction === 'SENT' ? '−' : '+') : '';
  return (
    <button
      onClick={() =>
        navigate(
          item.kind === 'TRANSFER' ? `/tx/${item.reference}` : `/requests/${item.reference}`
        )
      }
      className="flex w-full items-center gap-3 py-3 text-left"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          item.kind === 'REQUEST'
            ? 'bg-violet-100 text-violet-700'
            : item.direction === 'SENT'
              ? 'bg-rose-100 text-rose-700'
              : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {item.kind === 'REQUEST' ? 'REQ' : item.direction === 'SENT' ? '↑' : '↓'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800">
          {item.kind === 'REQUEST'
            ? `${item.direction === 'SENT' ? 'Request to' : 'Request from'} ${item.counterparty_name}`
            : `${item.direction === 'SENT' ? 'To' : 'From'} ${item.counterparty_name}`}
        </span>
        <span className="block text-xs text-slate-400">{relativeTime(item.created_at)}</span>
      </span>
      <span className="text-right">
        <span
          className={`block text-sm font-bold ${
            outgoing ? 'text-rose-600' : item.kind === 'TRANSFER' ? 'text-emerald-600' : 'text-slate-700'
          }`}
        >
          {sign} {formatBdt(item.amount_bdt)}
        </span>
        <StatusBadge status={item.status} />
      </span>
    </button>
  );
}

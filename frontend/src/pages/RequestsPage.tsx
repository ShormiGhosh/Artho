import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, newIdempotencyKey } from '../lib/api';
import { formatBdt, fullTime } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { MoneyRequest } from '../types';

export default function RequestsPage() {
  const { me, refresh } = useAuth();
  const [tab, setTab] = useState<'received' | 'sent'>('received');
  const [received, setReceived] = useState<MoneyRequest[]>([]);
  const [sent, setSent] = useState<MoneyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/money-requests');
      setReceived(data.data.received);
      setSent(data.data.sent);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(r: MoneyRequest, action: 'approve' | 'reject' | 'cancel') {
    setError(null);
    setPendingId(r.request_id);
    try {
      if (action === 'approve') {
        await api.post(`/money-requests/${r.request_id}/approve`, null, {
          headers: { 'Idempotency-Key': newIdempotencyKey(me!.user_id) },
        });
      } else if (action === 'reject') {
        await api.post(`/money-requests/${r.request_id}/reject`);
      } else {
        await api.delete(`/money-requests/${r.request_id}`);
      }
      await load();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPendingId(null);
    }
  }

  const list = tab === 'received' ? received : sent;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Money requests" />

      <div className="mb-4 flex gap-1 rounded-xl bg-slate-200 p-1 text-sm font-semibold">
        {(['received', 'sent'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-1.5 capitalize ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {t} ({t === 'received' ? received.length : sent.length})
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState title={`No ${tab} requests`} />
      ) : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.request_id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <Link to={`/requests/${r.reference}`} className="group">
                  <p className="text-sm font-semibold text-slate-800 group-hover:text-brand-700">
                    {tab === 'received'
                      ? `${r.counterparty_name} requested`
                      : `You requested from ${r.counterparty_name}`}
                  </p>
                  <p className="text-xl font-extrabold text-slate-900">{formatBdt(r.amount_bdt)}</p>
                  {r.reason && <p className="text-sm text-slate-500">“{r.reason}”</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    {fullTime(r.created_at)} · {r.reference}
                  </p>
                </Link>
                <StatusBadge status={r.status} />
              </div>

              {r.status === 'PENDING' && (
                <div className="mt-3 flex gap-2">
                  {tab === 'received' ? (
                    <>
                      <button
                        className="btn-primary flex-1 !py-2"
                        disabled={pendingId === r.request_id}
                        onClick={() => act(r, 'approve')}
                      >
                        {pendingId === r.request_id ? <Spinner className="h-4 w-4" /> : 'Approve & pay'}
                      </button>
                      <button
                        className="btn-ghost flex-1 !py-2"
                        disabled={pendingId === r.request_id}
                        onClick={() => act(r, 'reject')}
                      >
                        Reject
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn-danger w-full !py-2"
                      disabled={pendingId === r.request_id}
                      onClick={() => act(r, 'cancel')}
                    >
                      Cancel request
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

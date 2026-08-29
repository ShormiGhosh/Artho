import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, newIdempotencyKey } from '../lib/api';
import { formatBdt, fullTime, relativeTime } from '../lib/format';
import { Alert, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { MoneyRequest } from '../types';

export default function RequestDetailsPage() {
  const { reference } = useParams();
  const { me, refresh } = useAuth();
  const navigate = useNavigate();

  const [req, setReq] = useState<MoneyRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'cancel'>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get(`/money-requests/${reference}`);
      setReq(data.data as MoneyRequest);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [reference]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(action: 'approve' | 'reject' | 'cancel') {
    if (!req) return;
    setBusy(action);
    setActionError(null);
    try {
      if (action === 'approve') {
        await api.post(`/money-requests/${req.request_id}/approve`, null, {
          headers: { 'Idempotency-Key': newIdempotencyKey(me!.user_id) },
        });
      } else if (action === 'reject') {
        await api.post(`/money-requests/${req.request_id}/reject`, {
          reason: rejectReason.trim() || undefined,
        });
      } else {
        await api.delete(`/money-requests/${req.request_id}`);
      }
      await load();
      refresh();
      setShowReject(false);
      setRejectReason('');
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !req) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Alert>{error ?? 'Not found'}</Alert>
        <Link to="/requests" className="btn-ghost">
          Back to requests
        </Link>
      </div>
    );
  }

  const iAmRequestee = me?.user_id === req.requestee_id;
  const iAmRequester = me?.user_id === req.requester_id;
  const pending = req.status === 'PENDING';

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Request details" />
      <div className="card p-6">
        <div className="text-center">
          <p className="text-sm text-slate-500">
            {req.direction === 'SENT'
              ? `You requested from ${req.requestee_name}`
              : `${req.requester_name} requested from you`}
          </p>
          <p className="my-1 text-3xl font-extrabold text-slate-900">
            {formatBdt(req.amount_bdt)}
          </p>
          <StatusBadge status={req.status} />
        </div>

        <dl className="mt-6 divide-y divide-slate-100 text-sm">
          <Row k="Request ID" v={req.reference} mono copy />
          <Row k="Direction" v={req.direction} />
          <Row k="Requester" v={req.requester_name ?? '—'} />
          <Row k="Requestee" v={req.requestee_name ?? '—'} />
          {req.reason && <Row k="Reason" v={req.reason} />}
          <Row k="Created" v={fullTime(req.created_at)} />
          {pending && <Row k="Expires" v={`${fullTime(req.expires_at)} (${relativeTime(req.expires_at)})`} />}
          {req.approved_at && <Row k="Approved" v={fullTime(req.approved_at)} />}
          {req.rejected_at && <Row k="Rejected" v={fullTime(req.rejected_at)} />}
          {req.rejection_reason && <Row k="Rejection reason" v={req.rejection_reason} />}
          {req.cancelled_at && <Row k="Cancelled" v={fullTime(req.cancelled_at)} />}
        </dl>

        {req.related_transfer_reference && (
          <Link
            to={`/tx/${req.related_transfer_reference}`}
            className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm hover:bg-slate-100"
          >
            <span className="text-slate-500">Linked transfer</span>
            <span className="font-mono text-xs font-semibold text-brand-700">
              {req.related_transfer_reference} →
            </span>
          </Link>
        )}

        {actionError && (
          <div className="mt-4">
            <Alert>{actionError}</Alert>
          </div>
        )}

        {pending && iAmRequestee && (
          <div className="mt-5 space-y-2">
            {!showReject ? (
              <div className="flex gap-2">
                <button
                  className="btn-primary flex-1"
                  disabled={busy !== null}
                  onClick={() => run('approve')}
                >
                  {busy === 'approve' ? <Spinner className="h-4 w-4" /> : 'Approve & pay'}
                </button>
                <button
                  className="btn-ghost flex-1"
                  disabled={busy !== null}
                  onClick={() => setShowReject(true)}
                >
                  Reject
                </button>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl bg-slate-50 p-3">
                <label className="label">Reason for rejection (optional)</label>
                <input
                  className="input"
                  maxLength={200}
                  placeholder="e.g. Wrong amount"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    className="btn-danger flex-1"
                    disabled={busy !== null}
                    onClick={() => run('reject')}
                  >
                    {busy === 'reject' ? <Spinner className="h-4 w-4" /> : 'Confirm reject'}
                  </button>
                  <button
                    className="btn-ghost flex-1"
                    disabled={busy !== null}
                    onClick={() => setShowReject(false)}
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {pending && iAmRequester && (
          <button
            className="btn-danger mt-5 w-full"
            disabled={busy !== null}
            onClick={() => run('cancel')}
          >
            {busy === 'cancel' ? <Spinner className="h-4 w-4" /> : 'Cancel request'}
          </button>
        )}

        <button onClick={() => navigate('/requests')} className="btn-ghost mt-4 w-full">
          Back to requests
        </button>
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

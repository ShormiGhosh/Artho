import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatBdt, fullTime } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { StipendReceived } from '../types';

export default function StipendsPage() {
  const { me } = useAuth();
  const [data, setData] = useState<StipendReceived | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/stipends/received')
      .then(({ data }) => setData(data.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16 text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const noNid = !me?.nid;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Stipends & grants" />

      {noNid && (
        <Alert kind="info">
          Add your National ID on the{' '}
          <Link to="/profile" className="font-semibold underline">
            Profile
          </Link>{' '}
          page. Primary and secondary stipends are paid to the account registered with the
          guardian's own NID.
        </Alert>
      )}

      <div className="card overflow-hidden">
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 p-6 text-white">
          <p className="text-sm text-emerald-100">Total stipend received</p>
          <p className="mt-1 text-3xl font-extrabold">
            {formatBdt(data?.total_received_bdt ?? '0')}
          </p>
          <p className="mt-1 text-xs text-emerald-200">
            Credited straight to your wallet — no cash-out fee at any agent.
          </p>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Enrolled programmes
        </h2>
        {!data || data.enrollments.length === 0 ? (
          <EmptyState
            title="You are not enrolled in any programme"
            hint="Your school or institution enrols you using your guardian's NID."
          />
        ) : (
          <div className="space-y-2">
            {data.enrollments.map((e) => (
              <div key={e.program_reference} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="badge bg-gold-100 text-gold-800">{e.category}</span>
                      <StatusBadge status={e.status} />
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{e.program_name}</p>
                    <p className="text-xs text-slate-400">
                      {e.owner_name} · {e.institution_name} · NID {e.guardian_nid}
                    </p>
                  </div>
                  {e.default_amount_bdt && (
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-slate-900">
                        {formatBdt(e.default_amount_bdt)}
                      </p>
                      <p className="text-xs text-slate-400">per cycle</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          Payments received
        </h2>
        {!data || data.payments.length === 0 ? (
          <EmptyState title="No stipend payments yet" />
        ) : (
          <div className="card divide-y divide-slate-100">
            {data.payments.map((p) => (
              <Link
                key={p.transfer_id}
                to={`/tx/${p.reference}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  ৳
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">
                    {p.program_name ?? 'Stipend'} · {p.from_name}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {fullTime(p.created_at)} · {p.reference} · fee {formatBdt(p.fee_bdt)}
                  </span>
                </span>
                <span className="text-right text-sm font-bold text-emerald-600">
                  + {formatBdt(p.amount_bdt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

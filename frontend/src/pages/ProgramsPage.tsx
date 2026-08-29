import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { formatBdt, relativeTime } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner, StatusBadge } from '../components/ui';
import type { StipendCategory, StipendProgram } from '../types';

const CATEGORIES: StipendCategory[] = ['STIPEND', 'SCHOLARSHIP', 'GRANT'];

export default function ProgramsPage() {
  const { me } = useAuth();
  const [programs, setPrograms] = useState<StipendProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<StipendCategory>('STIPEND');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/stipend-programs');
      setPrograms(data.data.programs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/stipend-programs', {
        name: name.trim(),
        category,
        description: description.trim() || undefined,
      });
      setName('');
      setDescription('');
      setCreating(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Programmes"
        subtitle={`${me?.full_name} · disbursing wallet: ${
          me ? formatBdt(me.wallet.balance_bdt) : '—'
        }`}
      />

      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ New programme'}
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="card mb-4 space-y-3 p-5">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className="label">Programme name</label>
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Primary Education Stipend 2026"
              required
            />
          </div>
          <div>
            <label className="label">Category</label>
            <div className="flex gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    category === c ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Description (optional)</label>
            <textarea
              className="input"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Create programme'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : programs.length === 0 ? (
        <EmptyState title="No programmes yet" hint="Create one to enrol beneficiaries and disburse." />
      ) : (
        <div className="space-y-3">
          {programs.map((p) => (
            <Link key={p.program_id} to={`/programs/${p.reference}`} className="card block p-5 hover:ring-brand-300">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="badge bg-gold-100 text-gold-800">{p.category}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <p className="mt-1 text-lg font-bold text-slate-900">{p.name}</p>
                  {p.description && (
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{p.description}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {p.reference} · created {relativeTime(p.created_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="font-bold text-slate-900">{p.beneficiary_count ?? 0}</p>
                  <p className="text-xs text-slate-400">beneficiaries</p>
                  <p className="mt-2 font-bold text-emerald-600">
                    {formatBdt(p.total_disbursed_bdt ?? '0')}
                  </p>
                  <p className="text-xs text-slate-400">disbursed</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

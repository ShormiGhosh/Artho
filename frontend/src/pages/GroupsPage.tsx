import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { formatBdt } from '../lib/format';
import { Alert, EmptyState, PageHeader, Spinner } from '../components/ui';
import UserSearch from '../components/UserSearch';
import type { DebtGroupSummary, UserResult } from '../types';

function NetTag({ role, net }: { role: string; net: string }) {
  if (role === 'SETTLED') return <span className="text-xs text-slate-400">settled up</span>;
  const owed = role === 'CREDITOR';
  return (
    <span className={`text-sm font-bold ${owed ? 'text-emerald-600' : 'text-rose-600'}`}>
      {owed ? 'you are owed ' : 'you owe '}
      {formatBdt(net.replace('-', ''))}
    </span>
  );
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<DebtGroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<UserResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/debt-groups');
      setGroups(data.data);
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
      await api.post('/debt-groups', {
        name: name.trim(),
        member_ids: picked.map((p) => p.user_id),
      });
      setName('');
      setPicked([]);
      setCreating(false);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Groups" subtitle="Track shared debts and settle up with the fewest transfers." />

      <div className="mb-4 flex justify-end">
        <button className="btn-primary" onClick={() => setCreating((c) => !c)}>
          {creating ? 'Cancel' : '+ New group'}
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="card mb-4 space-y-3 p-5">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className="label">Group name</label>
            <input
              className="input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cox's Bazar trip"
              required
            />
          </div>
          <div>
            <label className="label">Add members</label>
            {picked.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {picked.map((p) => (
                  <span
                    key={p.user_id}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-700"
                  >
                    {p.full_name}
                    <button
                      type="button"
                      onClick={() => setPicked((xs) => xs.filter((x) => x.user_id !== p.user_id))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <UserSearch
              onSelect={(u) =>
                setPicked((xs) => (xs.some((x) => x.user_id === u.user_id) ? xs : [...xs, u]))
              }
            />
            <p className="mt-1 text-xs text-slate-400">You are added automatically.</p>
          </div>
          <button className="btn-primary" disabled={busy || !name.trim()}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Create group'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-12 text-brand-600">
          <Spinner className="h-6 w-6" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState title="No groups yet" hint="Create one to start tracking who owes whom." />
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Link key={g.group_id} to={`/groups/${g.reference}`} className="card block p-5 hover:ring-brand-300">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold text-slate-900">{g.name}</p>
                  <p className="text-xs text-slate-400">
                    {g.reference} · {g.member_count} members
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Outstanding {formatBdt(g.total_outstanding_bdt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <NetTag role={g.my_role} net={g.my_net_bdt} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

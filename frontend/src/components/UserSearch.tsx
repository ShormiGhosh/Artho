import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { UserResult } from '../types';
import { Spinner } from './ui';

export default function UserSearch({
  onSelect,
}: {
  onSelect: (u: UserResult) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    timer.current = window.setTimeout(async () => {
      try {
        const { data } = await api.get('/users/search', { params: { q } });
        setResults(data.data.results);
      } finally {
        setLoading(false);
        setTouched(true);
      }
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [q]);

  return (
    <div>
      <label className="label">Recipient</label>
      <div className="relative">
        <input
          autoFocus
          className="input"
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading && (
          <div className="absolute right-3 top-3 text-slate-400">
            <Spinner className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
        {results.map((u) => (
          <button
            key={u.user_id}
            onClick={() => onSelect(u)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {u.full_name.charAt(0)}
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-800">{u.full_name}</span>
              <span className="block text-xs text-slate-400">{u.email}</span>
            </span>
          </button>
        ))}
        {touched && !loading && q.trim() && results.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            No users match “{q}”.
          </p>
        )}
      </div>
    </div>
  );
}

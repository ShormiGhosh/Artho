import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { formatBdt, fullTime } from '../lib/format';
import { Alert, PageHeader, Spinner } from '../components/ui';

export default function ProfilePage() {
  const { me, refresh } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const [nid, setNid] = useState('');
  const [nidBusy, setNidBusy] = useState(false);
  const [nidMsg, setNidMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    setNid(me?.nid ?? '');
  }, [me?.nid]);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/auth/change-password', {
        current_password: current,
        new_password: next,
      });
      setMsg({ kind: 'success', text: 'Password updated.' });
      setCurrent('');
      setNext('');
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function saveNid(e: FormEvent) {
    e.preventDefault();
    setNidMsg(null);
    if (nid && !/^(\d{10}|\d{13}|\d{17})$/.test(nid.trim())) {
      setNidMsg({ kind: 'error', text: 'NID must be 10, 13 or 17 digits.' });
      return;
    }
    setNidBusy(true);
    try {
      await api.patch('/auth/me', { nid: nid.trim() || null });
      await refresh();
      setNidMsg({ kind: 'success', text: 'National ID saved.' });
    } catch (err) {
      setNidMsg({ kind: 'error', text: errorMessage(err) });
    } finally {
      setNidBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader title="Profile" />

      <div className="card p-6">
        <dl className="divide-y divide-slate-100 text-sm">
          <Row k="Name" v={me?.full_name ?? ''} />
          <Row k="Email" v={me?.email ?? ''} />
          <Row k="Account type" v={me?.role === 'INSTITUTION' ? 'Institution' : 'Individual'} />
          <Row k="Account status" v={me?.account_status ?? ''} />
          <Row k="National ID" v={me?.nid ?? 'Not set'} />
          <Row k="Member since" v={me ? fullTime(me.created_at) : ''} />
          <Row k="Balance" v={me ? formatBdt(me.wallet.balance_bdt) : ''} />
        </dl>
      </div>

      {me?.role !== 'INSTITUTION' && (
        <form onSubmit={saveNid} className="card space-y-3 p-6">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
            National ID (NID)
          </h2>
          {nidMsg && <Alert kind={nidMsg.kind}>{nidMsg.text}</Alert>}
          <p className="text-sm text-slate-500">
            Stipend money (উপবৃত্তি) for primary and secondary students is paid to the account
            registered with the guardian's own NID. It must match the NID your institution
            enrols you with.
          </p>
          <input
            className="input"
            inputMode="numeric"
            placeholder="10, 13 or 17 digits"
            value={nid}
            onChange={(e) => setNid(e.target.value)}
          />
          <button className="btn-primary" disabled={nidBusy}>
            {nidBusy ? <Spinner className="h-4 w-4" /> : 'Save NID'}
          </button>
        </form>
      )}

      <form onSubmit={changePassword} className="card space-y-4 p-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Change password</h2>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div>
          <label className="label">Current password</label>
          <input
            className="input"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">New password</label>
          <input
            className="input"
            type="password"
            minLength={8}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </div>
        <button className="btn-primary" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : 'Update password'}
        </button>
      </form>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800">{v}</dd>
    </div>
  );
}

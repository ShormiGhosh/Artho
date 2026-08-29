import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';
import { Alert, Spinner } from '../components/ui';

type Role = 'USER' | 'INSTITUTION';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('USER');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [nid, setNid] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!/^(?:\+?880|0)1[3-9]\d{8}$/.test(phone.trim())) {
      setError('Enter a valid Bangladeshi phone number, e.g. 01712345678.');
      return;
    }
    if (nid && !/^(\d{10}|\d{13}|\d{17})$/.test(nid.trim())) {
      setError('NID must be 10, 13 or 17 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { dev_code } = await register({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        phone: phone.trim(),
        role,
        nid: nid.trim() || undefined,
      });
      navigate('/verify', { state: { devCode: dev_code } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <img
          src="/artho-logo.png"
          alt="Artho"
          className="mx-auto mb-3 h-20 w-20 object-contain"
        />
        <h1 className="mb-1 text-center text-3xl font-extrabold text-brand-700">
          Ar<span className="text-gold-500">tho</span>
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          {role === 'INSTITUTION'
            ? 'Run stipend, scholarship & grant programmes.'
            : 'Get ৳100,000 to start moving.'}
        </p>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Alert>{error}</Alert>}

          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
            {(['USER', 'INSTITUTION'] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`rounded-lg py-1.5 ${
                  role === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
                }`}
              >
                {r === 'USER' ? 'Individual' : 'Institution'}
              </button>
            ))}
          </div>

          <div>
            <label className="label">{role === 'INSTITUTION' ? 'Institution name' : 'Full name'}</label>
            <input
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input
              className="input"
              type="tel"
              inputMode="numeric"
              placeholder="01712345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {role === 'USER' && (
            <div>
              <label className="label">
                National ID (NID) <span className="font-normal text-slate-400">— optional</span>
              </label>
              <input
                className="input"
                inputMode="numeric"
                placeholder="10, 13 or 17 digits"
                value={nid}
                onChange={(e) => setNid(e.target.value)}
              />
              <p className="mt-1 text-xs text-slate-400">
                Required later to receive government stipends (উপবৃত্তি) — must match the
                guardian NID your institution registers.
              </p>
            </div>
          )}
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Create account'}
          </button>
          <p className="text-center text-sm text-slate-500">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-brand-600 hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

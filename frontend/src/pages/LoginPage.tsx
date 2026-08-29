import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';
import { Alert, Spinner } from '../components/ui';

const DEMO = [
  ['rana@example.com', 'Rana Ahmed'],
  ['fatima@example.com', 'Fatima Khan'],
  ['arjun@example.com', 'Arjun Roy'],
];

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-3xl font-extrabold text-brand-700">
          Ar<span className="text-slate-900">tho</span>
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          Move money with certainty.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Log in'}
          </button>
          <p className="text-center text-sm text-slate-500">
            New here?{' '}
            <Link to="/register" className="font-semibold text-brand-600 hover:underline">
              Create an account
            </Link>
          </p>
        </form>

        <div className="mt-4 rounded-xl bg-white/60 p-4 text-xs text-slate-500 ring-1 ring-slate-200">
          <p className="mb-2 font-semibold text-slate-600">Demo accounts (password: Test123456)</p>
          <div className="flex flex-wrap gap-2">
            {DEMO.map(([mail, name]) => (
              <button
                key={mail}
                onClick={() => {
                  setEmail(mail);
                  setPassword('Test123456');
                }}
                className="rounded-lg bg-slate-100 px-2.5 py-1 hover:bg-slate-200"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

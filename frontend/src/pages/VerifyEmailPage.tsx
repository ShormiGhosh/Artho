import { FormEvent, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { Alert, Spinner } from '../components/ui';

const RESEND_COOLDOWN_S = 60;

export default function VerifyEmailPage() {
  const { me, refresh, logout } = useAuth();
  const location = useLocation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // Dev/demo convenience: the register response echoes the code when no SMTP
  // is configured, so the flow is testable without a real mailbox. Never
  // present in production regardless.
  const [devCode, setDevCode] = useState<string | null>(
    (location.state as { devCode?: string } | null)?.devCode ?? null
  );

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/verify-email', { code: code.trim() });
      await refresh(); // account_status flips to ACTIVE; App re-renders into the full app
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setResendBusy(true);
    setResendMsg(null);
    setError(null);
    try {
      const { data } = await api.post('/auth/resend-verification');
      if (data.data.already_verified) {
        await refresh();
        return;
      }
      setDevCode(data.data.dev_code ?? null);
      setResendMsg('A new code has been sent.');
      setCooldown(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <img
          src="/artho-logo.png"
          alt="Artho"
          className="mx-auto mb-3 h-20 w-20 object-contain"
        />
        <h1 className="mb-1 text-center text-2xl font-extrabold text-brand-700">
          Verify your email
        </h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          We sent a 6-digit code to <span className="font-semibold text-slate-700">{me?.email}</span>.
          Enter it below to activate your account.
        </p>

        <form onSubmit={submit} className="card space-y-4 p-6">
          {error && <Alert>{error}</Alert>}
          {resendMsg && <Alert kind="success">{resendMsg}</Alert>}

          {devCode && (
            <div className="rounded-xl bg-gold-50 px-4 py-3 text-sm text-gold-800 ring-1 ring-gold-200">
              <p className="font-semibold">Dev mode — no email is actually sent</p>
              <p className="mt-0.5">
                Your code is{' '}
                <button
                  type="button"
                  className="font-mono font-bold underline"
                  onClick={() => setCode(devCode)}
                >
                  {devCode}
                </button>
              </p>
            </div>
          )}

          <div>
            <label className="label">6-digit code</label>
            <input
              className="input text-center text-lg tracking-[0.5em]"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              required
            />
          </div>

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : 'Verify'}
          </button>

          <button
            type="button"
            className="btn-ghost w-full"
            onClick={resend}
            disabled={resendBusy || cooldown > 0}
          >
            {resendBusy ? (
              <Spinner className="h-4 w-4" />
            ) : cooldown > 0 ? (
              `Resend code (${cooldown}s)`
            ) : (
              'Resend code'
            )}
          </button>

          <p className="text-center text-sm text-slate-500">
            Wrong account?{' '}
            <button
              type="button"
              onClick={() => void logout()}
              className="font-semibold text-brand-600 hover:underline"
            >
              Log out
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

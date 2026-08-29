import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatBdt, relativeTime } from '../lib/format';
import type { Notification } from '../types';

type NavItem = { to: string; label: string; end?: boolean };

const BASE_NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/send', label: 'Send' },
  { to: '/request', label: 'Request' },
  { to: '/requests', label: 'Requests' },
  { to: '/history', label: 'History' },
];

function navFor(role: string | undefined): NavItem[] {
  const middle: NavItem =
    role === 'INSTITUTION'
      ? { to: '/programs', label: 'Programmes' }
      : { to: '/stipends', label: 'Stipends' };
  return [...BASE_NAV, middle, { to: '/profile', label: 'Profile' }];
}

export default function Layout() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const NAV = navFor(me?.role);
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  async function loadNotifs() {
    try {
      const { data } = await api.get('/notifications');
      setNotifs(data.data.notifications);
      setUnread(data.data.unread_count);
    } catch {
      /* best-effort */
    }
  }

  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 15000);
    return () => clearInterval(t);
  }, []);

  async function markAll() {
    await api.post('/notifications/read-all').catch(() => undefined);
    loadNotifs();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <button
            onClick={() => navigate('/')}
            className="text-lg font-extrabold tracking-tight text-brand-700"
          >
            Ar<span className="text-slate-900">tho</span>
          </button>

          <nav className="ml-4 hidden gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs text-slate-400">Balance</p>
              <p className="text-sm font-bold text-slate-900">
                {me ? formatBdt(me.wallet.balance_bdt) : '—'}
              </p>
            </div>

            <div className="relative">
              <button
                onClick={() => setOpen((o) => !o)}
                className="relative rounded-full bg-slate-100 p-2 hover:bg-slate-200"
                aria-label="Notifications"
              >
                🔔
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {unread}
                  </span>
                )}
              </button>
              {open && (
                <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                    <span className="text-sm font-semibold">Notifications</span>
                    <button onClick={markAll} className="text-xs text-brand-600 hover:underline">
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {notifs.length === 0 && (
                      <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing yet</p>
                    )}
                    {notifs.map((n) => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 ${n.is_read ? 'opacity-60' : 'bg-brand-50/40'}`}
                      >
                        <p className="text-sm font-semibold text-slate-800">{n.title}</p>
                        <p className="text-sm text-slate-600">{n.message}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{relativeTime(n.created_at)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button onClick={logout} className="btn-ghost !px-3 !py-1.5 text-xs">
              Log out
            </button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 md:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6" onClick={() => open && setOpen(false)}>
        <Outlet />
      </main>
    </div>
  );
}

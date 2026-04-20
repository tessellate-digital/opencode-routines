import { useState, useEffect, useCallback } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import classNames from 'classnames';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';

const links = [
  { to: '/routines', label: 'Routines' },
  { to: '/runs', label: 'Runs' },
  { to: '/settings', label: 'Settings' },
  ...(import.meta.env.VITE_DEV === 'true' ? [{ to: '/dev', label: 'Dev' }] : []),
];

export default function Layout() {
  const [runningCount, setRunningCount] = useState(0);

  const fetchRunning = useCallback(async () => {
    try {
      const stats = await api.getRunStats();
      setRunningCount(stats.running);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchRunning();
  }, [fetchRunning]);

  useGlobalSSE(fetchRunning);

  return (
    <div className="min-h-screen relative before:content-[''] before:fixed before:inset-0 before:[background-image:var(--bg-dots)] before:[background-size:18px_18px] before:pointer-events-none before:z-0 before:opacity-70">
      <div className="relative z-[1]">
        <div className="sticky top-0 z-10 flex items-center gap-[18px] py-3 px-7 border-b border-[var(--border)] bg-[var(--surface)] backdrop-blur-[20px]">
          <NavLink
            to="/"
            className="flex items-center gap-2.5 pr-2 cursor-pointer no-underline text-inherit"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pink-400 to-purple-500 grid place-items-center shadow-[0_2px_6px_rgba(168,85,247,0.35),inset_0_1px_0_rgba(255,255,255,0.2)]">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div className="font-sans text-[14px] font-semibold tracking-[-0.01em]">
              open<span className="text-[color:var(--fg-dim)] font-normal"> / routines</span>
            </div>
          </NavLink>

          <nav className="flex gap-0.5 ml-3">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  classNames(
                    'py-1.5 px-3 rounded-[var(--r-md)] text-[13px] font-medium cursor-pointer no-underline transition-all duration-[var(--dur)] ease-[var(--ease)]',
                    {
                      'bg-[var(--accent-soft)] text-[color:var(--accent)]': isActive,
                      'text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] hover:bg-[var(--border)]':
                        !isActive,
                    }
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2.5 font-mono text-xs text-[color:var(--fg-muted)]">
            {runningCount > 0 && (
              <span className="status running">
                <span className="dot" />
                <span>{runningCount} running</span>
              </span>
            )}
          </div>
        </div>

        <main className="py-8 px-12 pb-20 min-w-0 max-w-[1160px] mx-auto w-full">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

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
    <div className="app">
      <div className="shell">
        <div className="topbar">
          <NavLink to="/" className="brand no-underline text-inherit">
            <div className="brand-mark">
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
            <div className="brand-name">
              open<span className="tag"> / routines</span>
            </div>
          </NavLink>

          <nav className="topnav">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) => classNames({ active: isActive })}
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="topbar-right">
            {runningCount > 0 && (
              <span className="status running">
                <span className="dot" />
                <span>{runningCount} running</span>
              </span>
            )}
          </div>
        </div>

        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { StatusBadge } from '../components/RunsTable';
import type { Routine } from '../lib/types';

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m13 13-2.8-2.8" />
    </svg>
  );
}

export default function RoutinesList() {
  const navigate = useNavigate();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      setRoutines(await api.getRoutines(filter !== 'all' ? { status: filter } : undefined));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);
  useGlobalSSE(
    useCallback(() => {
      load();
    }, [load])
  );

  if (loading) return <p className="hint">Loading…</p>;
  if (error) return <p className="text-[color:var(--status-failed)] text-[13px]">Error: {error}</p>;

  const filtered = routines.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
  });

  return (
    <div className="route-fade">
      <div className="page-head">
        <div>
          <h1>Routines</h1>
          <div className="sub">
            {routines.length} routine{routines.length !== 1 ? 's' : ''}
          </div>
        </div>
        <Link to="/routines/new" className="btn primary">
          + New routine
        </Link>
      </div>

      <div className="toolbar">
        <div className="pills">
          {['all', 'running', 'success', 'failed'].map((p) => (
            <button
              key={p}
              className={classNames('pill', { active: filter === p })}
              onClick={() => setFilter(p)}
            >
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div className="search">
          <SearchIcon />
          <input
            placeholder="Search routines…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="kbd">⌘K</span>
        </div>
      </div>

      {filtered.length > 0 ? (
        <div className="card">
          <table className="tbl">
            <thead>
              <tr>
                <th>Routine</th>
                <th>Model</th>
                <th>Triggers</th>
                <th>Last status</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/routines/${r.id}`)}>
                  <td>
                    <div className="primary-cell">
                      {r.name}
                      {r.workspace_path && !r.workspace_accessible && (
                        <span className="ml-2 text-[10px] text-[color:var(--status-warning)] font-mono">
                          folder missing
                        </span>
                      )}
                    </div>
                    {r.description && <div className="sub">{r.description}</div>}
                  </td>
                  <td>
                    <span className="mono">{r.model || 'default'}</span>
                  </td>
                  <td>
                    <span className="mono">{r.triggers_count}</span>
                  </td>
                  <td>
                    {r.last_run_status ? (
                      <StatusBadge status={r.last_run_status} />
                    ) : (
                      <span className="status pending">
                        <span className="dot" />
                        idle
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={classNames({
                        'text-[color:var(--status-success)] font-medium': r.enabled,
                        'text-[color:var(--fg-dim)] font-normal': !r.enabled,
                      })}
                    >
                      {r.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="chev">
                    <ChevronIcon />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : routines.length === 0 ? (
        <div className="card">
          <div className="py-20 px-10 text-center grid gap-2.5 justify-items-center">
            <div className="w-[72px] h-[72px] rounded-[22px] bg-gradient-to-br from-[#4f46e5] to-[#c5b8ff] grid place-items-center text-white mb-3 shadow-[0_12px_40px_rgba(79,70,229,0.3)] animate-[float_4s_ease-in-out_infinite]">
              <svg viewBox="0 0 16 16" width="32" height="32" fill="currentColor" stroke="none">
                <path d="M8 1.5 9.4 6 14 7.4 9.4 8.8 8 13.3 6.6 8.8 2 7.4 6.6 6 8 1.5z" />
              </svg>
            </div>
            <h2 className="text-[22px] m-0 font-semibold">Nothing scheduled yet</h2>
            <p className="text-[color:var(--fg-muted)] text-sm max-w-[420px] m-0 leading-[1.55]">
              Routines run a prompt when a trigger fires — on a schedule, or when files change. Set
              your first one up in under a minute.
            </p>
            <div className="flex gap-2 mt-4">
              <Link to="/routines/new" className="btn primary">
                + New routine
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="p-12 text-center text-[color:var(--fg-muted)]">No routines match.</div>
        </div>
      )}
    </div>
  );
}

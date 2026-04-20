import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { StatusBadge } from '../components/RunsTable';
import { timeAgo, duration } from '../lib/utils';
import type { Run } from '../lib/types';

const PAGE_SIZE = 15;

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

export default function RunsList() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const results = await api.getRuns({
        limit: PAGE_SIZE + 1,
        offset: page * PAGE_SIZE,
        status: filter !== 'all' ? filter : undefined,
      });
      setHasNext(results.length > PAGE_SIZE);
      setRuns(results.slice(0, PAGE_SIZE));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    load();
  }, [load]);
  useGlobalSSE(
    useCallback(() => {
      setPage(0);
    }, [])
  );

  if (loading) return <p className="hint">Loading…</p>;
  if (error) return <p className="text-[color:var(--status-failed)] text-[13px]">Error: {error}</p>;

  const filtered = runs.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.routine_name.toLowerCase().includes(q) || r.id.includes(q);
  });

  return (
    <div className="route-fade">
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <div className="sub">Every execution, newest first</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="pills">
          {['all', 'running', 'success', 'failed'].map((p) => (
            <button
              key={p}
              className={classNames('pill', { active: filter === p })}
              onClick={() => {
                setFilter(p);
                setPage(0);
              }}
            >
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <div className="search">
          <SearchIcon />
          <input
            placeholder="Search runs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Run</th>
              <th>Routine</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Started</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => navigate(`/runs/${r.id}`)}>
                <td>
                  <span className="mono">{r.id.slice(0, 8)}</span>
                </td>
                <td>
                  <div className="primary-cell">{r.routine_name}</div>
                </td>
                <td>
                  <span className="trig">
                    <span>{r.trigger_type}</span>
                  </span>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  <span className="mono">{duration(r.started_at, r.finished_at)}</span>
                </td>
                <td>
                  <span className="mono">{timeAgo(r.started_at)}</span>
                </td>
                <td className="chev">
                  <ChevronIcon />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-12 text-center text-[color:var(--fg-muted)]">
                  No runs match.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pager">
          <button className="btn sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
            ← Prev
          </button>
          <span>Page {page + 1}</span>
          <button className="btn sm" onClick={() => setPage((p) => p + 1)} disabled={!hasNext}>
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

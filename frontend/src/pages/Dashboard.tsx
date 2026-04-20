import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import classNames from 'classnames';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { RunsTable } from '../components/RunsTable';
import type { Routine, Run } from '../lib/types';

export default function Dashboard() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, ru] = await Promise.all([api.getRoutines(), api.getRuns({ limit: 10 })]);
      setRoutines(r);
      setRuns(ru);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const running = runs.filter((r) => r.status === 'running').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const success = runs.filter((r) => r.status === 'success').length;

  return (
    <div className="route-fade">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <div className="sub">
            {routines.length} routines · {runs.length} recent runs
          </div>
        </div>
        <Link to="/routines/new" className="btn primary">
          + New Routine
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-[22px]">
        <div className="py-[14px] px-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)] shadow-[var(--shadow-sm)]">
          <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)]">
            Routines
          </div>
          <div className="text-[22px] font-semibold tracking-[-0.01em] mt-1 tabular-nums">
            {routines.length}
          </div>
        </div>
        <div className="py-[14px] px-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)] shadow-[var(--shadow-sm)]">
          <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)]">
            Running
          </div>
          <div className="text-[22px] font-semibold tracking-[-0.01em] mt-1 tabular-nums text-[color:var(--status-running)]">
            {running}
          </div>
        </div>
        <div className="py-[14px] px-4 bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)] shadow-[var(--shadow-sm)]">
          <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)]">
            Recent failures
          </div>
          <div
            className={classNames(
              'text-[22px] font-semibold tracking-[-0.01em] mt-1 tabular-nums',
              { 'text-[color:var(--status-failed)]': failed > 0 }
            )}
          >
            {failed}
          </div>
          {success > 0 && (
            <div className="font-mono text-[11px] text-[color:var(--fg-muted)] mt-0.5">
              {success} success
            </div>
          )}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="section-h">Recent runs</div>
          <Link to="/runs" className="font-mono text-xs text-[color:var(--accent)] no-underline">
            View all →
          </Link>
        </div>
        <RunsTable runs={runs} />
      </div>
    </div>
  );
}

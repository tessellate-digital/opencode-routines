import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Error: {error}</p>;

  const running = runs.filter((r) => r.status === 'running').length;
  const failed = runs.filter((r) => r.status === 'failed').length;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Overview</h1>
        <Link to="/routines/new" className="btn btn-primary">
          + New Routine
        </Link>
      </div>

      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-border/70 bg-surface/80 shadow-sm backdrop-blur-md">
        {[
          { label: 'Routines', value: routines.length, color: 'text-foreground' },
          { label: 'Running', value: running, color: 'text-accent' },
          { label: 'Recent failures', value: failed, color: 'text-destructive' },
        ].map(({ label, value, color }, i) => (
          <div key={label} className={`px-6 py-5 ${i > 0 ? 'border-l border-border' : ''}`}>
            <div className={`font-serif text-5xl leading-none ${color}`}>{value}</div>
            <div className="mt-2 text-[12px] uppercase tracking-wider text-muted-foreground">
              {label}
            </div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">Recent runs</h2>
          <Link to="/runs" className="text-[12px] font-medium text-accent hover:underline">
            View all
          </Link>
        </div>
        <RunsTable runs={runs} />
      </div>
    </div>
  );
}

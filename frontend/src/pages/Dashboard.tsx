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

  if (loading) return <p className="text-sm text-[#6e6e73]">Loading…</p>;
  if (error) return <p className="text-sm text-[#ff3b30]">Error: {error}</p>;

  const running = runs.filter((r) => r.status === 'running').length;
  const failed = runs.filter((r) => r.status === 'failed').length;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1d1d1f]">Dashboard</h1>
        <Link to="/routines/new" className="btn btn-primary">
          New Routine
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-px rounded-lg border border-[#d1d1d6] overflow-hidden bg-[#d1d1d6]">
        {[
          {
            label: 'Routines',
            value: routines.length,
            color: 'text-[#1d1d1f]',
          },
          { label: 'Running', value: running, color: 'text-[#0071e3]' },
          { label: 'Recent failures', value: failed, color: 'text-[#ff3b30]' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white px-5 py-4">
            <div className={`text-2xl font-semibold ${color}`}>{value}</div>
            <div className="mt-0.5 text-xs text-[#6e6e73]">{label}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">Recent runs</h2>
          <Link to="/runs" className="text-xs text-[#0071e3] hover:underline">
            View all
          </Link>
        </div>
        <RunsTable runs={runs} />
      </div>
    </div>
  );
}

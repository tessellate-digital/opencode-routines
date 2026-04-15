import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { StatusBadge } from '../components/RunsTable';
import type { Routine } from '../lib/types';

export default function RoutinesList() {
  const navigate = useNavigate();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRoutines(await api.getRoutines());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useGlobalSSE(useCallback(() => { load(); }, [load]));

  if (loading) return <p className="text-sm text-[#6e6e73]">Loading…</p>;
  if (error)   return <p className="text-sm text-[#ff3b30]">Error: {error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#1d1d1f]">Routines</h1>
        <Link to="/routines/new" className="btn btn-primary">New Routine</Link>
      </div>

      {routines.length ? (
        <div className="overflow-x-auto rounded-lg border border-[#d1d1d6]">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[#d1d1d6] bg-[#f5f5f7] text-left text-xs font-medium text-[#6e6e73]">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Model</th>
                <th className="px-4 py-2.5">Triggers</th>
                <th className="px-4 py-2.5">Last run</th>
                <th className="px-4 py-2.5">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {routines.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  className="cursor-pointer bg-white hover:bg-[#f5f5f7] outline-none focus-visible:bg-[#f5f5f7]"
                  onClick={() => navigate(`/routines/${r.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/routines/${r.id}`); }
                  }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[#1d1d1f]">{r.name}</span>
                      {r.workspace_path && !r.workspace_accessible && (
                        <span className="shrink-0 rounded-full bg-[#fff5f5] border border-[#ffc9c9] px-2 py-0.5 text-[10px] font-medium text-[#ff3b30]" title={`Workspace folder inaccessible: ${r.workspace_path}`}>
                          Folder missing
                        </span>
                      )}
                    </div>
                    {r.description && <div className="mt-0.5 text-xs text-[#6e6e73]">{r.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-[#6e6e73]">{r.model || 'default'}</td>
                  <td className="px-4 py-3 text-[#6e6e73]">{r.triggers_count}</td>
                  <td className="px-4 py-3">
                    {r.last_run_status ? <StatusBadge status={r.last_run_status} /> : <span className="text-[#6e6e73]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={r.enabled ? 'text-[#34c759]' : 'text-[#6e6e73]'}>
                      {r.enabled ? 'Yes' : 'No'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-6 text-sm text-[#6e6e73]">No routines yet. <Link to="/routines/new" className="text-[#0071e3] hover:underline">Create one</Link> to get started.</p>
      )}
    </div>
  );
}

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

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Routines</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {routines.length} routine{routines.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link to="/routines/new" className="btn btn-primary">
          + New Routine
        </Link>
      </div>

      {routines.length ? (
        <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 shadow-sm backdrop-blur-md">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_0.6fr] border-b border-border/70 bg-surface/50 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <div>Name</div>
            <div>Model</div>
            <div>Triggers</div>
            <div>Last run</div>
            <div>Enabled</div>
          </div>
          {routines.map((r, i) => (
            <div
              key={r.id}
              tabIndex={0}
              className={`grid cursor-pointer grid-cols-[2fr_1fr_1fr_1fr_0.6fr] items-center px-4 py-3 text-[13px] transition-colors hover:bg-accent/5 focus-visible:bg-accent/5 focus-visible:outline-none ${i > 0 ? 'border-t border-border/70' : ''}`}
              onClick={() => navigate(`/routines/${r.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/routines/${r.id}`);
                }
              }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{r.name}</span>
                  {r.workspace_path && !r.workspace_accessible && (
                    <span
                      className="shrink-0 rounded-full border border-destructive/30 bg-destructive-soft px-2 py-0.5 text-[10px] font-medium text-destructive"
                      title={`Workspace folder inaccessible: ${r.workspace_path}`}
                    >
                      Folder missing
                    </span>
                  )}
                </div>
                {r.description && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{r.description}</div>
                )}
              </div>
              <div className="font-mono text-[12px] text-muted-foreground">
                {r.model || 'default'}
              </div>
              <div className="text-muted-foreground">{r.triggers_count}</div>
              <div>
                {r.last_run_status ? (
                  <StatusBadge status={r.last_run_status} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <div>
                <span className={r.enabled ? 'text-success font-medium' : 'text-muted-foreground'}>
                  {r.enabled ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">
          No routines yet.{' '}
          <Link to="/routines/new" className="text-accent hover:underline">
            Create one
          </Link>{' '}
          to get started.
        </p>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { RunsTable } from '../components/RunsTable';
import type { Routine, Trigger, Run } from '../lib/types';
import { useHostMounts } from '../contexts/HostMountsContext';

function ChevronLeftIcon() {
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
      <path d="m10 3-5 5 5 5" />
    </svg>
  );
}

function TriggerSummary({ trigger }: { trigger: Trigger }) {
  const { resolveHostPath } = useHostMounts();
  const cfg = trigger.config;

  if (trigger.type === 'cron') {
    return (
      <div className="trig-card mb-2">
        <div className="trig-head cursor-default">
          <span className="label">Cron</span>
          <span className="summary">{String(cfg.expression || '')}</span>
          <span className="code-chip ml-2">{String(cfg.expression || '')}</span>
        </div>
      </div>
    );
  }

  if (trigger.type === 'watcher') {
    const events = Array.isArray(cfg.events) ? (cfg.events as string[]) : [];
    const paths: string[] = Array.isArray(cfg.paths)
      ? (cfg.paths as string[])
      : typeof cfg.path === 'string' && cfg.path
        ? [cfg.path as string]
        : [];
    const recursive = cfg.recursive !== false;
    const fileFilter = cfg.fileFilter as { mode?: string; patterns?: string[] } | undefined;
    const hasFilter =
      fileFilter &&
      fileFilter.mode !== 'none' &&
      Array.isArray(fileFilter.patterns) &&
      fileFilter.patterns.length > 0;
    return (
      <div className="trig-card mb-2">
        <div className="trig-head cursor-default flex-wrap gap-1.5">
          <span className="label">Filesystem</span>
          <span className="summary font-mono text-xs">
            {paths.map(resolveHostPath).join(', ') || '—'}
          </span>
          {!recursive && <span className="code-chip text-[10.5px]">top-level only</span>}
        </div>
        <div className="px-[14px] pt-2 pb-3 border-t border-t-[var(--border)] flex gap-2 flex-wrap items-center">
          <span className="font-mono text-[11px] text-[color:var(--fg-dim)] uppercase tracking-[.06em]">
            on
          </span>
          {events.map((ev) => (
            <span key={ev} className="trig text-[11.5px]">
              {ev}
            </span>
          ))}
          {hasFilter && (
            <>
              <span className="font-mono text-[11px] text-[color:var(--fg-dim)] uppercase tracking-[.06em] ml-2">
                {fileFilter.mode === 'exclude' ? 'except' : 'only'}
              </span>
              {fileFilter.patterns!.map((p) => (
                <span key={p} className="code-chip text-[11px]">
                  {p}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    );
  }

  if (trigger.type === 'api') {
    return (
      <div className="trig-card mb-2">
        <div className="trig-head cursor-default">
          <span className="label">API</span>
          <span className="code-chip">/hooks/api/{trigger.id}</span>
        </div>
      </div>
    );
  }

  if (trigger.type === 'github') {
    const events = Array.isArray(cfg.events) ? (cfg.events as string[]).join(', ') : '';
    return (
      <div className="trig-card mb-2">
        <div className="trig-head cursor-default">
          <span className="label">GitHub</span>
          <span className="summary">{events || '—'}</span>
        </div>
      </div>
    );
  }

  return null;
}

export default function RoutineDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { resolveHostPath, resolveHostName } = useHostMounts();
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [r, t, ru] = await Promise.all([
        api.getRoutine(id),
        api.getTriggers(id),
        api.getRuns({ routine_id: id, limit: 20 }),
      ]);
      setRoutine(r);
      setTriggers(t);
      setRuns(ru);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  useGlobalSSE(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRun = async () => {
    if (!id) return;
    try {
      navigate(`/runs/${(await api.runRoutine(id)).run_id}`);
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    }
  };

  const handleToggle = async () => {
    if (!id || !routine) return;
    setToggling(true);
    try {
      const updated = await api.toggleRoutine(id, !routine.enabled);
      setRoutine(updated);
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await api.deleteRoutine(id);
      navigate('/routines');
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    }
  };

  if (loading) return <p className="hint">Loading…</p>;
  if (error) return <p className="text-[color:var(--status-failed)] text-[13px]">Error: {error}</p>;
  if (!routine)
    return <p className="text-[color:var(--status-failed)] text-[13px]">Routine not found</p>;

  return (
    <div className="route-fade">
      <Link to="/routines" className="back">
        <ChevronLeftIcon /> Routines
      </Link>

      {routine.workspace_path && !routine.workspace_accessible && (
        <div
          className="delete-confirm mb-4"
          style={{
            background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)',
            borderColor: 'color-mix(in srgb, var(--status-warning) 25%, transparent)',
          }}
        >
          <span className="font-semibold">!</span>
          <span>
            Workspace folder <code className="code-chip">{routine.workspace_path}</code> is
            inaccessible. Runs will fail.
          </span>
        </div>
      )}

      <div className="page-head">
        <div>
          <h1>{routine.name}</h1>
          <div className="sub flex items-center gap-2">
            <span
              className={classNames('status', {
                success: routine.enabled,
                pending: !routine.enabled,
              })}
            >
              <span className="dot" />
              <span>{routine.enabled ? 'enabled' : 'paused'}</span>
            </span>
            {routine.description && <span>· {routine.description}</span>}
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {confirmDelete ? (
            <div className="delete-confirm">
              <span>
                Delete <strong>{routine.name}</strong>?
              </span>
              <button className="btn sm delete-rt" onClick={handleDelete}>
                Yes, delete
              </button>
              <button className="btn sm" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                className="btn run"
                onClick={handleRun}
                disabled={routine.workspace_path !== '' && !routine.workspace_accessible}
              >
                ▶ Run now
              </button>
              <Link to={`/routines/${id}/edit`} className="btn">
                Edit
              </Link>
              <button className="btn" onClick={handleToggle} disabled={toggling}>
                {toggling ? '…' : routine.enabled ? 'Pause' : 'Enable'}
              </button>
              <button className="btn delete-rt" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5">
        {/* Prompt */}
        <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
          <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
            Prompt
          </div>
          <div className="font-mono text-[13px] leading-[1.65] whitespace-pre-wrap mt-1">
            {routine.prompt}
          </div>
        </div>

        {/* Config grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
            <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
              Model
            </div>
            <div className="font-mono text-[13px] font-medium text-[color:var(--fg)]">
              {routine.model || '—'}
            </div>
          </div>
          <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
            <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
              Agent
            </div>
            <div className="font-mono text-[13px] font-medium text-[color:var(--fg)]">
              {routine.agent}
            </div>
          </div>
          <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
            <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
              Run mode
            </div>
            <div className="text-sm font-medium text-[color:var(--fg)]">
              {routine.run_mode === 'foreground' ? 'Foreground only' : 'Background'}
            </div>
          </div>
          {routine.workspace_path && (
            <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
              <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
                Workspace
              </div>
              <div className="font-mono text-[13px] font-medium text-[color:var(--fg)] flex items-center gap-1.5">
                {resolveHostName(routine.workspace_path)}
                {!routine.workspace_accessible && (
                  <span className="text-[10px] text-[color:var(--status-failed)]">
                    inaccessible
                  </span>
                )}
              </div>
            </div>
          )}
          {routine.repository && (
            <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
              <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
                Repository
              </div>
              <div className="font-mono text-[13px] font-medium text-[color:var(--fg)]">
                {routine.repository}
              </div>
            </div>
          )}
          {routine.repository && (
            <div className="py-4 px-[18px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[var(--r-md)]">
              <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-1.5">
                Branch
              </div>
              <div className="font-mono text-[13px] font-medium text-[color:var(--fg)]">
                {routine.branch}
              </div>
            </div>
          )}
        </div>

        {/* Triggers */}
        <div>
          <div className="section-h">Triggers · {triggers.length}</div>
          {triggers.length > 0 ? (
            triggers.map((t) => <TriggerSummary key={t.id} trigger={t} />)
          ) : (
            <p className="hint">No triggers — this routine runs only when invoked manually.</p>
          )}
        </div>

        {/* Run history */}
        <div>
          <div className="section-h">Recent runs · {runs.length}</div>
          <RunsTable runs={runs} />
        </div>
      </div>
    </div>
  );
}

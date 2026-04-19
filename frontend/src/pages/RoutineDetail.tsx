import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useGlobalSSE } from '../hooks/useSSE';
import { RunsTable } from '../components/RunsTable';
import { CronPicker } from '../components/CronPicker';
import { FileTypeFilter, type FileFilterValue } from '../components/FileTypeFilter';
import { FolderPicker } from '../components/FolderPicker';
import type { Routine, Trigger, Run } from '../lib/types';
import { useHostMounts } from '../contexts/HostMountsContext';

function RoutineStatusBadge({
  enabled,
  inaccessible,
}: {
  enabled: boolean;
  inaccessible?: boolean;
}) {
  if (inaccessible) {
    return (
      <span className="status-pill bg-warning-soft text-warning">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        Workspace inaccessible
      </span>
    );
  }
  return (
    <span
      className={`status-pill ${enabled ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground'}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${enabled ? 'bg-success' : 'bg-muted-foreground'}`}
      />
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function TriggerConfig({ trigger }: { trigger: Trigger }) {
  const { resolveHostPath } = useHostMounts();
  const cfg = trigger.config;

  const codeVal = (v: string) => (
    <code className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[12px] text-foreground">
      {v}
    </code>
  );

  if (trigger.type === 'cron') {
    return (
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-sm divide-y divide-border/50">
        <ConfigRow label="Schedule" value={codeVal(String(cfg.expression || ''))} />
      </div>
    );
  }

  if (trigger.type === 'api') {
    return (
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-sm divide-y divide-border/50">
        <ConfigRow label="Endpoint" value={codeVal(`/hooks/api/${trigger.id}`)} />
        <ConfigRow label="Token" value={codeVal(`${String(cfg.token || '').slice(0, 8)}…`)} />
      </div>
    );
  }

  if (trigger.type === 'github') {
    const events = Array.isArray(cfg.events) ? (cfg.events as string[]).join(', ') : '';
    return (
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-sm divide-y divide-border/50">
        <ConfigRow label="Events" value={events || '—'} />
        <ConfigRow label="Secret" value={codeVal(`${String(cfg.secret || '').slice(0, 8)}…`)} />
      </div>
    );
  }

  if (trigger.type === 'watcher') {
    const events = Array.isArray(cfg.events) ? (cfg.events as string[]).join(', ') : '';
    const paths: string[] = Array.isArray(cfg.paths)
      ? (cfg.paths as string[])
      : typeof cfg.path === 'string' && cfg.path
        ? [cfg.path as string]
        : [];
    const rawFilter = cfg.fileFilter as { mode?: string; patterns?: string[] } | undefined;
    const hasFilter =
      rawFilter && Array.isArray(rawFilter.patterns) && rawFilter.patterns.length > 0;
    return (
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-sm divide-y divide-border/50">
        <ConfigRow
          label={paths.length > 1 ? 'Paths' : 'Path'}
          value={
            paths.length > 0 ? (
              <div className="flex flex-wrap gap-1 justify-end">
                {paths.map((p) => (
                  <code
                    key={p}
                    className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[12px] text-foreground"
                  >
                    {resolveHostPath(p)}
                  </code>
                ))}
              </div>
            ) : (
              '—'
            )
          }
        />
        <ConfigRow label="Events" value={events || '—'} />
        {hasFilter && (
          <ConfigRow
            label="File filter"
            value={
              <span className={rawFilter!.mode === 'exclude' ? 'text-destructive' : 'text-success'}>
                {rawFilter!.mode === 'exclude' ? 'Exclude' : 'Include'}:{' '}
                {rawFilter!.patterns!.join(', ')}
              </span>
            }
          />
        )}
        <ConfigRow label="Endpoint" value={codeVal(`/hooks/watcher/${trigger.id}`)} />
        <ConfigRow label="Secret" value={codeVal(`${String(cfg.secret || '').slice(0, 8)}…`)} />
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

  const [showTriggerForm, setShowTriggerForm] = useState(false);
  const [triggerType, setTriggerType] = useState<'cron' | 'api' | 'github' | 'watcher'>('cron');
  const [cronExpression, setCronExpression] = useState('0 9 * * *');
  const [ghEvents, setGhEvents] = useState('');
  const [watcherEvents, setWatcherEvents] = useState<string[]>(['add', 'change', 'addDir']);
  const [watcherPaths, setWatcherPaths] = useState<string[]>([]);
  const [watcherFileFilter, setWatcherFileFilter] = useState<FileFilterValue>({
    mode: 'include',
    patterns: [],
  });
  const [showFolderPicker, setShowFolderPicker] = useState(false);

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
    if (!id || !confirm('Delete this routine and all its runs?')) return;
    try {
      await api.deleteRoutine(id);
      navigate('/routines');
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    }
  };

  const handleDeleteTrigger = async (triggerId: string) => {
    if (!confirm('Delete this trigger?')) return;
    try {
      await api.deleteTrigger(triggerId);
      load();
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    }
  };

  const handleSaveTrigger = async () => {
    if (!id || !routine) return;
    let config: Record<string, unknown> = {};
    if (triggerType === 'cron') {
      if (!cronExpression) return alert('Enter a cron expression');
      config = { expression: cronExpression };
    } else if (triggerType === 'github') {
      if (!ghEvents) return alert('Enter events');
      config = {
        events: ghEvents
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean),
      };
    } else if (triggerType === 'watcher') {
      const paths =
        watcherPaths.length > 0
          ? watcherPaths
          : routine.workspace_path
            ? [routine.workspace_path]
            : [];
      if (paths.length === 0) return alert('No workspace folder linked to this routine.');
      config = { paths, events: watcherEvents } as Record<string, unknown>;
      if (watcherFileFilter.patterns.length > 0) {
        (config as Record<string, unknown>).fileFilter = watcherFileFilter;
      }
    }
    try {
      await api.createTrigger(id, { type: triggerType, config });
      setShowTriggerForm(false);
      setCronExpression('0 9 * * *');
      setGhEvents('');
      setWatcherEvents(['add', 'change', 'addDir']);
      setWatcherPaths([]);
      setWatcherFileFilter({ mode: 'include', patterns: [] });
      load();
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Error: {error}</p>;
  if (!routine) return <p className="text-sm text-destructive">Routine not found</p>;

  return (
    <div className="space-y-8">
      {/* Workspace inaccessible warning */}
      {routine.workspace_path && !routine.workspace_accessible && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive-soft px-4 py-3">
          <span className="mt-0.5 shrink-0 text-destructive text-sm font-bold">!</span>
          <div>
            <p className="text-[13px] font-medium text-foreground">
              Workspace folder is no longer accessible
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <code className="rounded bg-white/60 px-1 py-0.5 font-mono text-[11px]">
                {routine.workspace_path}
              </code>{' '}
              cannot be reached. Runs will fail until the folder is restored or a new workspace is
              selected.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <Link to="/routines" className="text-xs text-accent hover:underline">
          ← Routines
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
              {routine.name}
            </h1>
            <RoutineStatusBadge
              enabled={routine.enabled}
              inaccessible={!!(routine.workspace_path && !routine.workspace_accessible)}
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={handleRun}
              className="btn btn-primary"
              disabled={routine.workspace_path !== '' && !routine.workspace_accessible}
              title={
                routine.workspace_path && !routine.workspace_accessible
                  ? 'Workspace folder is inaccessible'
                  : undefined
              }
            >
              Run now
            </button>
            {!(routine.workspace_path && !routine.workspace_accessible) && (
              <button onClick={handleToggle} disabled={toggling} className="btn btn-secondary">
                {toggling ? '…' : routine.enabled ? 'Disable' : 'Enable'}
              </button>
            )}
            <Link to={`/routines/${id}/edit`} className="btn btn-secondary">
              Edit
            </Link>
            <button onClick={handleDelete} className="btn btn-danger">
              Delete
            </button>
          </div>
        </div>
        {routine.description && (
          <p className="mt-2 text-[13px] text-muted-foreground">{routine.description}</p>
        )}
      </div>

      {/* Config + Prompt */}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Configuration
          </h2>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-md shadow-sm divide-y divide-border/50">
            <ConfigRow label="Model" value={routine.model || '—'} />
            <ConfigRow label="Agent" value={routine.agent} />
            <ConfigRow
              label="Run mode"
              value={routine.run_mode === 'foreground' ? 'Foreground only' : 'Background'}
            />
            {routine.workspace_path && (
              <ConfigRow
                label="Workspace"
                value={
                  <span className="flex items-center gap-1.5">
                    <code
                      className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[12px] text-foreground truncate max-w-[200px]"
                      title={routine.workspace_path}
                    >
                      {resolveHostName(routine.workspace_path)}
                    </code>
                    {!routine.workspace_accessible && (
                      <span className="text-[10px] text-destructive">inaccessible</span>
                    )}
                  </span>
                }
              />
            )}
            {routine.repository && <ConfigRow label="Repository" value={routine.repository} />}
            {routine.repository && <ConfigRow label="Branch" value={routine.branch} />}
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Prompt
          </h2>
          <pre className="h-full max-h-52 overflow-auto rounded-xl border border-border/70 bg-surface/80 backdrop-blur-md px-4 py-3 font-mono text-[12px] leading-5 text-foreground whitespace-pre-wrap shadow-sm">
            {routine.prompt}
          </pre>
        </div>
      </div>

      {/* Triggers */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-semibold text-foreground">Triggers</h2>
          <button onClick={() => setShowTriggerForm((v) => !v)} className="btn btn-secondary">
            {showTriggerForm ? 'Cancel' : 'Add trigger'}
          </button>
        </div>

        {showTriggerForm && (
          <div className="mb-4 overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-md p-4 space-y-3 shadow-sm">
            <div className="flex gap-3 text-[13px]">
              {(['cron', 'api', 'github', 'watcher'] as const).map((t) => {
                const disabled = t === 'watcher' && !routine.workspace_path;
                return (
                  <label
                    key={t}
                    className={`flex items-center gap-1.5 ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                  >
                    <input
                      type="radio"
                      name="ttype"
                      value={t}
                      checked={triggerType === t}
                      disabled={disabled}
                      onChange={() => setTriggerType(t)}
                    />
                    {t === 'watcher' ? 'Filesystem' : t.charAt(0).toUpperCase() + t.slice(1)}
                  </label>
                );
              })}
            </div>
            {triggerType === 'cron' && (
              <CronPicker value={cronExpression} onChange={setCronExpression} />
            )}
            {triggerType === 'api' && (
              <p className="text-[13px] text-muted-foreground">A token will be auto-generated.</p>
            )}
            {triggerType === 'github' && (
              <input
                className="input-field max-w-sm"
                placeholder="push, pull_request.opened"
                value={ghEvents}
                onChange={(e) => setGhEvents(e.target.value)}
              />
            )}
            {triggerType === 'watcher' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    Watched paths
                  </label>
                  {(watcherPaths.length > 0
                    ? watcherPaths
                    : routine.workspace_path
                      ? [routine.workspace_path]
                      : []
                  ).map((p) => (
                    <span
                      key={p}
                      className="mr-1.5 mb-1 inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                    >
                      {resolveHostPath(p).split('/').pop() || resolveHostPath(p)}
                      {watcherPaths.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setWatcherPaths(watcherPaths.filter((x) => x !== p))}
                          className="ml-0.5 text-destructive hover:opacity-70"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowFolderPicker(true)}
                    className="btn btn-secondary mt-1 text-xs"
                  >
                    Add path
                  </button>
                </div>
                <div className="flex flex-wrap gap-3 text-[13px]">
                  {[
                    { value: 'add', label: 'File created' },
                    { value: 'change', label: 'File changed' },
                    { value: 'addDir', label: 'Folder created' },
                    { value: 'unlink', label: 'File deleted' },
                    { value: 'unlinkDir', label: 'Folder deleted' },
                  ].map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={watcherEvents.includes(value)}
                        onChange={(e) =>
                          setWatcherEvents(
                            e.target.checked
                              ? [...watcherEvents, value]
                              : watcherEvents.filter((ev) => ev !== value)
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div>
                  <label className="mb-1.5 block text-xs text-muted-foreground">
                    File type filter
                  </label>
                  <FileTypeFilter value={watcherFileFilter} onChange={setWatcherFileFilter} />
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={handleSaveTrigger} className="btn btn-primary">
                Save
              </button>
              <button onClick={() => setShowTriggerForm(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {triggers.length ? (
          <div className="space-y-3">
            {triggers.map((t) => (
              <div key={t.id}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-medium capitalize text-foreground">{t.type}</span>
                    {!t.enabled && (
                      <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">
                        disabled
                      </span>
                    )}
                  </div>
                  <button onClick={() => handleDeleteTrigger(t.id)} className="btn btn-danger">
                    Remove
                  </button>
                </div>
                <TriggerConfig trigger={t} />
              </div>
            ))}
          </div>
        ) : (
          !showTriggerForm && (
            <p className="text-[13px] text-muted-foreground">No triggers configured.</p>
          )
        )}
      </div>

      {/* Run History */}
      <div>
        <h2 className="mb-3 text-[14px] font-semibold text-foreground">Run history</h2>
        <RunsTable runs={runs} />
      </div>

      {showFolderPicker && (
        <FolderPicker
          value=""
          onChange={(p) => {
            if (!watcherPaths.includes(p)) setWatcherPaths([...watcherPaths, p]);
            setShowFolderPicker(false);
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  );
}

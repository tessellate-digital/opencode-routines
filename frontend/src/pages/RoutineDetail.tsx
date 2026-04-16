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

function StatusBadge({ enabled, inaccessible }: { enabled: boolean; inaccessible?: boolean }) {
  if (inaccessible) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-[#fff3cd] text-[#856404]">
        <span className="size-1.5 rounded-full bg-[#856404]" />
        Workspace inaccessible
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        enabled ? 'bg-[#d1f5d3] text-[#1a7f37]' : 'bg-[#f5f5f7] text-[#6e6e73]'
      }`}
    >
      <span className={`size-1.5 rounded-full ${enabled ? 'bg-[#1a7f37]' : 'bg-[#aeaeb2]'}`} />
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function ConfigRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 text-sm">
      <span className="text-[#6e6e73]">{label}</span>
      <span className="text-[#1d1d1f]">{value}</span>
    </div>
  );
}

function TriggerConfig({ trigger }: { trigger: Trigger }) {
  const { resolveHostPath } = useHostMounts();
  const cfg = trigger.config;

  if (trigger.type === 'cron') {
    return (
      <div className="rounded-lg border border-[#d1d1d6] divide-y divide-[#f0f0f0]">
        <ConfigRow
          label="Schedule"
          value={
            <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]">
              {String(cfg.expression || '')}
            </code>
          }
        />
      </div>
    );
  }

  if (trigger.type === 'api') {
    return (
      <div className="rounded-lg border border-[#d1d1d6] divide-y divide-[#f0f0f0]">
        <ConfigRow
          label="Endpoint"
          value={
            <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]">
              /hooks/api/{trigger.id}
            </code>
          }
        />
        <ConfigRow
          label="Token"
          value={
            <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]">
              {String(cfg.token || '').slice(0, 8)}…
            </code>
          }
        />
      </div>
    );
  }

  if (trigger.type === 'github') {
    const events = Array.isArray(cfg.events) ? (cfg.events as string[]).join(', ') : '';
    return (
      <div className="rounded-lg border border-[#d1d1d6] divide-y divide-[#f0f0f0]">
        <ConfigRow label="Events" value={events || '—'} />
        <ConfigRow
          label="Secret"
          value={
            <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]">
              {String(cfg.secret || '').slice(0, 8)}…
            </code>
          }
        />
      </div>
    );
  }

  if (trigger.type === 'watcher') {
    const events = Array.isArray(cfg.events) ? (cfg.events as string[]).join(', ') : '';
    // Support both legacy config.path and new config.paths
    const paths: string[] = Array.isArray(cfg.paths)
      ? (cfg.paths as string[])
      : typeof cfg.path === 'string' && cfg.path
        ? [cfg.path as string]
        : [];
    const rawFilter = cfg.fileFilter as { mode?: string; patterns?: string[] } | undefined;
    const hasFilter =
      rawFilter && Array.isArray(rawFilter.patterns) && rawFilter.patterns.length > 0;
    return (
      <div className="rounded-lg border border-[#d1d1d6] divide-y divide-[#f0f0f0]">
        <ConfigRow
          label={paths.length > 1 ? 'Paths' : 'Path'}
          value={
            paths.length > 0 ? (
              <div className="flex flex-wrap gap-1 justify-end">
                {paths.map((p) => (
                  <code
                    key={p}
                    className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]"
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
              <span className={rawFilter!.mode === 'exclude' ? 'text-[#ff3b30]' : 'text-[#1a7f37]'}>
                {rawFilter!.mode === 'exclude' ? 'Exclude' : 'Include'}:{' '}
                {rawFilter!.patterns!.join(', ')}
              </span>
            }
          />
        )}
        <ConfigRow
          label="Endpoint"
          value={
            <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]">
              /hooks/watcher/{trigger.id}
            </code>
          }
        />
        <ConfigRow
          label="Secret"
          value={
            <code className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f]">
              {String(cfg.secret || '').slice(0, 8)}…
            </code>
          }
        />
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

  if (loading) return <p className="text-sm text-[#6e6e73]">Loading…</p>;
  if (error) return <p className="text-sm text-[#ff3b30]">Error: {error}</p>;
  if (!routine) return <p className="text-sm text-[#ff3b30]">Routine not found</p>;

  return (
    <div className="space-y-8">
      {/* Workspace inaccessible warning */}
      {routine.workspace_path && !routine.workspace_accessible && (
        <div className="rounded-lg border border-[#ffc9c9] bg-[#fff5f5] px-4 py-3 flex items-start gap-3">
          <span className="shrink-0 mt-0.5 text-[#ff3b30] text-sm">!</span>
          <div>
            <p className="text-sm font-medium text-[#1d1d1f]">
              Workspace folder is no longer accessible
            </p>
            <p className="mt-0.5 text-xs text-[#6e6e73]">
              <code className="rounded bg-white/60 px-1 py-0.5 text-[11px]">
                {routine.workspace_path}
              </code>{' '}
              cannot be reached. The bind-mount may have been removed. Runs will fail until the
              folder is restored or a new workspace is selected.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div>
        <Link to="/routines" className="text-xs text-[#0071e3] hover:underline">
          ← Routines
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-[#1d1d1f]">{routine.name}</h1>
            <StatusBadge
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
          <p className="mt-2 text-sm text-[#6e6e73]">{routine.description}</p>
        )}
      </div>

      {/* Config + Prompt */}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-2 text-xs font-medium text-[#6e6e73]">Configuration</h2>
          <div className="rounded-lg border border-[#d1d1d6] divide-y divide-[#f0f0f0]">
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
                      className="rounded bg-[#f5f5f7] px-1.5 py-0.5 text-xs text-[#1d1d1f] truncate max-w-[200px]"
                      title={routine.workspace_path}
                    >
                      {resolveHostName(routine.workspace_path)}
                    </code>
                    {!routine.workspace_accessible && (
                      <span className="text-[10px] text-[#ff3b30]">inaccessible</span>
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
          <h2 className="mb-2 text-xs font-medium text-[#6e6e73]">Prompt</h2>
          <pre className="h-full max-h-52 overflow-auto rounded-lg border border-[#d1d1d6] bg-[#f5f5f7] px-4 py-3 text-xs leading-5 text-[#1d1d1f] whitespace-pre-wrap">
            {routine.prompt}
          </pre>
        </div>
      </div>

      {/* Triggers */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">Triggers</h2>
          <button onClick={() => setShowTriggerForm((v) => !v)} className="btn btn-secondary">
            {showTriggerForm ? 'Cancel' : 'Add trigger'}
          </button>
        </div>

        {showTriggerForm && (
          <div className="mb-4 rounded-lg border border-[#d1d1d6] p-4 space-y-3">
            <div className="flex gap-3 text-sm">
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
              <p className="text-sm text-[#6e6e73]">A token will be auto-generated.</p>
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
                {/* Watched paths */}
                <div>
                  <label className="mb-1.5 block text-xs text-[#6e6e73]">Watched paths</label>
                  {(watcherPaths.length > 0
                    ? watcherPaths
                    : routine.workspace_path
                      ? [routine.workspace_path]
                      : []
                  ).map((p) => (
                    <span
                      key={p}
                      className="inline-flex items-center gap-1 mr-1.5 mb-1 rounded-full bg-[#f5f5f7] border border-[#d1d1d6] px-2 py-0.5 text-xs font-mono text-[#1d1d1f]"
                    >
                      {resolveHostPath(p).split('/').pop() || resolveHostPath(p)}
                      {watcherPaths.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setWatcherPaths(watcherPaths.filter((x) => x !== p))}
                          className="ml-0.5 text-[#ff3b30] hover:opacity-70"
                        >
                          &times;
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setShowFolderPicker(true)}
                    className="btn btn-secondary text-xs mt-1"
                  >
                    Add path
                  </button>
                </div>

                {/* Events */}
                <div className="flex flex-wrap gap-3 text-sm">
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

                {/* File type filter */}
                <div>
                  <label className="mb-1.5 block text-xs text-[#6e6e73]">File type filter</label>
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
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium capitalize text-[#1d1d1f]">{t.type}</span>
                    {!t.enabled && (
                      <span className="rounded-full bg-[#fff3cd] px-2 py-0.5 text-xs text-[#856404]">
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
          !showTriggerForm && <p className="text-sm text-[#6e6e73]">No triggers configured.</p>
        )}
      </div>

      {/* Run History */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-[#1d1d1f]">Run history</h2>
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

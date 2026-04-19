import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Trigger } from '../lib/types';
import { CronPicker } from '../components/CronPicker';
import { FolderPicker } from '../components/FolderPicker';
import { FileTypeFilter, type FileFilterValue } from '../components/FileTypeFilter';
import { useHostMounts } from '../contexts/HostMountsContext';

const FS_EVENTS = [
  { value: 'add', label: 'File created' },
  { value: 'change', label: 'File changed' },
  { value: 'addDir', label: 'Folder created' },
  { value: 'unlink', label: 'File deleted' },
  { value: 'unlinkDir', label: 'Folder deleted' },
];

type TriggerType = 'cron' | 'watcher';

interface CronDraft {
  type: 'cron';
  expression: string;
}
interface WatcherDraft {
  type: 'watcher';
  paths: string[];
  events: string[];
  fileFilter: FileFilterValue;
}
type TriggerDraft = CronDraft | WatcherDraft;

function defaultDraft(type: TriggerType, workspacePath: string): TriggerDraft {
  if (type === 'cron') return { type: 'cron', expression: '0 9 * * *' };
  return {
    type: 'watcher',
    paths: workspacePath ? [workspacePath] : [],
    events: ['add', 'change', 'addDir'],
    fileFilter: { mode: 'none', patterns: [] },
  };
}

function triggerSummary(d: TriggerDraft, resolve: (p: string) => string): string {
  if (d.type === 'cron') return d.expression;
  const paths = d.paths.map((p) => resolve(p).split('/').pop() || p).join(', ');
  return paths || 'No paths';
}

function triggerToDraft(t: Trigger, routine: { workspace_path: string }): TriggerDraft {
  if (t.type === 'cron') {
    return { type: 'cron', expression: String(t.config.expression || '0 9 * * *') };
  }
  const paths: string[] = Array.isArray(t.config.paths)
    ? (t.config.paths as string[])
    : typeof t.config.path === 'string' && t.config.path
      ? [t.config.path as string]
      : routine.workspace_path
        ? [routine.workspace_path]
        : [];
  const rawFilter = t.config.fileFilter as { mode?: string; patterns?: string[] } | undefined;
  const fileFilter: FileFilterValue =
    rawFilter && Array.isArray(rawFilter.patterns)
      ? {
          mode:
            rawFilter.mode === 'exclude'
              ? 'exclude'
              : rawFilter.mode === 'none'
                ? 'none'
                : 'include',
          patterns: rawFilter.patterns,
        }
      : { mode: 'none', patterns: [] };
  return {
    type: 'watcher',
    paths,
    events: Array.isArray(t.config.events)
      ? (t.config.events as string[])
      : ['add', 'change', 'addDir'],
    fileFilter,
  };
}

interface ModelSelectProps {
  value: string;
  onChange: (v: string) => void;
  favouriteModels: string[];
  allModels: string[];
}

function ModelSelect({ value, onChange, favouriteModels, allModels }: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const favouriteSet = new Set(favouriteModels);
  const q = query.toLowerCase();
  const filteredFavourites = favouriteModels.filter((m) => !q || m.toLowerCase().includes(q));
  const filteredOthers = allModels.filter(
    (m) => !favouriteSet.has(m) && (!q || m.toLowerCase().includes(q))
  );

  const groupedOthers: Record<string, string[]> = {};
  for (const m of filteredOthers) {
    const [provider] = m.split('/', 1);
    if (!groupedOthers[provider]) groupedOthers[provider] = [];
    groupedOthers[provider].push(m);
  }

  const handleSelect = (m: string) => {
    onChange(m);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="select-field flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="truncate text-[13px]">
          {value || <span className="text-muted-foreground">Select a model…</span>}
        </span>
        <svg
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.937a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.061z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-border/70 bg-surface/95 shadow-lg backdrop-blur-md">
          <div className="border-b border-border/70 p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter models…"
              className="input-field text-[13px] py-1.5"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredFavourites.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Favourites
                </div>
                {filteredFavourites.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelect(m)}
                    className={`w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-accent/10 ${m === value ? 'font-medium text-accent' : 'text-foreground'}`}
                  >
                    {m}
                  </button>
                ))}
                {filteredOthers.length > 0 && <div className="my-1 border-t border-border/70" />}
              </>
            )}
            {Object.entries(groupedOthers)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([provider, list]) => (
                <div key={provider}>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {provider}
                  </div>
                  {list.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSelect(m)}
                      className={`w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-accent/10 ${m === value ? 'font-medium text-accent' : 'text-foreground'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ))}
            {filteredFavourites.length === 0 && filteredOthers.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-muted-foreground">
                No models match "{query}"
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TriggerCard({
  draft,
  index,
  onChange,
  onRemove,
  workspacePath,
  hasMounts,
  resolveHostPath,
  onPickFolder,
  collapsed,
  onToggleCollapse,
}: {
  draft: TriggerDraft;
  index: number;
  onChange: (d: TriggerDraft) => void;
  onRemove: () => void;
  workspacePath: string;
  hasMounts: boolean | null;
  resolveHostPath: (p: string) => string;
  onPickFolder: (index: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const typeLabel = draft.type === 'cron' ? 'Cron' : 'Filesystem';
  const summary = triggerSummary(draft, resolveHostPath);

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between bg-muted/50 px-3 py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-2 text-[13px] font-medium text-foreground hover:text-accent"
        >
          <span className={`text-[10px] transition-transform ${collapsed ? '' : 'rotate-90'}`}>
            ›
          </span>
          <span>{typeLabel}</span>
          {collapsed && (
            <span className="max-w-sm truncate text-xs font-normal text-muted-foreground">
              {summary}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-destructive hover:underline"
        >
          Remove
        </button>
      </div>
      {!collapsed && (
        <div className="px-3 py-3 space-y-3">
          {draft.type === 'cron' && (
            <CronPicker
              value={draft.expression}
              onChange={(v) => onChange({ ...draft, expression: v })}
            />
          )}
          {draft.type === 'watcher' && (
            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">Watched paths</label>
                {draft.paths.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {draft.paths.map((p) => (
                      <span
                        key={p}
                        className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                      >
                        {resolveHostPath(p).split('/').pop() || resolveHostPath(p)}
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ ...draft, paths: draft.paths.filter((x) => x !== p) })
                          }
                          className="ml-0.5 text-destructive hover:opacity-70"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {hasMounts !== false && (
                  <button
                    type="button"
                    onClick={() => onPickFolder(index)}
                    className="btn btn-secondary text-xs"
                  >
                    Add path
                  </button>
                )}
                {draft.paths.length === 0 && !workspacePath && (
                  <p className="text-xs text-muted-foreground">
                    No workspace folder selected. Select one above first.
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">Events</label>
                <div className="flex flex-wrap gap-3 text-[13px]">
                  {FS_EVENTS.map(({ value, label }) => (
                    <label key={value} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={draft.events.includes(value)}
                        onChange={(e) =>
                          onChange({
                            ...draft,
                            events: e.target.checked
                              ? [...draft.events, value]
                              : draft.events.filter((ev) => ev !== value),
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-muted-foreground">
                  File type filter
                </label>
                <FileTypeFilter
                  value={draft.fileFilter}
                  onChange={(v) => onChange({ ...draft, fileFilter: v })}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RoutineForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;
  const { resolveHostPath } = useHostMounts();

  const [form, setForm] = useState({
    name: '',
    description: '',
    prompt: '',
    model: 'opencode/minimax-m2.5-free',
    repository: '',
    branch: 'main',
    agent: 'build',
    env_vars: '{}',
    enabled: true,
    run_mode: 'foreground' as 'background' | 'foreground',
    workspace_path: '',
  });
  const [triggerDrafts, setTriggerDrafts] = useState<TriggerDraft[]>([]);
  const [collapsedTriggers, setCollapsedTriggers] = useState<Set<number>>(new Set());
  const [existingTriggers, setExistingTriggers] = useState<Trigger[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [folderPickerTarget, setFolderPickerTarget] = useState<number | null>(null);
  const [hasMounts, setHasMounts] = useState<boolean | null>(null);
  const [addingTriggerType, setAddingTriggerType] = useState<TriggerType | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [modelsRes, settingsRes, routine, triggers, mountsRes] = await Promise.all([
          api.getModels(),
          api.getSettings(),
          isEdit ? api.getRoutine(id!) : Promise.resolve(null),
          isEdit ? api.getTriggers(id!) : Promise.resolve([] as Trigger[]),
          api.getMounts(),
        ]);
        setModels(modelsRes.models || []);
        setHasMounts((mountsRes.mounts?.length ?? 0) > 0);
        const favSetting = settingsRes.find(
          (s: { key: string; value: string }) => s.key === 'FAVOURITE_MODELS'
        );
        if (favSetting && favSetting.value !== '***') {
          try {
            setFavourites(JSON.parse(favSetting.value));
          } catch {
            /* ignore */
          }
        }
        if (routine) {
          setForm({
            name: routine.name,
            description: routine.description,
            prompt: routine.prompt,
            model: routine.model,
            repository: routine.repository,
            branch: routine.branch,
            agent: routine.agent,
            env_vars: JSON.stringify(routine.env_vars, null, 2),
            enabled: routine.enabled,
            run_mode: routine.run_mode,
            workspace_path: routine.workspace_path ?? '',
          });
        }
        if (triggers && triggers.length > 0) {
          setExistingTriggers(triggers);
          const drafts = triggers.map((t) =>
            triggerToDraft(t, { workspace_path: routine?.workspace_path || '' })
          );
          setTriggerDrafts(drafts);
          if (drafts.length >= 3) setCollapsedTriggers(new Set(drafts.map((_, i) => i)));
        }
      } catch {
        /* non-critical */
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [id, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    let envVars: Record<string, string>;
    try {
      envVars = JSON.parse(form.env_vars || '{}');
    } catch {
      alert('Invalid JSON in env vars');
      setSubmitting(false);
      return;
    }
    const data = {
      name: form.name,
      description: form.description,
      prompt: form.prompt,
      model: form.model,
      repository: '',
      branch: 'main',
      agent: form.agent,
      env_vars: envVars,
      enabled: form.enabled,
      run_mode: form.run_mode,
      workspace_path: form.workspace_path,
    };
    try {
      const res = isEdit ? await api.updateRoutine(id!, data) : await api.createRoutine(data);
      const routineId = res.id;
      if (isEdit) await Promise.all(existingTriggers.map((t) => api.deleteTrigger(t.id)));
      for (const draft of triggerDrafts) {
        if (draft.type === 'cron' && draft.expression) {
          await api.createTrigger(routineId, {
            type: 'cron',
            config: { expression: draft.expression },
          });
        } else if (draft.type === 'watcher' && draft.paths.length > 0) {
          const config: Record<string, unknown> = { paths: draft.paths, events: draft.events };
          if (draft.fileFilter.mode !== 'none' && draft.fileFilter.patterns.length > 0)
            config.fileFilter = draft.fileFilter;
          await api.createTrigger(routineId, { type: 'watcher', config });
        }
      }
      navigate(`/routines/${routineId}`);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setSubmitting(false);
    }
  };

  const addTrigger = (type: TriggerType) => {
    const draft = defaultDraft(type, form.workspace_path);
    setTriggerDrafts((prev) => [...prev, draft]);
    setAddingTriggerType(null);
    setCollapsedTriggers((prev) => {
      if (triggerDrafts.length + 1 >= 3) return new Set(triggerDrafts.map((_, i) => i));
      return prev;
    });
  };

  const updateDraft = (index: number, draft: TriggerDraft) =>
    setTriggerDrafts((prev) => prev.map((d, i) => (i === index ? draft : d)));
  const removeDraft = (index: number) => {
    setTriggerDrafts((prev) => prev.filter((_, i) => i !== index));
    setCollapsedTriggers((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  };
  const toggleCollapse = (index: number) => {
    setCollapsedTriggers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const openFolderPickerForTrigger = (index: number) => {
    setFolderPickerTarget(index);
    setShowFolderPicker(true);
  };
  const handleFolderPicked = (path: string) => {
    if (folderPickerTarget !== null) {
      const draft = triggerDrafts[folderPickerTarget];
      if (draft?.type === 'watcher' && !draft.paths.includes(path))
        updateDraft(folderPickerTarget, { ...draft, paths: [...draft.paths, path] });
    } else {
      setForm((f) => ({ ...f, workspace_path: path }));
    }
    setShowFolderPicker(false);
    setFolderPickerTarget(null);
  };

  const favouriteModels = favourites.filter((m) => models.includes(m));

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/routines" className="text-xs text-accent hover:underline">
          ← Routines
        </Link>
        <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-foreground">
          {isEdit ? 'Edit' : 'New'} Routine
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input-field"
            required
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            Description
          </label>
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="input-field"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            Prompt
          </label>
          <textarea
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            rows={6}
            className="textarea-field font-mono"
            required
          />
        </div>

        {/* Workspace folder */}
        <div>
          <label
            className={`mb-1.5 block text-[12px] font-medium ${hasMounts === false ? 'text-muted-foreground' : 'text-muted-foreground'}`}
          >
            Workspace folder
          </label>
          {hasMounts === false ? (
            <p className="text-xs text-muted-foreground">
              No folders mounted. Add a volume to{' '}
              <span className="font-mono">docker-compose.yml</span> to enable this:{' '}
              <span className="font-mono">- /your/path:/workspaces/my-project</span>
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Select a folder mounted into the container under{' '}
                <span className="font-mono">/workspaces</span>.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFolderPickerTarget(null);
                    setShowFolderPicker(true);
                  }}
                  disabled={hasMounts === null}
                  className="btn btn-secondary flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span>📁</span>
                  {form.workspace_path ? 'Change folder' : 'Select folder'}
                </button>
                {form.workspace_path && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, workspace_path: '' }))}
                    className="text-xs text-destructive hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              {form.workspace_path && (
                <p
                  className="mt-1.5 truncate font-mono text-xs text-foreground"
                  title={resolveHostPath(form.workspace_path)}
                >
                  {resolveHostPath(form.workspace_path)}
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
              Model
            </label>
            <ModelSelect
              value={form.model}
              onChange={(v) => setForm((f) => ({ ...f, model: v }))}
              favouriteModels={favouriteModels}
              allModels={models}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
              Agent
            </label>
            <input
              value={form.agent}
              onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
              className="input-field"
            />
          </div>
        </div>

        {/* Triggers */}
        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            Trigger
          </label>
          <div className="flex gap-4 text-[13px]">
            {(['none', 'cron', 'watcher'] as const).map((t) => {
              const disabled = t === 'watcher' && !form.workspace_path;
              const checked =
                t === 'none'
                  ? triggerDrafts.length === 0
                  : triggerDrafts.length > 0 && triggerDrafts[0].type === t;
              return (
                <label
                  key={t}
                  className={`flex items-center gap-1.5 ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
                >
                  <input
                    type="radio"
                    name="trigger_type"
                    value={t}
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      if (t === 'none') {
                        setTriggerDrafts([]);
                      } else if (triggerDrafts.length === 0) {
                        setTriggerDrafts([defaultDraft(t, form.workspace_path)]);
                      } else {
                        setTriggerDrafts([
                          defaultDraft(t, form.workspace_path),
                          ...triggerDrafts.slice(1),
                        ]);
                      }
                    }}
                  />
                  {t === 'none' ? 'None' : t === 'cron' ? 'Cron' : 'Filesystem'}
                </label>
              );
            })}
          </div>
          {!form.workspace_path && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Select a workspace folder above to enable filesystem triggers.
            </p>
          )}

          {triggerDrafts.length > 0 && (
            <div className="mt-3">
              <TriggerCard
                draft={triggerDrafts[0]}
                index={0}
                onChange={(d) => updateDraft(0, d)}
                onRemove={() => removeDraft(0)}
                workspacePath={form.workspace_path}
                hasMounts={hasMounts}
                resolveHostPath={resolveHostPath}
                onPickFolder={openFolderPickerForTrigger}
                collapsed={false}
                onToggleCollapse={() => {}}
              />
            </div>
          )}

          {triggerDrafts.length > 1 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Additional triggers</p>
              {triggerDrafts.slice(1).map((draft, i) => {
                const realIndex = i + 1;
                return (
                  <TriggerCard
                    key={realIndex}
                    draft={draft}
                    index={realIndex}
                    onChange={(d) => updateDraft(realIndex, d)}
                    onRemove={() => removeDraft(realIndex)}
                    workspacePath={form.workspace_path}
                    hasMounts={hasMounts}
                    resolveHostPath={resolveHostPath}
                    onPickFolder={openFolderPickerForTrigger}
                    collapsed={collapsedTriggers.has(realIndex)}
                    onToggleCollapse={() => toggleCollapse(realIndex)}
                  />
                );
              })}
            </div>
          )}

          {triggerDrafts.length > 0 && (
            <div className="mt-2">
              {addingTriggerType === null ? (
                <button
                  type="button"
                  onClick={() => setAddingTriggerType('cron')}
                  className="text-xs text-accent hover:underline"
                >
                  + Add another trigger
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    value={addingTriggerType}
                    onChange={(e) => setAddingTriggerType(e.target.value as TriggerType)}
                    className="select-field max-w-[160px]"
                  >
                    <option value="cron">Cron</option>
                    <option value="watcher" disabled={!form.workspace_path}>
                      Filesystem
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => addTrigger(addingTriggerType)}
                    className="btn btn-primary text-xs"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddingTriggerType(null)}
                    className="btn btn-secondary text-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            Environment variables <span className="font-normal opacity-70">(JSON)</span>
          </label>
          <textarea
            value={form.env_vars}
            onChange={(e) => setForm((f) => ({ ...f, env_vars: e.target.value }))}
            rows={3}
            className="textarea-field font-mono"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          <span className="text-foreground">Enabled</span>
        </label>

        <div>
          <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
            Run mode
          </label>
          <div className="flex flex-col gap-2 text-[13px]">
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="run_mode"
                value="background"
                className="mt-0.5"
                checked={form.run_mode === 'background'}
                onChange={() => setForm((f) => ({ ...f, run_mode: 'background' }))}
              />
              <span>
                <span className="font-medium text-foreground">Background</span>
                <span className="ml-1.5 text-muted-foreground">
                  — runs on schedule even when the app is closed
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="run_mode"
                value="foreground"
                className="mt-0.5"
                checked={form.run_mode === 'foreground'}
                onChange={() => setForm((f) => ({ ...f, run_mode: 'foreground' }))}
              />
              <span>
                <span className="font-medium text-foreground">Foreground</span>
                <span className="ml-1.5 text-muted-foreground">
                  — only runs while the app is open in a browser
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? 'Saving…' : 'Save routine'}
          </button>
          <Link to={isEdit ? `/routines/${id}` : '/routines'} className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </form>

      {showFolderPicker && (
        <FolderPicker
          value={form.workspace_path}
          onChange={handleFolderPicked}
          onClose={() => {
            setShowFolderPicker(false);
            setFolderPickerTarget(null);
          }}
        />
      )}
    </div>
  );
}

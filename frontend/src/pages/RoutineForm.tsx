import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import classNames from 'classnames';
import { api } from '../lib/api';
import type { Trigger } from '../lib/types';
import { CronPicker } from '../components/CronPicker';
import { FolderPicker } from '../components/FolderPicker';
import { FileTypeFilter, type FileFilterValue } from '../components/FileTypeFilter';
import { SelectDropdown, type SelectOption } from '../components/SelectDropdown';
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
  recursive: boolean;
}
type TriggerDraft = CronDraft | WatcherDraft;

function defaultDraft(type: TriggerType, workspacePath: string): TriggerDraft {
  if (type === 'cron') return { type: 'cron', expression: '0 9 * * *' };
  return {
    type: 'watcher',
    paths: workspacePath ? [workspacePath] : [],
    events: ['add', 'change', 'addDir'],
    fileFilter: { mode: 'none', patterns: [] },
    recursive: true,
  };
}

function triggerSummary(d: TriggerDraft, resolve: (p: string) => string): string {
  if (d.type === 'cron') return d.expression;
  const paths = d.paths.map((p) => resolve(p).split('/').pop() || p).join(', ');
  return paths || 'No paths';
}

function triggerToDraft(t: Trigger, routine: { workspace_path: string }): TriggerDraft {
  if (t.type === 'cron')
    return { type: 'cron', expression: String(t.config.expression || '0 9 * * *') };
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
    recursive: t.config.recursive !== false,
  };
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
    <div className={classNames('trig-card', { open: !collapsed })}>
      <div className="trig-head" onClick={onToggleCollapse}>
        <span className="caret">
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
        </span>
        <span className="label">{typeLabel}</span>
        <span className="summary">{summary}</span>
        <button
          className="remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          Remove
        </button>
      </div>
      {!collapsed && (
        <div className="trig-body">
          {draft.type === 'cron' && (
            <CronPicker
              value={draft.expression}
              onChange={(v) => onChange({ ...draft, expression: v })}
            />
          )}
          {draft.type === 'watcher' && (
            <div className="grid gap-[14px]">
              <div>
                <label className="text-xs text-[color:var(--fg-dim)] block mb-1.5">
                  Watched paths
                </label>
                {draft.paths.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {draft.paths.map((p) => (
                      <span key={p} className="code-chip inline-flex items-center gap-1">
                        {resolveHostPath(p).split('/').pop() || resolveHostPath(p)}
                        <button
                          type="button"
                          onClick={() =>
                            onChange({ ...draft, paths: draft.paths.filter((x) => x !== p) })
                          }
                          className="text-[color:var(--status-failed)] cursor-pointer bg-none border-0 p-0"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {hasMounts !== false && (
                  <button type="button" className="btn sm" onClick={() => onPickFolder(index)}>
                    Add path
                  </button>
                )}
                {draft.paths.length === 0 && !workspacePath && (
                  <p className="hint">No workspace folder selected.</p>
                )}
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-[13px]">
                <input
                  type="checkbox"
                  checked={draft.recursive}
                  onChange={(e) => onChange({ ...draft, recursive: e.target.checked })}
                />
                <span>Watch subfolders</span>
              </label>
              <div>
                <label className="text-xs text-[color:var(--fg-dim)] block mb-1.5">Events</label>
                <div className="chip-row">
                  {FS_EVENTS.map(({ value, label }) => (
                    <button
                      type="button"
                      key={value}
                      className={classNames('chip', { active: draft.events.includes(value) })}
                      onClick={() =>
                        onChange({
                          ...draft,
                          events: draft.events.includes(value)
                            ? draft.events.filter((ev) => ev !== value)
                            : [...draft.events, value],
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-[color:var(--fg-dim)] block mb-1.5">
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
          const config: Record<string, unknown> = {
            paths: draft.paths,
            events: draft.events,
            recursive: draft.recursive,
          };
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

  const favouriteSet = new Set(favourites.filter((m) => models.includes(m)));
  const modelOptions: SelectOption[] = [
    ...favourites
      .filter((m) => models.includes(m))
      .map((m) => ({ value: m, label: m, group: 'Favourites' })),
    ...models
      .filter((m) => !favouriteSet.has(m))
      .map((m) => ({ value: m, label: m, group: m.split('/', 1)[0] })),
  ];

  if (loading) return <p className="hint">Loading…</p>;

  return (
    <div className="route-fade max-w-[820px]">
      <Link to="/routines" className="back">
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
        Routines
      </Link>
      <div className="page-head">
        <div>
          <h1>{isEdit ? 'Edit' : 'New'} Routine</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-5">
        <div className="form-row">
          <label>Name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </div>

        <div className="form-row">
          <label>Description</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div className="form-row">
          <label>Prompt</label>
          <div className="hint">What the agent should do when a trigger fires.</div>
          <textarea
            className="textarea"
            value={form.prompt}
            onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            required
          />
        </div>

        {/* Workspace */}
        <div className="form-row">
          <label>Workspace folder</label>
          {hasMounts === false ? (
            <p className="hint">
              No folders mounted. Add a volume to{' '}
              <span className="code-chip">docker-compose.yml</span>.
            </p>
          ) : (
            <>
              <p className="hint mb-2">
                Select a folder mounted under <span className="code-chip">/workspaces</span>.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setFolderPickerTarget(null);
                    setShowFolderPicker(true);
                  }}
                  disabled={hasMounts === null}
                >
                  📁 {form.workspace_path ? 'Change folder' : 'Select folder'}
                </button>
                {form.workspace_path && (
                  <button
                    type="button"
                    className="text-xs text-[color:var(--status-failed)] bg-none border-0 cursor-pointer"
                    onClick={() => setForm((f) => ({ ...f, workspace_path: '' }))}
                  >
                    Clear
                  </button>
                )}
              </div>
              {form.workspace_path && (
                <p className="mt-1.5 font-mono text-xs text-[color:var(--fg)]">
                  {resolveHostPath(form.workspace_path)}
                </p>
              )}
            </>
          )}
        </div>

        <div className="inline-group">
          <div className="form-row !mb-0">
            <label>Model</label>
            <SelectDropdown
              value={form.model}
              onChange={(v) => setForm((f) => ({ ...f, model: v }))}
              options={modelOptions}
              placeholder="Select a model…"
              filterable
            />
          </div>
          <div className="form-row !mb-0">
            <label>Agent</label>
            <input
              className="input"
              value={form.agent}
              onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
            />
          </div>
        </div>

        {/* Triggers */}
        <div>
          <label className="text-[12.5px] font-medium block mb-1">Triggers</label>
          <div className="hint mb-2.5">
            Zero or more · any trigger starts the routine. No triggers = manual only.
          </div>

          {triggerDrafts.map((draft, i) => (
            <TriggerCard
              key={i}
              draft={draft}
              index={i}
              onChange={(d) => updateDraft(i, d)}
              onRemove={() => removeDraft(i)}
              workspacePath={form.workspace_path}
              hasMounts={hasMounts}
              resolveHostPath={resolveHostPath}
              onPickFolder={openFolderPickerForTrigger}
              collapsed={collapsedTriggers.has(i)}
              onToggleCollapse={() => toggleCollapse(i)}
            />
          ))}

          {addingTriggerType === null ? (
            <button
              type="button"
              className="add-trigger"
              onClick={() => setAddingTriggerType('cron')}
            >
              + Add trigger
            </button>
          ) : (
            <div className="trigger-type-picker">
              <SelectDropdown
                value={addingTriggerType || 'cron'}
                onChange={(v) => setAddingTriggerType(v as 'cron' | 'watcher')}
                options={[
                  { value: 'cron', label: 'Cron (scheduled)' },
                  {
                    value: 'watcher',
                    label: 'Filesystem (watch for changes)',
                    disabled: !form.workspace_path,
                  },
                ]}
                placeholder="Trigger type"
              />
              <button
                type="button"
                className="btn primary sm"
                onClick={() => addTrigger(addingTriggerType)}
              >
                Add
              </button>
              <button type="button" className="btn sm" onClick={() => setAddingTriggerType(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Run mode */}
        <div>
          <label className="text-[12.5px] font-medium block mb-3">Run mode</label>
          {[
            {
              id: 'background',
              label: 'Background',
              desc: 'runs on schedule even when the app is closed',
            },
            { id: 'foreground', label: 'Foreground', desc: 'only runs while the app is open' },
          ].map((opt) => (
            <label key={opt.id} className="run-mode-option">
              <input
                type="radio"
                name="runMode"
                value={opt.id}
                checked={form.run_mode === opt.id}
                onChange={() =>
                  setForm((f) => ({ ...f, run_mode: opt.id as 'background' | 'foreground' }))
                }
              />
              <span>
                <span className="rm-label">{opt.label}</span>
                <span className="rm-desc"> — {opt.desc}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex gap-2 mt-2.5">
          <button
            type="submit"
            disabled={submitting}
            className={classNames('btn primary', { 'opacity-50': submitting })}
          >
            {submitting ? 'Saving…' : 'Save routine'}
          </button>
          <Link to={isEdit ? `/routines/${id}` : '/routines'} className="btn">
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

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Trigger } from '../lib/types';
import { CronPicker } from '../components/CronPicker';
import { FolderPicker } from '../components/FolderPicker';

const GITHUB_EVENTS = [
  { label: 'Push',                    value: 'push'                   },
  { label: 'Pull request opened',     value: 'pull_request.opened'    },
  { label: 'Pull request closed',     value: 'pull_request.closed'    },
  { label: 'Pull request review',     value: 'pull_request_review'    },
  { label: 'Issues opened',           value: 'issues.opened'          },
  { label: 'Issues closed',           value: 'issues.closed'          },
  { label: 'Issue comment',           value: 'issue_comment.created'  },
  { label: 'Release published',       value: 'release.published'      },
  { label: 'Workflow run completed',  value: 'workflow_run.completed' },
];

// ---------------------------------------------------------------------------
// Filterable model combobox
// ---------------------------------------------------------------------------

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

  // Close on outside click
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

  // Focus input when opening
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const favouriteSet = new Set(favouriteModels);
  const q = query.toLowerCase();

  const filteredFavourites = favouriteModels.filter(m => !q || m.toLowerCase().includes(q));
  const filteredOthers = allModels
    .filter(m => !favouriteSet.has(m) && (!q || m.toLowerCase().includes(q)));

  // Group others by provider
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
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="select-field w-full text-left flex items-center justify-between gap-2"
      >
        <span className="truncate text-sm">{value || <span className="text-[#6e6e73]">Select a model…</span>}</span>
        <svg className={`size-4 shrink-0 text-[#6e6e73] transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.937a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.061z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-[#d1d1d6] bg-white shadow-lg">
          {/* Search */}
          <div className="p-2 border-b border-[#f0f0f0]">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter models…"
              className="input-field text-sm py-1.5"
            />
          </div>

          {/* Options */}
          <div className="max-h-64 overflow-y-auto py-1">
            {filteredFavourites.length > 0 && (
              <>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6e6e73]">
                  Favourites
                </div>
                {filteredFavourites.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelect(m)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#f5f5f7] truncate ${m === value ? 'font-medium text-[#0071e3]' : 'text-[#1d1d1f]'}`}
                  >
                    {m}
                  </button>
                ))}
                {filteredOthers.length > 0 && <div className="my-1 border-t border-[#f0f0f0]" />}
              </>
            )}

            {Object.entries(groupedOthers).sort(([a], [b]) => a.localeCompare(b)).map(([provider, list]) => (
              <div key={provider}>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#6e6e73]">
                  {provider}
                </div>
                {list.map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => handleSelect(m)}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-[#f5f5f7] truncate ${m === value ? 'font-medium text-[#0071e3]' : 'text-[#1d1d1f]'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ))}

            {filteredFavourites.length === 0 && filteredOthers.length === 0 && (
              <p className="px-3 py-2 text-sm text-[#6e6e73]">No models match "{query}"</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RoutineForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [form, setForm] = useState({
    name: '', description: '', prompt: '',
    model: 'opencode/minimax-m2.5-free',
    repository: '', branch: 'main', agent: 'build',
    env_vars: '{}', enabled: true,
    run_mode: 'background' as 'background' | 'foreground',
    workspace_path: '',
  });
  const [triggerType, setTriggerType] = useState<'none' | 'cron' | 'github'>('none');
  const [cronExpression, setCronExpression] = useState('0 9 * * *');
  const [ghEvent, setGhEvent] = useState('push');
  const [existingTriggers, setExistingTriggers] = useState<Trigger[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [hasMounts, setHasMounts] = useState<boolean | null>(null); // null = not yet loaded

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
        const favSetting = settingsRes.find((s: { key: string; value: string }) => s.key === 'FAVOURITE_MODELS');
        if (favSetting && favSetting.value !== '***') {
          try { setFavourites(JSON.parse(favSetting.value)); } catch { /* ignore */ }
        }
        if (routine) {
          setForm({
            name: routine.name, description: routine.description,
            prompt: routine.prompt, model: routine.model,
            repository: routine.repository, branch: routine.branch,
            agent: routine.agent,
            env_vars: JSON.stringify(routine.env_vars, null, 2),
            enabled: routine.enabled,
            run_mode: routine.run_mode,
            workspace_path: routine.workspace_path ?? '',
          });
        }
        if (triggers && triggers.length > 0) {
          setExistingTriggers(triggers);
          const first = triggers[0];
          if (first.type === 'cron') {
            setTriggerType('cron');
            const expr = String(first.config.expression || '');
            if (expr) setCronExpression(expr);
          } else if (first.type === 'github') {
            setTriggerType('github');
            const events = Array.isArray(first.config.events) ? first.config.events : [];
            setGhEvent(String(events[0] || 'push'));
            setForm(f => ({
              ...f,
              repository: routine?.repository || '',
              branch: routine?.branch || 'main',
            }));
          }
        }
      } catch { /* non-critical */ } finally { setLoading(false); }
    }
    init();
  }, [id, isEdit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    let envVars: Record<string, string>;
    try { envVars = JSON.parse(form.env_vars || '{}'); }
    catch { alert('Invalid JSON in env vars'); setSubmitting(false); return; }

    const data = {
      name: form.name, description: form.description, prompt: form.prompt,
      model: form.model,
      repository: triggerType === 'github' ? form.repository : '',
      branch: triggerType === 'github' ? form.branch : 'main',
      agent: form.agent, env_vars: envVars, enabled: form.enabled,
      run_mode: form.run_mode,
      workspace_path: form.workspace_path,
    };

    try {
      const res = isEdit ? await api.updateRoutine(id!, data) : await api.createRoutine(data);
      const routineId = res.id;

      // In edit mode, remove all existing triggers before re-creating so we don't accumulate duplicates
      if (isEdit) {
        await Promise.all(existingTriggers.map(t => api.deleteTrigger(t.id)));
      }

      if (triggerType === 'cron') {
        if (cronExpression) await api.createTrigger(routineId, { type: 'cron', config: { expression: cronExpression } });
      } else if (triggerType === 'github') {
        await api.createTrigger(routineId, { type: 'github', config: { events: [ghEvent] } });
      }
      navigate(`/routines/${routineId}`);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally { setSubmitting(false); }
  };

  // Models that are in the favourites list (in order), excluding any not in allModels
  const favouriteModels = favourites.filter(m => models.includes(m));

  if (loading) return <p className="text-sm text-[#6e6e73]">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/routines" className="text-xs text-[#0071e3] hover:underline">← Routines</Link>
        <h1 className="mt-2 text-xl font-semibold text-[#1d1d1f]">{isEdit ? 'Edit' : 'New'} Routine</h1>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Name</label>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input-field" required />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Description</label>
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="input-field" />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Prompt</label>
          <textarea value={form.prompt} onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
            rows={6} className="textarea-field font-mono" required />
        </div>

        {/* Workspace folder */}
        <div>
          <label className={`mb-1.5 block text-sm font-medium ${hasMounts === false ? 'text-[#6e6e73]' : 'text-[#1d1d1f]'}`}>
            Workspace folder
          </label>
          {hasMounts === false ? (
            <p className="text-xs text-[#6e6e73]">
              No folders mounted. Add a volume to{' '}
              <span className="font-mono">docker-compose.yml</span> to enable this:
              {' '}<span className="font-mono">- /your/path:/workspaces/my-project</span>
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-[#6e6e73]">
                Select a folder mounted into the container under{' '}
                <span className="font-mono">/workspaces</span>.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowFolderPicker(true)}
                  disabled={hasMounts === null}
                  className="btn btn-secondary flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>📁</span>
                  {form.workspace_path ? 'Change folder' : 'Select folder'}
                </button>
                {form.workspace_path && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, workspace_path: '' }))}
                    className="text-xs text-[#ff3b30] hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              {form.workspace_path && (
                <p className="mt-1.5 font-mono text-xs text-[#1d1d1f] truncate" title={form.workspace_path}>
                  {form.workspace_path}
                </p>
              )}
            </>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Model</label>
            <ModelSelect
              value={form.model}
              onChange={(v) => setForm((f) => ({ ...f, model: v }))}
              favouriteModels={favouriteModels}
              allModels={models}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Agent</label>
            <input value={form.agent} onChange={(e) => setForm((f) => ({ ...f, agent: e.target.value }))}
              className="input-field" />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Trigger</label>
          <div className="flex gap-4 text-sm">
            {(['none', 'cron', 'github'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="trigger_type" value={t}
                  checked={triggerType === t} onChange={() => setTriggerType(t)} />
                {t === 'none' ? 'None' : t === 'cron' ? 'Cron' : 'GitHub'}
              </label>
            ))}
          </div>

          {triggerType === 'cron' && (
            <div className="mt-3">
              <CronPicker value={cronExpression} onChange={setCronExpression} />
            </div>
          )}

          {triggerType === 'github' && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-[#6e6e73]">Repository URL</label>
                <input value={form.repository}
                  onChange={(e) => setForm((f) => ({ ...f, repository: e.target.value }))}
                  placeholder="https://github.com/owner/repo" className="input-field max-w-sm" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#6e6e73]">Branch</label>
                <input value={form.branch}
                  onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
                  className="input-field max-w-xs" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[#6e6e73]">Event</label>
                <select value={ghEvent} onChange={(e) => setGhEvent(e.target.value)}
                  className="select-field max-w-sm">
                  {GITHUB_EVENTS.map((ev) => (
                    <option key={ev.value} value={ev.value}>{ev.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">
            Environment variables <span className="font-normal text-[#6e6e73]">(JSON)</span>
          </label>
          <textarea value={form.env_vars}
            onChange={(e) => setForm((f) => ({ ...f, env_vars: e.target.value }))}
            rows={3} className="textarea-field font-mono" />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
          <span className="text-[#1d1d1f]">Enabled</span>
        </label>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[#1d1d1f]">Run mode</label>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="run_mode" value="background" className="mt-0.5"
                checked={form.run_mode === 'background'}
                onChange={() => setForm((f) => ({ ...f, run_mode: 'background' }))} />
              <span>
                <span className="font-medium text-[#1d1d1f]">Background</span>
                <span className="ml-1.5 text-[#6e6e73]">— runs on schedule even when the app is closed</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" name="run_mode" value="foreground" className="mt-0.5"
                checked={form.run_mode === 'foreground'}
                onChange={() => setForm((f) => ({ ...f, run_mode: 'foreground' }))} />
              <span>
                <span className="font-medium text-[#1d1d1f]">Foreground</span>
                <span className="ml-1.5 text-[#6e6e73]">— only runs while the app is open in a browser</span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? 'Saving…' : 'Save routine'}
          </button>
          <Link to={isEdit ? `/routines/${id}` : '/routines'} className="btn btn-secondary">Cancel</Link>
        </div>
      </form>

      {showFolderPicker && (
        <FolderPicker
          value={form.workspace_path}
          onChange={(p) => setForm((f) => ({ ...f, workspace_path: p }))}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  );
}

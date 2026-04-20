import { useEffect, useState, useCallback, useRef } from 'react';
import classNames from 'classnames';
import { api } from '../lib/api';
import { PROVIDERS } from '../lib/providers';
import type { Provider } from '../lib/providers';
import type { Setting } from '../lib/types';

const FAVOURITE_MODELS_KEY = 'FAVOURITE_MODELS';

function splitModel(id: string): { provider: string; model: string } {
  const slash = id.indexOf('/');
  if (slash === -1) return { provider: '', model: id };
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) };
}

function ModelLabel({ id }: { id: string }) {
  const { provider, model } = splitModel(id);
  return (
    <span className="flex items-center gap-3">
      {provider && (
        <span className="font-mono text-[10.5px] text-[color:var(--fg-dim)] uppercase tracking-[.06em] w-[80px] shrink-0">
          {provider}
        </span>
      )}
      <span className="font-mono text-[13.5px] flex-1">{model || id}</span>
    </span>
  );
}

function ConfiguredProviderCard({
  provider,
  settingKeys,
  onRemove,
}: {
  provider: Provider;
  settingKeys: Set<string>;
  onRemove: (keys: string[]) => void;
}) {
  const configured = provider.fields.filter((f) => settingKeys.has(f.key));
  return (
    <div className="border border-[var(--border)] rounded-[10px] bg-[var(--surface-hi)] overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1">
          <div className="font-semibold text-[14px]">{provider.name}</div>
          <div className="font-mono text-[11.5px] text-[color:var(--fg-dim)] mt-[2px]">
            {provider.description}
          </div>
        </div>
        <span className="status success">
          <span className="dot" />
          Connected
        </span>
        <button onClick={() => onRemove(configured.map((f) => f.key))} className="btn sm delete-rt">
          Remove
        </button>
      </div>
      <div className="border-t border-[var(--border)]">
        {configured.map((f, i) => (
          <div
            key={f.key}
            className={classNames('flex items-center justify-between px-4 py-2 text-xs', {
              'border-b border-[var(--border)]': i < configured.length - 1,
            })}
          >
            <span className="font-mono text-[color:var(--fg-muted)]">{f.key}</span>
            <span className="font-mono">
              {f.secret ? '••••••••' : settingKeys.has(f.key) ? '(set)' : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddProviderForm({
  provider,
  onSave,
  onCancel,
}: {
  provider: Provider;
  onSave: (fields: { key: string; value: string; secret: boolean }[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(provider.fields.map((f) => [f.key, '']))
  );
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing = provider.fields.filter((f) => !values[f.key]?.trim());
    if (missing.length) {
      alert(`Required: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      await onSave(
        provider.fields.map((f) => ({
          key: f.key,
          value: values[f.key],
          secret: f.secret,
        }))
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-[var(--accent)] rounded-[10px] bg-[var(--surface-hi)] p-4"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="font-semibold text-[14px]">{provider.name}</p>
          <p className="text-[12.5px] text-[color:var(--fg-muted)] mt-[2px]">
            {provider.description}
          </p>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[color:var(--accent)] shrink-0"
        >
          Docs ↗
        </a>
      </div>
      <div className="grid gap-2 mb-3">
        {provider.fields.map((f) => (
          <div key={f.key} className="form-row mb-0">
            <label>{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="input"
              autoComplete="off"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn primary">
          {saving ? 'Saving…' : 'Connect'}
        </button>
        <button type="button" onClick={onCancel} className="btn">
          Cancel
        </button>
      </div>
    </form>
  );
}

function CopilotDeviceFlow({
  provider,
  onDone,
  onCancel,
}: {
  provider: Provider;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'success' | 'error'>('idle');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stopWaiting = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  };

  useEffect(() => () => stopWaiting(), []);

  const startFlow = async () => {
    setPhase('idle');
    setErrorMsg('');
    setCopied(false);
    try {
      const data = await api.copilotAuthorize();

      // Extract code from instructions (e.g., "Enter code: XXXX-XXXX")
      const codeMatch = data.instructions.match(/:\s*([A-Z0-9-]+)/i);
      const code = codeMatch ? codeMatch[1] : data.instructions;

      setUserCode(code);
      setVerificationUri(data.url);
      setPhase('waiting');
      window.open(data.url, '_blank');

      // For 'auto' method, the callback polls internally until auth completes
      abortRef.current = new AbortController();
      try {
        const result = await api.copilotCallback();
        if (result.status === 'success') {
          setPhase('success');
          setTimeout(onDone, 1200);
        } else {
          setPhase('error');
          setErrorMsg(result.error || 'Authorization failed');
        }
      } catch (err) {
        if (abortRef.current?.signal.aborted) return;
        setPhase('error');
        setErrorMsg(err instanceof Error ? err.message : 'Authorization failed');
      }
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start authorization');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may not be available */
    }
  };

  return (
    <div className="border border-[var(--accent)] rounded-[10px] bg-[var(--surface-hi)] p-4">
      <div className="flex items-start justify-between gap-2 mb-4">
        <div>
          <p className="font-semibold text-[14px]">{provider.name}</p>
          <p className="text-[12.5px] text-[color:var(--fg-muted)] mt-[2px]">
            {provider.description}
          </p>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[color:var(--accent)] shrink-0"
        >
          Docs
        </a>
      </div>

      {phase === 'idle' && (
        <div>
          <p className="text-[13px] text-[color:var(--fg-muted)] mb-3">
            Connect your GitHub Copilot subscription by authorizing via GitHub.
          </p>
          <div className="flex gap-2">
            <button onClick={startFlow} className="btn primary">
              Login with GitHub
            </button>
            <button onClick={onCancel} className="btn">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'waiting' && (
        <div>
          <p className="text-[13px] mb-3">
            Go to{' '}
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[color:var(--accent)] underline"
            >
              {verificationUri}
            </a>{' '}
            and enter this code:
          </p>
          <div className="flex items-center gap-3 mb-3">
            <code className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[20px] font-mono font-bold tracking-[.12em] select-all">
              {userCode}
            </code>
            <button onClick={handleCopy} className="btn sm">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-[color:var(--fg-muted)] mb-3">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-[pulse_1s_linear_infinite]" />
            Waiting for authorization...
          </div>
          <button
            onClick={() => {
              stopWaiting();
              onCancel();
            }}
            className="btn"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === 'success' && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-[color:var(--status-success)]">
          <span className="w-2 h-2 rounded-full bg-[var(--status-success)]" />
          Connected successfully!
        </div>
      )}

      {phase === 'error' && (
        <div>
          <p className="text-[13px] text-[color:var(--status-failed)] mb-3">{errorMsg}</p>
          <div className="flex gap-2">
            <button onClick={startFlow} className="btn primary">
              Try again
            </button>
            <button onClick={onCancel} className="btn">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderPicker({
  configured,
  onSelect,
}: {
  configured: Set<string>;
  onSelect: (p: Provider) => void;
}) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const q = query.toLowerCase();
  const isSearching = q.length > 0;
  const unconfigured = PROVIDERS.filter((p) => !p.fields.every((f) => configured.has(f.key)));
  const visible = isSearching
    ? unconfigured.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      )
    : showAll
      ? unconfigured
      : unconfigured.filter((p) => p.popular);

  const hiddenCount = unconfigured.length - unconfigured.filter((p) => p.popular).length;

  return (
    <div className="mb-5">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) setShowAll(false);
        }}
        placeholder="Search all providers…"
        className="input mb-3 max-w-[360px]"
        autoFocus
      />
      <div className="grid grid-cols-3 gap-2">
        {visible.map((p) => (
          <div
            key={p.id}
            onClick={() => onSelect(p)}
            className="py-[14px] px-4 border border-[var(--border)] bg-[var(--surface-hi)] cursor-pointer rounded-[10px] transition-all duration-[160ms]"
          >
            <div className="font-semibold text-[14px] mb-1">{p.name}</div>
            <div className="text-[12.5px] text-[color:var(--fg-muted)] leading-[1.4]">
              {p.description}
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="text-[13px] text-[color:var(--fg-muted)] col-span-full">
            No matching providers.
          </p>
        )}
      </div>
      {!isSearching && !showAll && hiddenCount > 0 && (
        <div
          onClick={() => setShowAll(true)}
          className="mt-[10px] text-[color:var(--accent)] font-mono text-[13px] cursor-pointer"
        >
          Show all providers ({hiddenCount} more)
        </div>
      )}
      {!isSearching && showAll && (
        <div
          onClick={() => setShowAll(false)}
          className="mt-[10px] text-[color:var(--fg-muted)] font-mono text-[13px] cursor-pointer"
        >
          Show popular only
        </div>
      )}
    </div>
  );
}

type AddState = { step: 'idle' } | { step: 'pick' } | { step: 'form'; provider: Provider };

function ThemeToggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between py-[10px]">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="pills gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            className={classNames('pill text-xs py-1 px-3', { active: value === o.id })}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Settings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addState, setAddState] = useState<AddState>({ step: 'idle' });

  const [allModels, setAllModels] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);

  const [theme, setThemeState] = useState(
    () => document.documentElement.getAttribute('data-theme') || 'gradient'
  );
  const [density, setDensityState] = useState(
    () => document.documentElement.getAttribute('data-density') || 'comfy'
  );
  const [statusStyle, setStatusStyleState] = useState(
    () => document.documentElement.getAttribute('data-status-style') || 'dot'
  );

  const applyAttr = (attr: string, value: string, storageKey: string) => {
    document.documentElement.setAttribute(attr, value);
    localStorage.setItem(storageKey, value);
  };

  const setTheme = (v: string) => {
    setThemeState(v);
    applyAttr('data-theme', v, 'oc-theme');
  };
  const setDensity = (v: string) => {
    setDensityState(v);
    applyAttr('data-density', v, 'oc-density');
  };
  const setStatusStyle = (v: string) => {
    setStatusStyleState(v);
    applyAttr('data-status-style', v, 'oc-status-style');
  };

  const load = useCallback(async () => {
    try {
      setSettings(await api.getSettings());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const [modelsRes, settingsRes] = await Promise.all([api.getModels(), api.getSettings()]);
      setAllModels(modelsRes.models || []);
      const favSetting = settingsRes.find((s) => s.key === FAVOURITE_MODELS_KEY);
      if (favSetting && favSetting.value !== '***') {
        try {
          setFavourites(JSON.parse(favSetting.value));
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* non-critical */
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadModels();
  }, [load, loadModels]);

  const settingKeys = new Set(settings.map((s) => s.key));
  const configuredProviders = PROVIDERS.filter((p) => p.fields.some((f) => settingKeys.has(f.key)));

  const handleProviderSave = async (fields: { key: string; value: string; secret: boolean }[]) => {
    await Promise.all(
      fields.map((f) => api.upsertSetting({ key: f.key, value: f.value, is_secret: f.secret }))
    );
    setAddState({ step: 'idle' });
    load();
    setModelsLoading(true);
    loadModels();
  };

  const handleProviderRemove = async (keys: string[]) => {
    if (!confirm(`Remove ${keys.join(', ')}?`)) return;
    await Promise.all(keys.map((k) => api.deleteSetting(k)));
    load();
    setModelsLoading(true);
    loadModels();
  };

  const toggleFavourite = async (model: string) => {
    const next = favourites.includes(model)
      ? favourites.filter((m) => m !== model)
      : [...favourites, model];
    setFavourites(next);
    await api.upsertSetting({
      key: FAVOURITE_MODELS_KEY,
      value: JSON.stringify(next),
      is_secret: false,
    });
  };

  if (loading) return <p className="hint">Loading…</p>;
  if (error) return <p className="text-[color:var(--status-failed)] text-[13px]">Error: {error}</p>;

  return (
    <div className="route-fade max-w-[820px]">
      <div className="page-head mb-7">
        <div>
          <h1>Settings</h1>
          <div className="sub">Configure AI providers and favourite models for your routines.</div>
        </div>
      </div>

      {/* Providers */}
      <div className="mb-9">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[16px] font-semibold mb-[3px]">Providers</div>
            <div className="hint">API keys stored here are injected into every routine run.</div>
          </div>
          {addState.step === 'idle' ? (
            <button onClick={() => setAddState({ step: 'pick' })} className="btn primary">
              Add provider
            </button>
          ) : (
            <button onClick={() => setAddState({ step: 'idle' })} className="btn">
              Cancel
            </button>
          )}
        </div>

        {addState.step === 'pick' && (
          <ProviderPicker
            configured={settingKeys}
            onSelect={(p) => setAddState({ step: 'form', provider: p })}
          />
        )}

        {addState.step === 'form' && addState.provider.authFlow === 'device' && (
          <CopilotDeviceFlow
            provider={addState.provider}
            onDone={() => {
              setAddState({ step: 'idle' });
              load();
              setModelsLoading(true);
              loadModels();
            }}
            onCancel={() => setAddState({ step: 'pick' })}
          />
        )}
        {addState.step === 'form' && !addState.provider.authFlow && (
          <AddProviderForm
            provider={addState.provider}
            onSave={handleProviderSave}
            onCancel={() => setAddState({ step: 'pick' })}
          />
        )}

        {configuredProviders.length > 0 ? (
          <div className="grid gap-2">
            {configuredProviders.map((p) => (
              <ConfiguredProviderCard
                key={p.id}
                provider={p}
                settingKeys={settingKeys}
                onRemove={handleProviderRemove}
              />
            ))}
          </div>
        ) : (
          addState.step === 'idle' && (
            <div className="card py-12 px-6 text-center border border-dashed border-[var(--border-hi)]">
              <div className="text-[color:var(--fg-muted)] mb-[10px]">
                No providers connected yet.
              </div>
              <span
                onClick={() => setAddState({ step: 'pick' })}
                className="text-[color:var(--accent)] cursor-pointer font-mono text-[13px]"
              >
                Add your first provider →
              </span>
            </div>
          )
        )}
      </div>

      {/* Favourite models */}
      <div className="mb-9">
        <div className="mb-4">
          <div className="text-[16px] font-semibold mb-[3px]">Favourite models</div>
          <div className="hint">
            Favourite models appear first when selecting a model for a routine.
          </div>
        </div>

        {modelsLoading ? (
          <p className="hint">Loading models…</p>
        ) : allModels.length === 0 ? (
          <div className="card py-12 px-6 text-center border border-dashed border-[var(--border-hi)]">
            <div className="text-[color:var(--fg-muted)]">
              No models available. Connect a provider first.
            </div>
          </div>
        ) : (
          <>
            <input
              type="search"
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder="Search models…"
              className="input mb-4 max-w-[360px]"
            />

            {favourites.length > 0 && (
              <div className="mb-[14px]">
                <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-[6px]">
                  Favourites
                </div>
                <div className="card overflow-hidden">
                  {favourites.map((m, i) => (
                    <div
                      key={m}
                      className={classNames('flex items-center gap-3 py-[10px] px-4', {
                        'border-b border-[var(--border)]': i < favourites.length - 1,
                      })}
                    >
                      <ModelLabel id={m} />
                      <button onClick={() => toggleFavourite(m)} className="btn sm delete-rt">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {modelQuery &&
              (() => {
                const q = modelQuery.toLowerCase();
                const favSet = new Set(favourites);
                const filtered = allModels.filter(
                  (m) => m.toLowerCase().includes(q) && !favSet.has(m)
                );
                return filtered.length > 0 ? (
                  <div>
                    <div className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[color:var(--fg-dim)] mb-[6px]">
                      All models
                    </div>
                    <div className="card overflow-hidden max-h-[320px] overflow-y-auto">
                      {filtered.map((m, i) => (
                        <div
                          key={m}
                          className={classNames('flex items-center gap-3 py-[10px] px-4', {
                            'border-b border-[var(--border)]': i < filtered.length - 1,
                          })}
                        >
                          <ModelLabel id={m} />
                          <button onClick={() => toggleFavourite(m)} className="btn sm run">
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[13px] text-[color:var(--fg-muted)]">
                    No models matching "{modelQuery}".
                  </p>
                );
              })()}

            {!modelQuery && favourites.length === 0 && (
              <p className="text-[13px] text-[color:var(--fg-muted)]">
                Use the search box above to find models and add them to your favourites.
              </p>
            )}
          </>
        )}
      </div>

      {/* Appearance */}
      <div>
        <div className="mb-4">
          <div className="text-[16px] font-semibold mb-[3px]">Appearance</div>
          <div className="hint">Customise the look and feel of the interface.</div>
        </div>
        <div className="card py-2 px-5">
          <ThemeToggle
            label="Theme"
            options={[
              { id: 'gradient', label: 'Gradient' },
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
            ]}
            value={theme}
            onChange={setTheme}
          />
          <div className="divider" />
          <ThemeToggle
            label="Density"
            options={[
              { id: 'comfy', label: 'Comfy' },
              { id: 'compact', label: 'Compact' },
            ]}
            value={density}
            onChange={setDensity}
          />
          <div className="divider" />
          <ThemeToggle
            label="Status style"
            options={[
              { id: 'dot', label: 'Dot' },
              { id: 'pill', label: 'Pill' },
            ]}
            value={statusStyle}
            onChange={setStatusStyle}
          />
        </div>
      </div>
    </div>
  );
}

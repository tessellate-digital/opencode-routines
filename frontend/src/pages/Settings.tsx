import { useEffect, useState, useCallback, useRef } from 'react';
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
    <span className="flex items-center gap-2 min-w-0">
      {provider && (
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground uppercase tracking-wide">
          {provider}
        </span>
      )}
      <span className="font-mono text-[13px] text-foreground truncate">{model || id}</span>
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
    <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-md shadow-sm">
      <div className="flex items-start justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[13px] text-foreground">{provider.name}</span>
            <span className="status-pill bg-success-soft text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Connected
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{provider.description}</p>
        </div>
        <button
          onClick={() => onRemove(configured.map((f) => f.key))}
          className="btn btn-danger shrink-0"
        >
          Remove
        </button>
      </div>
      <div className="border-t border-border/70 divide-y divide-border/50">
        {configured.map((f) => (
          <div key={f.key} className="flex items-center justify-between px-4 py-2 text-xs">
            <span className="font-mono text-muted-foreground">{f.key}</span>
            <span className="font-mono text-foreground">
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
      className="overflow-hidden rounded-xl border border-accent/30 bg-surface/80 backdrop-blur-md shadow-sm p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-[13px] text-foreground">{provider.name}</p>
          <p className="text-xs text-muted-foreground">{provider.description}</p>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-accent hover:underline"
        >
          Docs ↗
        </a>
      </div>
      <div className="space-y-2">
        {provider.fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs text-muted-foreground">{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="input-field"
              autoComplete="off"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn btn-primary">
          {saving ? 'Saving…' : 'Connect'}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-secondary">
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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const startFlow = async () => {
    setPhase('idle');
    setErrorMsg('');
    setCopied(false);
    try {
      const data = await api.copilotDeviceCode();
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setPhase('waiting');
      window.open(data.verification_uri, '_blank');

      let pollInterval = Math.max((data.interval || 5) * 1000, 5000);
      const INITIAL_DELAY = 10_000;

      function schedulePoll() {
        pollingRef.current = setTimeout(async () => {
          try {
            const poll = await api.copilotPoll(data.device_code);
            if (poll.status === 'success') {
              stopPolling();
              setPhase('success');
              setTimeout(onDone, 1200);
              return;
            } else if (poll.status === 'expired_token') {
              stopPolling();
              setPhase('error');
              setErrorMsg('The code expired. Please try again.');
              return;
            } else if (poll.status === 'access_denied') {
              stopPolling();
              setPhase('error');
              setErrorMsg('Authorization was denied.');
              return;
            } else if (poll.status === 'slow_down') {
              pollInterval += 5000;
            }
          } catch (err) {
            console.warn('[copilot poll]', err);
          }
          schedulePoll();
        }, pollInterval);
      }

      pollingRef.current = setTimeout(schedulePoll, INITIAL_DELAY);
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start device flow');
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
    <div className="overflow-hidden rounded-xl border border-accent/30 bg-surface/80 backdrop-blur-md shadow-sm p-4 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-[13px] text-foreground">{provider.name}</p>
          <p className="text-xs text-muted-foreground">{provider.description}</p>
        </div>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-accent hover:underline"
        >
          Docs
        </a>
      </div>

      {phase === 'idle' && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect your GitHub Copilot subscription by authorizing via GitHub.
          </p>
          <div className="flex gap-2">
            <button onClick={startFlow} className="btn btn-primary">
              Login with GitHub
            </button>
            <button onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'waiting' && (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            Go to{' '}
            <a
              href={verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              {verificationUri}
            </a>{' '}
            and enter this code:
          </p>
          <div className="flex items-center gap-3">
            <code className="rounded-lg border border-border/70 bg-muted px-4 py-2 text-xl font-mono font-bold tracking-widest text-foreground select-all">
              {userCode}
            </code>
            <button onClick={handleCopy} className="btn btn-secondary text-xs">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Waiting for authorization...
          </div>
          <button
            onClick={() => {
              stopPolling();
              onCancel();
            }}
            className="btn btn-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {phase === 'success' && (
        <div className="flex items-center gap-2 text-sm font-medium text-success">
          <span className="size-2 rounded-full bg-success" />
          Connected successfully!
        </div>
      )}

      {phase === 'error' && (
        <div className="space-y-3">
          <p className="text-sm text-destructive">{errorMsg}</p>
          <div className="flex gap-2">
            <button onClick={startFlow} className="btn btn-primary">
              Try again
            </button>
            <button onClick={onCancel} className="btn btn-secondary">
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
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) setShowAll(false);
        }}
        placeholder="Search all providers…"
        className="input-field max-w-sm"
        autoFocus
      />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p)}
            className="rounded-xl border border-border/70 bg-surface/80 p-3 text-left backdrop-blur-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/50"
          >
            <p className="font-medium text-[13px] text-foreground">{p.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{p.description}</p>
          </button>
        ))}
        {visible.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full">No matching providers.</p>
        )}
      </div>
      {!isSearching && !showAll && hiddenCount > 0 && (
        <button onClick={() => setShowAll(true)} className="text-sm text-accent hover:underline">
          Show all providers ({hiddenCount} more)
        </button>
      )}
      {!isSearching && showAll && (
        <button
          onClick={() => setShowAll(false)}
          className="text-sm text-muted-foreground hover:underline"
        >
          Show popular only
        </button>
      )}
    </div>
  );
}

type AddState = { step: 'idle' } | { step: 'pick' } | { step: 'form'; provider: Provider };

export default function Settings() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addState, setAddState] = useState<AddState>({ step: 'idle' });

  const [allModels, setAllModels] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [modelsLoading, setModelsLoading] = useState(true);

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

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-destructive">Error: {error}</p>;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Configure AI providers and favourite models for your routines.
        </p>
      </div>

      {/* Providers */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">Providers</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              API keys stored here are injected into every routine run.
            </p>
          </div>
          {addState.step === 'idle' && (
            <button onClick={() => setAddState({ step: 'pick' })} className="btn btn-primary">
              Add provider
            </button>
          )}
          {addState.step !== 'idle' && (
            <button onClick={() => setAddState({ step: 'idle' })} className="btn btn-secondary">
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
          <div className="space-y-3">
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
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No providers connected yet.</p>
              <button
                onClick={() => setAddState({ step: 'pick' })}
                className="mt-2 text-sm text-accent hover:underline"
              >
                Add your first provider →
              </button>
            </div>
          )
        )}
      </section>

      {/* Favourite models */}
      <section className="space-y-4">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Favourite models</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Favourite models appear first when selecting a model for a routine.
          </p>
        </div>

        {modelsLoading ? (
          <p className="text-sm text-muted-foreground">Loading models…</p>
        ) : allModels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No models available. Connect a provider first.
            </p>
          </div>
        ) : (
          <>
            <input
              type="search"
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder="Search by model name or provider..."
              className="input-field max-w-sm"
            />

            {favourites.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Favourites
                </p>
                <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-md shadow-sm divide-y divide-border/50">
                  {favourites.map((m) => (
                    <div key={m} className="flex items-center justify-between gap-4 px-4 py-2">
                      <ModelLabel id={m} />
                      <button
                        onClick={() => toggleFavourite(m)}
                        className="shrink-0 text-xs text-destructive hover:underline"
                      >
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
                  <div className="space-y-1">
                    {favourites.length > 0 && (
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        All models
                      </p>
                    )}
                    <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/80 backdrop-blur-md shadow-sm divide-y divide-border/50 max-h-80 overflow-y-auto">
                      {filtered.map((m) => (
                        <div key={m} className="flex items-center justify-between gap-4 px-4 py-2">
                          <ModelLabel id={m} />
                          <button
                            onClick={() => toggleFavourite(m)}
                            className="shrink-0 text-xs text-accent hover:underline"
                          >
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No models matching "{modelQuery}".
                  </p>
                );
              })()}

            {!modelQuery && favourites.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Use the search box above to find models and add them to your favourites.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

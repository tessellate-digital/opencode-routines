import { useEffect, useState, useCallback } from 'react';
import classNames from 'classnames';
import { api } from '../lib/api';

const AGENT_URL = 'http://localhost:3000';

interface AgentWatcher {
  triggerId: string;
  containerPaths: string[];
  hostPaths: string[];
  events: string[];
  watching: boolean;
  fileFilter?: { mode: string; patterns: string[] } | null;
}

interface AgentDebug {
  backendUrl: string;
  lastPollAt: string | null;
  lastPollError: string | null;
  volumeMounts: Record<string, string>;
  watchers: AgentWatcher[];
}

interface TriggerRow {
  id: string;
  routine_id: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

interface RoutineInfo {
  id: string;
  name: string;
  enabled: boolean;
}

export default function DevPage() {
  const [agentData, setAgentData] = useState<AgentDebug | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [dbTriggers, setDbTriggers] = useState<TriggerRow[]>([]);
  const [routines, setRoutines] = useState<Map<string, RoutineInfo>>(new Map());
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(AGENT_URL);
      if (!res.ok) throw new Error(`Agent returned ${res.status}`);
      setAgentData(await res.json());
      setAgentError(null);
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : 'Unknown error');
      setAgentData(null);
    }

    try {
      const res = await fetch('/api/triggers?type=watcher');
      if (res.ok) {
        const triggers = (await res.json()) as TriggerRow[];
        setDbTriggers(triggers);
        const routineIds = [...new Set(triggers.map((t) => t.routine_id))];
        const routineMap = new Map<string, RoutineInfo>();
        for (const rid of routineIds) {
          try {
            const r = await api.getRoutine(rid);
            routineMap.set(rid, { id: r.id, name: r.name, enabled: r.enabled });
          } catch {
            /* ignore */
          }
        }
        setRoutines(routineMap);
      }
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (triggerId: string, routineId: string) => {
    if (!confirm('Delete this trigger? If no other triggers remain, the routine will be disabled.'))
      return;
    setDeleting((s) => new Set(s).add(triggerId));
    try {
      await api.deleteTrigger(triggerId);
      const remaining = await api.getTriggers(routineId);
      if (remaining.length === 0) {
        await api.toggleRoutine(routineId, false);
      }
      await load();
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setDeleting((s) => {
        const n = new Set(s);
        n.delete(triggerId);
        return n;
      });
    }
  };

  const merged = dbTriggers.map((t) => {
    const agentWatcher = agentData?.watchers.find((w) => w.triggerId === t.id);
    return { trigger: t, agent: agentWatcher ?? null };
  });

  // Find agent watchers that aren't in the DB (orphaned)
  const orphanedWatchers =
    agentData?.watchers.filter((w) => !dbTriggers.some((t) => t.id === w.triggerId)) ?? [];

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[#ffc9c9] bg-[#fff5f5] px-4 py-3 flex items-start gap-3">
        <span className="shrink-0 mt-0.5 text-[#ff3b30] font-bold text-sm">DEV</span>
        <div>
          <p className="text-sm font-medium text-[#1d1d1f]">Debug page — not for production use</p>
          <p className="mt-0.5 text-xs text-[#6e6e73]">
            Shows live state from the host agent at{' '}
            <code className="rounded bg-white/60 px-1 py-0.5 text-[11px]">{AGENT_URL}</code>.
            Deleting a trigger here also disables the routine if no triggers remain.
          </p>
        </div>
      </div>

      {/* Agent status */}
      <div>
        <h2 className="mb-2 text-sm font-semibold text-[#1d1d1f]">Agent</h2>
        {agentError ? (
          <p className="text-sm text-[#ff3b30]">
            Could not reach agent at {AGENT_URL}: {agentError}
          </p>
        ) : agentData ? (
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] text-sm">
            <Row label="Backend URL" value={agentData.backendUrl} />
            <Row label="Last poll" value={agentData.lastPollAt ?? '—'} />
            {agentData.lastPollError && (
              <Row
                label="Poll error"
                value={<span className="text-[#ff3b30]">{agentData.lastPollError}</span>}
              />
            )}
            <Row
              label="Volume mounts"
              value={
                Object.keys(agentData.volumeMounts).length === 0 ? (
                  <span className="text-[#ff3b30]">None parsed — check docker-compose.yml</span>
                ) : (
                  <span className="font-mono text-xs">
                    {Object.entries(agentData.volumeMounts).map(([c, h]) => (
                      <span key={c} className="block">
                        {c} → {h}
                      </span>
                    ))}
                  </span>
                )
              }
            />
            <Row label="Active watchers" value={`${agentData.watchers.length}`} />
          </div>
        ) : (
          <p className="text-sm text-[color:var(--fg-muted)]">Loading…</p>
        )}
      </div>

      {/* Watcher triggers */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">Watcher triggers</h2>
          <button onClick={load} className="btn sm">
            Refresh
          </button>
        </div>

        {merged.length === 0 && orphanedWatchers.length === 0 ? (
          <p className="text-sm text-[color:var(--fg-muted)]">No watcher triggers registered.</p>
        ) : (
          <div className="space-y-3">
            {merged.map(({ trigger, agent }) => {
              const routine = routines.get(trigger.routine_id);
              const paths = (trigger.config.paths as string[]) ?? [];
              const events = (trigger.config.events as string[]) ?? [];
              const recursive = trigger.config.recursive !== false;
              const fileFilter = trigger.config.fileFilter as
                | { mode?: string; patterns?: string[] }
                | undefined;

              return (
                <div
                  key={trigger.id}
                  className="rounded-lg border border-[var(--border)] overflow-hidden"
                >
                  <div className="flex items-center justify-between bg-[var(--surface)] px-4 py-2">
                    <div className="flex items-center gap-2 text-sm flex-wrap">
                      <span className="font-medium">
                        {routine?.name ?? trigger.routine_id.slice(0, 8)}
                      </span>
                      {agent ? (
                        agent.watching ? (
                          <Badge color="green">Watching</Badge>
                        ) : (
                          <Badge color="red">Not watching</Badge>
                        )
                      ) : (
                        <Badge color="yellow">Agent offline</Badge>
                      )}
                      {agent && agent.hostPaths.length === 0 && (
                        <Badge color="red">Path unresolved</Badge>
                      )}
                      {routine && !routine.enabled && (
                        <Badge color="yellow">Routine disabled</Badge>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(trigger.id, trigger.routine_id)}
                      disabled={deleting.has(trigger.id)}
                      className="btn sm delete-rt"
                    >
                      {deleting.has(trigger.id) ? '…' : 'Delete'}
                    </button>
                  </div>
                  <div className="divide-y divide-[var(--border)] text-sm">
                    <Row
                      label="Trigger ID"
                      value={<code className="text-xs font-mono">{trigger.id}</code>}
                    />
                    <Row
                      label="Routine ID"
                      value={<code className="text-xs font-mono">{trigger.routine_id}</code>}
                    />
                    <Row
                      label="Container paths"
                      value={<code className="text-xs font-mono">{paths.join(', ') || '—'}</code>}
                    />
                    <Row
                      label="Host paths"
                      value={
                        <code
                          className={classNames('text-xs font-mono', {
                            'text-[#ff3b30]': agent && agent.hostPaths.length === 0,
                          })}
                        >
                          {agent ? agent.hostPaths.join(', ') || '—' : '(agent offline)'}
                        </code>
                      }
                    />
                    <Row
                      label="Events"
                      value={
                        events.length > 0 ? (
                          <span className="flex gap-1 flex-wrap justify-end">
                            {events.map((e) => (
                              <span key={e} className="trig text-[11px]">
                                {e}
                              </span>
                            ))}
                          </span>
                        ) : (
                          '—'
                        )
                      }
                    />
                    <Row label="Recursive" value={recursive ? 'Yes' : 'No'} />
                    {fileFilter &&
                      fileFilter.mode !== 'none' &&
                      fileFilter.patterns &&
                      fileFilter.patterns.length > 0 && (
                        <Row
                          label={`File filter (${fileFilter.mode})`}
                          value={
                            <span className="flex gap-1 flex-wrap justify-end">
                              {fileFilter.patterns.map((p) => (
                                <span key={p} className="code-chip text-[11px]">
                                  {p}
                                </span>
                              ))}
                            </span>
                          }
                        />
                      )}
                  </div>
                </div>
              );
            })}

            {orphanedWatchers.map((w) => (
              <div
                key={w.triggerId}
                className="rounded-lg border border-[var(--border)] overflow-hidden opacity-60"
              >
                <div className="flex items-center gap-2 bg-[var(--surface)] px-4 py-2 text-sm">
                  <span className="font-medium">{w.triggerId.slice(0, 8)}…</span>
                  <Badge color="yellow">Orphaned (not in DB)</Badge>
                  {w.watching && <Badge color="green">Watching</Badge>}
                </div>
                <div className="divide-y divide-[var(--border)] text-sm">
                  <Row
                    label="Host paths"
                    value={<code className="text-xs font-mono">{w.hostPaths.join(', ')}</code>}
                  />
                  <Row label="Events" value={w.events.join(', ')} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between px-4 py-2.5 gap-4">
      <span className="text-[color:var(--fg-muted)] shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function Badge({
  color,
  children,
}: {
  color: 'green' | 'red' | 'yellow';
  children: React.ReactNode;
}) {
  const cls = {
    green: 'bg-[#d1f5d3] text-[#1a7f37]',
    red: 'bg-[#ffd7d5] text-[#cf222e]',
    yellow: 'bg-[#fff3cd] text-[#856404]',
  }[color];
  return (
    <span className={classNames('rounded-full px-2 py-0.5 text-xs font-medium', cls)}>
      {children}
    </span>
  );
}

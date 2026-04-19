import { useEffect, useState, useCallback } from 'react';
import classNames from 'classnames';
import { api } from '../lib/api';

const AGENT_URL = 'http://localhost:3000';

interface AgentWatcher {
  triggerId: string;
  containerPath: string;
  hostPath: string;
  pathResolved: boolean;
  events: string[];
  watching: boolean;
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

export default function DevPage() {
  const [agentData, setAgentData] = useState<AgentDebug | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [dbTriggers, setDbTriggers] = useState<TriggerRow[]>([]);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    // Fetch agent debug info
    try {
      const res = await fetch(AGENT_URL);
      if (!res.ok) throw new Error(`Agent returned ${res.status}`);
      setAgentData(await res.json());
      setAgentError(null);
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : 'Unknown error');
      setAgentData(null);
    }

    // Fetch all watcher triggers from backend DB
    try {
      const res = await fetch('/api/triggers?type=watcher');
      if (res.ok) setDbTriggers(await res.json());
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

      // Check remaining triggers for this routine
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

  // Merge DB triggers with agent state
  const merged = dbTriggers.map((t) => {
    const agentWatcher = agentData?.watchers.find((w) => w.triggerId === t.id);
    return { trigger: t, agent: agentWatcher ?? null };
  });

  return (
    <div className="space-y-6">
      {/* Dev warning */}
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
          <div className="rounded-lg border border-[#d1d1d6] divide-y divide-[#f0f0f0] text-sm">
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
                  <span className="text-[#ff3b30]">
                    None parsed — check docker-compose.yml regex
                  </span>
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
          </div>
        ) : (
          <p className="text-sm text-[#6e6e73]">Loading…</p>
        )}
      </div>

      {/* Watcher triggers */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1d1d1f]">Watcher triggers</h2>
          <button onClick={load} className="btn btn-secondary text-xs">
            Refresh
          </button>
        </div>

        {merged.length === 0 ? (
          <p className="text-sm text-[#6e6e73]">No watcher triggers registered.</p>
        ) : (
          <div className="space-y-3">
            {merged.map(({ trigger, agent }) => (
              <div key={trigger.id} className="rounded-lg border border-[#d1d1d6] overflow-hidden">
                <div className="flex items-center justify-between bg-[#f5f5f7] px-4 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-[#1d1d1f]">
                      {(trigger.config.path as string) ?? trigger.id}
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
                    {agent && !agent.pathResolved && <Badge color="red">Path unresolved</Badge>}
                  </div>
                  <button
                    onClick={() => handleDelete(trigger.id, trigger.routine_id)}
                    disabled={deleting.has(trigger.id)}
                    className="btn btn-danger text-xs"
                  >
                    {deleting.has(trigger.id) ? '…' : 'Delete'}
                  </button>
                </div>
                <div className="divide-y divide-[#f0f0f0] text-sm">
                  <Row label="Trigger ID" value={<code className="text-xs">{trigger.id}</code>} />
                  <Row
                    label="Routine ID"
                    value={<code className="text-xs">{trigger.routine_id}</code>}
                  />
                  <Row
                    label="Container path"
                    value={
                      <code className="text-xs">
                        {agent?.containerPath ?? (trigger.config.path as string)}
                      </code>
                    }
                  />
                  {agent && (
                    <Row
                      label="Host path"
                      value={
                        <code
                          className={classNames('text-xs', {
                            'text-[#ff3b30]': !agent.pathResolved,
                          })}
                        >
                          {agent.hostPath}
                        </code>
                      }
                    />
                  )}
                  <Row
                    label="Events"
                    value={(trigger.config.events as string[])?.join(', ') ?? '—'}
                  />
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
      <span className="text-[#6e6e73] shrink-0">{label}</span>
      <span className="text-[#1d1d1f] text-right">{value}</span>
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

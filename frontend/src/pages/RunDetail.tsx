import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import classNames from 'classnames';
import { api } from '../lib/api';
import { useRunStream } from '../hooks/useSSE';
import { StatusBadge } from '../components/RunsTable';
import { duration } from '../lib/utils';
import { useRunStore, type Segment } from '../stores/runStore';
import type { Run } from '../lib/types';
import { SiriOrb } from '../components/SiriOrb';
import { TodoBox, type TodoItem } from '../components/TodoBox';
import './RunDetail.style.css';

function parseSegments(events: Array<{ type: string; data: string }>): Segment[] {
  const segments: Segment[] = [];
  for (const evt of events) {
    if (evt.type === 'text') {
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') {
        last.content += evt.data;
      } else {
        segments.push({ kind: 'text', content: evt.data });
      }
    } else if (evt.type === 'tool') {
      const firstNewline = evt.data.indexOf('\n');
      const header = firstNewline === -1 ? evt.data : evt.data.slice(0, firstNewline);
      const args = firstNewline === -1 ? '' : evt.data.slice(firstNewline + 1).trim();
      const name = header
        .replace(/^\[tool:\s*/, '')
        .replace(/\]$/, '')
        .trim();
      segments.push({ kind: 'tool', name, args, result: '', open: false });
    } else if (evt.type === 'tool_result') {
      const last = [...segments].reverse().find((s) => s.kind === 'tool');
      if (last && last.kind === 'tool') {
        last.result = evt.data.replace(/^\[result\]\n?/, '').trim();
      }
    } else if (evt.type === 'error') {
      segments.push({ kind: 'error', content: evt.data });
    } else if (evt.type === 'status' && evt.data.startsWith('--- step') && segments.length > 0) {
      segments.push({ kind: 'step', label: '' });
    }
  }
  return segments;
}

function extractTodos(segments: Segment[]): TodoItem[] {
  let latest: TodoItem[] = [];
  for (const seg of segments) {
    if (seg.kind !== 'tool' || seg.name !== 'todowrite') continue;
    try {
      const parsed = JSON.parse(seg.args);
      const items = Array.isArray(parsed.todos)
        ? parsed.todos
        : Array.isArray(parsed)
          ? parsed
          : [];
      latest = items.map((t: { content: string; status: string; priority?: string }) => ({
        content: t.content,
        status: t.status as TodoItem['status'],
        priority: t.priority as TodoItem['priority'],
      }));
    } catch {
      // If args aren't valid JSON, try extracting from result
      if (seg.result) {
        try {
          const items = JSON.parse(seg.result);
          if (Array.isArray(items)) {
            latest = items.map((t: { content: string; status: string; priority?: string }) => ({
              content: t.content,
              status: t.status as TodoItem['status'],
              priority: t.priority as TodoItem['priority'],
            }));
          }
        } catch {
          /* ignore */
        }
      }
    }
  }
  return latest;
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-[14px]">
      <div className="bg-[var(--accent)] text-[color:var(--accent-fg)] py-2.5 px-4 rounded-[20px] text-sm leading-[1.55] max-w-[480px] whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function ToolRow({ seg, onToggle }: { seg: Segment & { kind: 'tool' }; onToggle: () => void }) {
  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-[5px] bg-transparent border-none py-0.5 px-0 font-mono text-[12.5px] text-[color:var(--fg-muted)] cursor-pointer"
      >
        <span className="text-[10px] opacity-70">{seg.open ? '▼' : '›'}</span>
        <span className="font-medium">{seg.name}</span>
      </button>
      {seg.open && (
        <div className="mt-1 bg-[var(--surface-hi)] border border-[var(--border)] rounded-lg py-3 px-[14px] font-mono text-xs text-[color:var(--fg-muted)] whitespace-pre-wrap leading-relaxed">
          {seg.args && <div className={classNames({ 'mb-2': seg.result })}>{seg.args}</div>}
          {seg.result && <div className="text-[color:var(--fg-dim)]">{seg.result}</div>}
        </div>
      )}
    </div>
  );
}

function AgentText({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="md text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div
      className="py-2.5 px-[14px] rounded-[10px] text-[color:var(--status-failed)] text-[13px] font-mono whitespace-pre-wrap"
      style={{
        background: 'color-mix(in srgb, var(--status-failed) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--status-failed) 25%, transparent)',
      }}
    >
      {content}
    </div>
  );
}

function StepDivider() {
  return <div className="divider" />;
}

function PromptContext({ context }: { context: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-[color:var(--fg-muted)] font-mono list-none flex items-center gap-1">
        <span className="text-[10px]">›</span>
        Prompt context
      </summary>
      <pre className="mt-1.5 bg-[var(--surface-hi)] border border-[var(--border)] rounded-lg py-3 px-[14px] font-mono text-[11px] text-[color:var(--fg-muted)] whitespace-pre-wrap overflow-auto max-h-[200px]">
        {context.trim()}
      </pre>
    </details>
  );
}

const SegmentList = memo(function SegmentList({
  segments,
  toggledTools,
  onToggleTool,
}: {
  segments: Segment[];
  toggledTools: Set<number>;
  onToggleTool: (idx: number) => void;
}) {
  return (
    <>
      {segments.map((seg, idx) => {
        if (seg.kind === 'text') return <AgentText key={idx} content={seg.content} />;
        if (seg.kind === 'error') return <ErrorBubble key={idx} content={seg.content} />;
        if (seg.kind === 'step') return <StepDivider key={idx} />;
        if (seg.kind === 'tool') {
          const open = seg.open || toggledTools.has(idx);
          return <ToolRow key={idx} seg={{ ...seg, open }} onToggle={() => onToggleTool(idx)} />;
        }
        return null;
      })}
    </>
  );
});

const AssistantCard = memo(function AssistantCard({
  segments,
  toggledTools,
  onToggleTool,
  isStreaming,
}: {
  segments: Segment[];
  toggledTools: Set<number>;
  onToggleTool: (idx: number) => void;
  isStreaming?: boolean;
}) {
  const hasContent = segments.length > 0;
  if (!hasContent && !isStreaming) return null;
  return (
    <div className="flex justify-start mb-[14px]">
      <div className="bg-[var(--surface-hi)] border border-[var(--border)] py-3 px-4 rounded-2xl shadow-[var(--shadow-sm)] max-w-[640px] w-full">
        <SegmentList segments={segments} toggledTools={toggledTools} onToggleTool={onToggleTool} />
        {isStreaming && (
          <span className="status running text-[11px] mt-1.5 inline-flex">
            <span className="dot" />
            streaming
          </span>
        )}
      </div>
    </div>
  );
});

const ThreadItem = memo(function ThreadItem({
  run,
  isFirst,
  isLast,
  isStreaming,
  liveSegments,
  toggledTools,
  onToggleTool,
}: {
  run: Run;
  isFirst: boolean;
  isLast: boolean;
  isStreaming: boolean;
  liveSegments: Segment[];
  toggledTools: Set<number>;
  onToggleTool: (idx: number) => void;
}) {
  const segments = useMemo(
    () => (isLast && isStreaming ? liveSegments : parseSegments(run.stdout || [])),
    [isLast, isStreaming, liveSegments, run.stdout]
  );

  return (
    <div>
      {isFirst &&
        run.metadata?.prompt_context &&
        typeof run.metadata.prompt_context === 'string' && (
          <PromptContext context={run.metadata.prompt_context} />
        )}
      {run.prompt && <UserBubble text={run.prompt} />}
      <AssistantCard
        segments={segments}
        toggledTools={toggledTools}
        onToggleTool={onToggleTool}
        isStreaming={isLast && isStreaming}
      />
      {!isLast && <div className="divider" />}
    </div>
  );
});

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();

  const {
    thread,
    liveSegments,
    isStreaming,
    toggledTools,
    setThread,
    setStreaming,
    clearLiveSegments,
    appendText,
    appendTool,
    appendToolResult,
    appendError,
    appendStep,
    updateRunStatus,
    finalizeStream,
    toggleTool,
    toggleLiveTool,
    addReplyRun,
    reset,
  } = useRunStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [orbExiting, setOrbExiting] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollAfterReply = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const runs = await api.getThread(id);
      setThread(runs);
      setError(null);
      const latest = runs[runs.length - 1];
      if (latest?.status === 'running') {
        setStreaming(true);
        clearLiveSegments();
      } else {
        setStreaming(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id, setThread, setStreaming, clearLiveSegments]);

  useEffect(() => {
    reset();
    load();
  }, [id]);

  useEffect(() => {
    if (scrollAfterReply.current) {
      scrollAfterReply.current = false;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
  }, [thread.length]);

  const latestRunId = thread[thread.length - 1]?.id;

  useRunStream(isStreaming ? (latestRunId ?? null) : null, {
    onText: useCallback((data: string) => appendText(data), [appendText]),
    onTool: useCallback(
      (data: string) => {
        const firstNewline = data.indexOf('\n');
        const header = firstNewline === -1 ? data : data.slice(0, firstNewline);
        const args = firstNewline === -1 ? '' : data.slice(firstNewline + 1).trim();
        const name = header
          .replace(/^\[tool:\s*/, '')
          .replace(/\]$/, '')
          .trim();
        appendTool(name, args);
      },
      [appendTool]
    ),
    onToolResult: useCallback(
      (data: string) => {
        appendToolResult(data.replace(/^\[result\]\n?/, '').trim());
      },
      [appendToolResult]
    ),
    onError: useCallback((data: string) => appendError(data), [appendError]),
    onStatus: useCallback(
      (data: string) => {
        if (data.startsWith('--- step')) appendStep();
      },
      [appendStep]
    ),
    onStderr: useCallback(() => {}, []),
    onStdout: useCallback(() => {}, []),
    onReconnect: useCallback(() => clearLiveSegments(), [clearLiveSegments]),
    onDone: useCallback(
      (data: string) => {
        try {
          const parsed = JSON.parse(data);
          if (latestRunId) {
            updateRunStatus(
              latestRunId,
              parsed.status,
              parsed.exit_code ?? null,
              new Date().toISOString()
            );
          }
        } catch {
          /* ignore */
        }
        finalizeStream();
        setOrbExiting(true);
        setTimeout(() => {
          setOrbExiting(false);
        }, 300);
      },
      [latestRunId, updateRunStatus, finalizeStream]
    ),
    onStreamError: useCallback(() => {
      setStreaming(false);
    }, [setStreaming]),
  });

  const handleCancel = async () => {
    if (!latestRunId) return;
    try {
      await api.cancelRun(latestRunId);
      updateRunStatus(latestRunId, 'cancelled', null, new Date().toISOString());
      setOrbExiting(true);
      setTimeout(() => {
        setStreaming(false);
        setOrbExiting(false);
      }, 300);
    } catch (e) {
      alert('Error: ' + (e instanceof Error ? e.message : 'Unknown'));
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!latestRunId || !replyText.trim() || !currentRun) return;
    const prompt = replyText.trim();
    setReplying(true);
    setReplyText('');
    if (taRef.current) taRef.current.style.height = 'auto';
    try {
      const { run_id } = await api.replyToRun(latestRunId, prompt);
      scrollAfterReply.current = true;
      addReplyRun(run_id, prompt, currentRun.routine_name, currentRun.routine_id);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setReplying(false);
    }
  };

  const handleToggleTool = useCallback(
    (runId: string, idx: number, isLive: boolean) => {
      if (isLive) toggleLiveTool(idx);
      else toggleTool(runId, idx);
    },
    [toggleTool, toggleLiveTool]
  );

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setReplyText(e.target.value);
    const ta = taRef.current;
    if (ta) {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
    }
  };

  const todos = useMemo(() => {
    const allSegments: Segment[] = [];
    for (const run of thread) {
      allSegments.push(...parseSegments(run.stdout || []));
    }
    allSegments.push(...liveSegments);
    return extractTodos(allSegments);
  }, [thread, liveSegments]);

  if (loading) return <p className="hint">Loading...</p>;
  if (error) return <p className="text-[color:var(--status-failed)] text-[13px]">Error: {error}</p>;
  if (!thread.length)
    return <p className="text-[color:var(--status-failed)] text-[13px]">Run not found</p>;

  const currentRun = thread[thread.length - 1];
  const isFinished = ['success', 'failed', 'cancelled', 'lost'].includes(currentRun.status);
  const canReply = isFinished && currentRun.status !== 'lost';
  const inputDisabled = replying || isStreaming || currentRun.status === 'lost';
  const showThinking = isStreaming || orbExiting;

  return (
    <div className="route-fade">
      <Link to="/runs" className="back">
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
        Runs
      </Link>

      <div className="page-head">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="mono text-xs text-[color:var(--fg-dim)]">
              {currentRun.id.slice(0, 8)}
            </span>
            <span className="text-[color:var(--fg-dim)]">·</span>
            <StatusBadge status={currentRun.status} />
            <span className="text-[color:var(--fg-dim)]">·</span>
            <span className="mono text-xs text-[color:var(--fg-dim)]">
              {currentRun.trigger_type}
            </span>
            <span className="text-[color:var(--fg-dim)]">·</span>
            <span className="mono text-xs text-[color:var(--fg-dim)]">
              {duration(currentRun.started_at, currentRun.finished_at)}
            </span>
            {thread.length > 1 && (
              <>
                <span className="text-[color:var(--fg-dim)]">·</span>
                <span className="text-xs text-[color:var(--fg-dim)]">{thread.length} turns</span>
              </>
            )}
          </div>
          <h1>{currentRun.routine_name}</h1>
        </div>
        <div className="flex gap-2">
          <Link to={`/routines/${currentRun.routine_id}`} className="btn">
            View routine
          </Link>
        </div>
      </div>

      {currentRun.status === 'lost' && (
        <div className="delete-confirm mb-4 bg-[var(--surface-2)] border-[var(--border-hi)]">
          <span className="font-semibold">Connection lost.</span> This run was interrupted — no
          further interaction is possible.
        </div>
      )}

      <TodoBox items={todos} />

      <div className="grid gap-[18px] pb-10">
        {thread.map((run, ti) => {
          const isLast = ti === thread.length - 1;
          const runToggled = toggledTools[run.id] ?? new Set<number>();
          return (
            <ThreadItem
              key={run.id}
              run={run}
              isFirst={ti === 0}
              isLast={isLast}
              isStreaming={isStreaming}
              liveSegments={liveSegments}
              toggledTools={runToggled}
              onToggleTool={(idx) => handleToggleTool(run.id, idx, isLast && isStreaming)}
            />
          );
        })}

        {currentRun.stderr && isFinished && (
          <details className="mb-2">
            <summary className="cursor-pointer text-xs text-[color:var(--fg-muted)] font-mono list-none flex items-center gap-1">
              <span className="text-[10px]">›</span>
              Stderr output
            </summary>
            <pre className="mt-1.5 bg-[var(--surface-hi)] border border-[var(--border)] rounded-lg py-3 px-[14px] font-mono text-[11px] text-[color:var(--fg-muted)] whitespace-pre-wrap overflow-auto max-h-[200px]">
              {currentRun.stderr}
            </pre>
          </details>
        )}
      </div>

      {/* Chat composer */}
      <div className="flex justify-center mt-3">
        <div
          className={classNames('chat-composer', { thinking: showThinking })}
          onClick={showThinking ? handleCancel : undefined}
        >
          {showThinking ? (
            <div className={classNames({ 'orb-exit': orbExiting })}>
              <SiriOrb size="42px" animationDuration={12} />
            </div>
          ) : (
            <div className={classNames('composer-input', { 'fade-in': !showThinking })}>
              <textarea
                ref={taRef}
                placeholder={
                  currentRun.status === 'lost'
                    ? 'Cannot reply — run was lost'
                    : 'Follow up, add context, or ask a question…'
                }
                value={replyText}
                onChange={handleInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && canReply) {
                    e.preventDefault();
                    handleReply(e);
                  }
                }}
                rows={1}
                disabled={inputDisabled}
              />
              <button
                className={classNames('btn primary rounded-full py-[9px] px-[18px] shrink-0', {
                  'opacity-100': replyText.trim() && !inputDisabled,
                  'opacity-45': !replyText.trim() || inputDisabled,
                })}
                onClick={(e) => handleReply(e)}
                disabled={inputDisabled || !replyText.trim()}
              >
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

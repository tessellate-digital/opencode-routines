import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../lib/api';
import { useRunStream } from '../hooks/useSSE';
import { StatusBadge } from '../components/RunsTable';
import { duration } from '../lib/utils';
import { useRunStore, type Segment } from '../stores/runStore';
import type { Run } from '../lib/types';

function parseSegments(stdout: string): Segment[] {
  const segments: Segment[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    try {
      const evt = JSON.parse(line) as { type: string; data: string };
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
        if (last && last.kind === 'tool')
          last.result = evt.data.replace(/^\[result\]\n?/, '').trim();
      } else if (evt.type === 'error') {
        segments.push({ kind: 'error', content: evt.data });
      } else if (evt.type === 'status' && evt.data.startsWith('--- step') && segments.length > 0) {
        segments.push({ kind: 'step', label: '' });
      }
    } catch {
      const last = segments[segments.length - 1];
      if (last?.kind === 'text') {
        last.content += line;
      } else {
        segments.push({ kind: 'text', content: line });
      }
    }
  }
  return segments;
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-2xl rounded-tr-sm bg-accent px-4 py-3 text-[13px] leading-relaxed text-white shadow-md whitespace-pre-wrap">
        {text}
      </div>
    </div>
  );
}

function ToolRow({ seg, onToggle }: { seg: Segment & { kind: 'tool' }; onToggle: () => void }) {
  return (
    <div className="my-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-accent/10 hover:text-foreground transition-colors"
      >
        <span className="text-[10px] leading-none">{seg.open ? '▾' : '›'}</span>
        <span>
          Ran{' '}
          <span className="rounded bg-accent/10 px-1 font-mono text-[11px] text-foreground">
            {seg.name}
          </span>
        </span>
      </button>
      {seg.open && (
        <div className="mt-1 ml-5 space-y-1.5">
          {seg.args && (
            <pre className="overflow-auto max-h-48 rounded-lg border border-border/70 bg-muted px-3 py-2 text-[11px] font-mono text-foreground whitespace-pre-wrap">
              {seg.args}
            </pre>
          )}
          {seg.result && (
            <pre className="overflow-auto max-h-48 rounded-lg border border-border/70 bg-muted px-3 py-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">
              {seg.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function AgentText({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="prose prose-sm max-w-none text-[13px] text-foreground leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-accent/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_code]:font-mono [&_code]:text-foreground [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-muted [&_pre]:px-3 [&_pre]:py-2 [&_pre]:overflow-auto [&_pre]:max-h-64 [&_strong]:font-semibold [&_em]:italic [&_table]:w-full [&_table]:text-[12px] [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_td]:border [&_td]:border-border/70 [&_td]:px-2.5 [&_td]:py-1.5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-[13px] text-destructive leading-relaxed whitespace-pre-wrap">
      {content}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-muted-foreground animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

function StepDivider() {
  return <div className="my-3 border-t border-border/70" />;
}

function PromptContext({ context }: { context: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block text-[10px]">
          ›
        </span>
        Prompt context
      </summary>
      <pre className="mt-1.5 rounded-lg border border-border/70 bg-muted px-3 py-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap overflow-auto max-h-48">
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
    <div className="relative overflow-hidden rounded-2xl border border-accent/20 bg-surface/90 p-5 backdrop-blur-sm">
      <div className="pointer-events-none absolute -top-10 -right-10 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-10 -left-10 h-40 w-40 rounded-full bg-accent-warm/10 blur-3xl" />
      <div className="relative space-y-1.5 max-w-[90%]">
        <SegmentList segments={segments} toggledTools={toggledTools} onToggleTool={onToggleTool} />
        {isStreaming && <ThinkingDots />}
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
    () => (isLast && isStreaming ? liveSegments : parseSegments(run.stdout || '')),
    [isLast, isStreaming, liveSegments, run.stdout]
  );

  return (
    <div className="space-y-3">
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
      {!isLast && <div className="border-b border-border/70" />}
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
    toggleTool,
    toggleLiveTool,
    addReplyRun,
    reset,
  } = useRunStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);

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
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveSegments]);

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
        if (data.startsWith('--- step')) {
          appendStep();
        }
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
          // ignore
        }
        setStreaming(false);
      },
      [latestRunId, updateRunStatus, setStreaming]
    ),
    onStreamError: useCallback(() => {
      setStreaming(false);
    }, [setStreaming]),
  });

  const handleCancel = async () => {
    if (!latestRunId || !confirm('Cancel this run?')) return;
    try {
      await api.cancelRun(latestRunId);
      updateRunStatus(latestRunId, 'cancelled', null, new Date().toISOString());
      setStreaming(false);
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
    try {
      const { run_id } = await api.replyToRun(latestRunId, prompt);
      addReplyRun(run_id, prompt, currentRun.routine_name, currentRun.routine_id);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setReplying(false);
    }
  };

  const handleToggleTool = useCallback(
    (runId: string, idx: number, isLive: boolean) => {
      if (isLive) {
        toggleLiveTool(idx);
      } else {
        toggleTool(runId, idx);
      }
    },
    [toggleTool, toggleLiveTool]
  );

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error) return <p className="text-sm text-destructive">Error: {error}</p>;
  if (!thread.length) return <p className="text-sm text-destructive">Run not found</p>;

  const currentRun = thread[thread.length - 1];
  const isFinished = ['success', 'failed', 'cancelled', 'lost'].includes(currentRun.status);
  const canReply = isFinished && currentRun.status !== 'lost';
  const inputDisabled = replying || isStreaming || currentRun.status === 'lost';

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <Link to="/runs" className="text-xs text-accent hover:underline">
          ← Runs
        </Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
              {currentRun.routine_name}
            </h1>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
              <StatusBadge status={currentRun.status} />
              <span>·</span>
              <span className="font-mono capitalize">{currentRun.trigger_type}</span>
              <span>·</span>
              <span className="font-mono">
                {duration(currentRun.started_at, currentRun.finished_at)}
              </span>
              {thread.length > 1 && (
                <>
                  <span>·</span>
                  <span>{thread.length} turns</span>
                </>
              )}
            </div>
          </div>
          {currentRun.status === 'running' && (
            <button onClick={handleCancel} className="btn btn-danger shrink-0">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Conversation thread */}
      <div className="space-y-4 pb-32">
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
        <div ref={bottomRef} />
      </div>

      {/* Lost run banner */}
      {currentRun.status === 'lost' && (
        <div className="mb-4 rounded-xl border border-border/70 bg-surface/80 px-4 py-3 text-sm text-foreground backdrop-blur-sm">
          <span className="font-medium">Connection lost.</span> This run was interrupted — the
          process stopped responding before it could finish. No further interaction is possible.
        </div>
      )}

      {/* Stderr */}
      {currentRun.stderr && isFinished && (
        <details className="group mb-4">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block text-[10px]">
              ›
            </span>
            Stderr output
          </summary>
          <pre className="mt-2 rounded-lg border border-border/70 bg-muted px-3 py-2 text-[11px] font-mono text-muted-foreground whitespace-pre-wrap overflow-auto max-h-48">
            {currentRun.stderr}
          </pre>
        </details>
      )}

      {/* Chat input — always visible, disabled when streaming */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border/70 bg-canvas/90 backdrop-blur-md">
        <form
          onSubmit={handleReply}
          className="mx-auto flex w-full max-w-5xl items-center gap-3 px-8 py-4"
        >
          <div className="relative flex-1">
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && canReply) {
                  e.preventDefault();
                  handleReply(e);
                }
              }}
              placeholder={
                isStreaming
                  ? 'Waiting for response...'
                  : currentRun.status === 'lost'
                    ? 'Cannot reply — run was lost'
                    : 'Follow up...'
              }
              className="w-full rounded-full border border-border/70 bg-surface/80 px-5 py-3 pr-14 text-[14px] text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50 backdrop-blur-sm"
              disabled={inputDisabled}
            />
            <button
              type="submit"
              disabled={inputDisabled || !replyText.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-foreground text-canvas transition-all hover:bg-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

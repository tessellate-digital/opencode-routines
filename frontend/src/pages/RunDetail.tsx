import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { api } from '../lib/api';
import { useRunStream } from '../hooks/useSSE';
import { StatusBadge } from '../components/RunsTable';
import { duration } from '../lib/utils';
import type { Run } from '../lib/types';

// ---------------------------------------------------------------------------
// Conversation segment types
// ---------------------------------------------------------------------------

type TextSegment   = { kind: 'text';   content: string };
type ToolSegment   = { kind: 'tool';   name: string; args: string; result: string; open: boolean };
type ErrorSegment  = { kind: 'error';  content: string };
type StepSegment   = { kind: 'step';   label: string };

type Segment = TextSegment | ToolSegment | ErrorSegment | StepSegment;

function parseSegments(stdout: string): Segment[] {
  const segments: Segment[] = [];
  for (const line of stdout.split('\n')) {
    if (!line) continue;
    try {
      const evt = JSON.parse(line) as { type: string; data: string };
      applyEvent(segments, evt.type, evt.data);
    } catch {
      appendText(segments, line);
    }
  }
  return segments;
}

function appendText(segments: Segment[], text: string) {
  const last = segments[segments.length - 1];
  if (last?.kind === 'text') {
    last.content += text;
  } else {
    segments.push({ kind: 'text', content: text });
  }
}

function applyEvent(segments: Segment[], type: string, data: string) {
  if (type === 'text') {
    appendText(segments, data);
  } else if (type === 'tool') {
    const firstNewline = data.indexOf('\n');
    const header = firstNewline === -1 ? data : data.slice(0, firstNewline);
    const args = firstNewline === -1 ? '' : data.slice(firstNewline + 1).trim();
    const name = header.replace(/^\[tool:\s*/, '').replace(/\]$/, '').trim();
    segments.push({ kind: 'tool', name, args, result: '', open: false });
  } else if (type === 'tool_result') {
    const last = [...segments].reverse().find(s => s.kind === 'tool') as ToolSegment | undefined;
    if (last) last.result = data.replace(/^\[result\]\n?/, '').trim();
  } else if (type === 'error') {
    segments.push({ kind: 'error', content: data });
  } else if (type === 'status') {
    // Insert a step divider between steps so multi-step responses are
    // visually separated.  "--- step ---" marks the beginning of a new step;
    // we only insert a divider when there is already content above so the
    // first step doesn't get a pointless separator at the top.
    if (data.startsWith('--- step') && segments.length > 0) {
      segments.push({ kind: 'step', label: '' });
    }
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Right-aligned user message bubble. */
function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-[#0071e3] px-4 py-3 text-[14px] text-white whitespace-pre-wrap leading-relaxed shadow-sm">
        {text}
      </div>
    </div>
  );
}

/** Collapsible tool-call row. */
function ToolRow({ seg, onToggle }: { seg: ToolSegment; onToggle: () => void }) {
  return (
    <div className="my-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] transition-colors"
      >
        <span className="text-[10px] leading-none">{seg.open ? '\u25BE' : '\u203A'}</span>
        <span>
          Ran <span className="font-medium text-[#3a3a3c]">{seg.name}</span>
        </span>
      </button>
      {seg.open && (
        <div className="mt-1 ml-5 space-y-1.5">
          {seg.args && (
            <pre className="rounded-lg bg-[#f5f5f7] border border-[#e8e8ed] px-3 py-2 text-[11px] font-mono text-[#3a3a3c] whitespace-pre-wrap overflow-auto max-h-48">
              {seg.args}
            </pre>
          )}
          {seg.result && (
            <pre className="rounded-lg bg-[#f5f5f7] border border-[#e8e8ed] px-3 py-2 text-[11px] font-mono text-[#6e6e73] whitespace-pre-wrap overflow-auto max-h-48">
              {seg.result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/** Agent prose text — rendered as markdown. */
function AgentText({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="prose prose-sm max-w-none text-[14px] text-[#1d1d1f] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-[#e8e8ed] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] [&_pre]:rounded-lg [&_pre]:bg-[#f5f5f7] [&_pre]:border [&_pre]:border-[#e8e8ed] [&_pre]:px-3 [&_pre]:py-2 [&_pre]:overflow-auto [&_pre]:max-h-64 [&_strong]:font-semibold [&_em]:italic">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="rounded-lg bg-[#fff2f0] border border-[#ffccc7] px-3 py-2 text-[13px] text-[#ff3b30] leading-relaxed whitespace-pre-wrap">
      {content}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="size-1.5 rounded-full bg-[#86868b] animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

/** Visual separator between LLM steps. */
function StepDivider() {
  return <div className="border-t border-[#e8e8ed] my-3" />;
}

/** Collapsible prompt context — shows the execution metadata injected before the prompt. */
function PromptContext({ context }: { context: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-[#86868b] hover:text-[#1d1d1f] list-none flex items-center gap-1">
        <span className="group-open:rotate-90 transition-transform inline-block text-[10px]">&rsaquo;</span>
        Prompt context
      </summary>
      <pre className="mt-1.5 rounded-lg border border-[#e8e8ed] bg-[#f5f5f7] px-3 py-2 text-[11px] font-mono text-[#6e6e73] whitespace-pre-wrap overflow-auto max-h-48">
        {context.trim()}
      </pre>
    </details>
  );
}

/** Renders a list of segments with tool toggle support. */
function SegmentList({
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
        if (seg.kind === 'text')  return <AgentText key={idx} content={seg.content} />;
        if (seg.kind === 'error') return <ErrorBubble key={idx} content={seg.content} />;
        if (seg.kind === 'step')  return <StepDivider key={idx} />;
        if (seg.kind === 'tool') {
          const open = seg.open || toggledTools.has(idx);
          return (
            <ToolRow
              key={idx}
              seg={{ ...seg, open }}
              onToggle={() => onToggleTool(idx)}
            />
          );
        }
        return null;
      })}
    </>
  );
}

/** A single assistant turn — left-aligned, no background (OpenAI style). */
function AssistantCard({
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
    <div className="space-y-1.5 max-w-[90%]">
      <SegmentList segments={segments} toggledTools={toggledTools} onToggleTool={onToggleTool} />
      {isStreaming && <ThinkingDots />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RunDetail
// ---------------------------------------------------------------------------

export default function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [thread, setThread] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live streaming for the current (latest) run
  const [liveSegments, setLiveSegments] = useState<Segment[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  // Reply
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  // Tool toggle state per run — keyed by run id, value is set of segment indices
  const [toggledTools, setToggledTools] = useState<Record<string, Set<number>>>({});

  const bottomRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<Segment[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const runs = await api.getThread(id);
      setThread(runs);
      setError(null);
      // If the latest run is still running, start streaming
      const latest = runs[runs.length - 1];
      if (latest?.status === 'running') {
        setIsStreaming(true);
        liveRef.current = [];
        setLiveSegments([]);
      } else {
        setIsStreaming(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Scroll to bottom on new streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveSegments]);

  const updateLive = useCallback(() => {
    setLiveSegments([...liveRef.current]);
  }, []);

  const latestRunId = thread[thread.length - 1]?.id;

  // When we see a "--- done" status from the stream but the backend's `done`
  // SSE event hasn't arrived yet (opencode process may hang), start polling the
  // run status so the UI can finalize without waiting indefinitely.
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopPolling = useCallback(() => {
    if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
  }, []);

  useEffect(() => stopPolling, [stopPolling]); // cleanup on unmount

  const startCompletionPolling = useCallback(() => {
    if (pollingRef.current) return; // already polling
    pollingRef.current = setInterval(async () => {
      if (!latestRunId) return;
      try {
        const runs = await api.getThread(latestRunId);
        const latest = runs[runs.length - 1];
        if (latest && ['success', 'failed', 'cancelled'].includes(latest.status)) {
          stopPolling();
          setIsStreaming(false);
          liveRef.current = [];
          setThread(runs);
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
  }, [latestRunId, stopPolling]);

  // SSE handlers for the latest run
  useRunStream(isStreaming ? latestRunId ?? null : null, {
    onText: useCallback((data: string) => {
      appendText(liveRef.current, data);
      updateLive();
    }, [updateLive]),
    onTool: useCallback((data: string) => {
      applyEvent(liveRef.current, 'tool', data);
      updateLive();
    }, [updateLive]),
    onToolResult: useCallback((data: string) => {
      applyEvent(liveRef.current, 'tool_result', data);
      updateLive();
    }, [updateLive]),
    onError: useCallback((data: string) => {
      applyEvent(liveRef.current, 'error', data);
      updateLive();
    }, [updateLive]),
    onStatus: useCallback((data: string) => {
      // When we see "--- done ..." it means the LLM step finished.
      // Start polling in case the process hangs and never sends `done`.
      if (data.startsWith('--- done')) {
        startCompletionPolling();
      }
    }, [startCompletionPolling]),
    onStderr: useCallback(() => {}, []),
    onStdout: useCallback(() => {}, []),
    onDone: useCallback(() => {
      stopPolling();
      setIsStreaming(false);
      liveRef.current = [];
      setTimeout(() => load(), 400);
    }, [load, stopPolling]),
  });

  const handleCancel = async () => {
    if (!latestRunId || !confirm('Cancel this run?')) return;
    try { await api.cancelRun(latestRunId); load(); }
    catch (e) { alert('Error: ' + (e instanceof Error ? e.message : 'Unknown')); }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!latestRunId || !replyText.trim()) return;
    setReplying(true);
    try {
      const { run_id } = await api.replyToRun(latestRunId, replyText.trim());
      setReplyText('');
      navigate(`/runs/${run_id}`);
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setReplying(false);
    }
  };

  const toggleTool = useCallback((runId: string, idx: number) => {
    setToggledTools(prev => {
      const runSet = new Set(prev[runId] ?? []);
      if (runSet.has(idx)) runSet.delete(idx); else runSet.add(idx);
      return { ...prev, [runId]: runSet };
    });
  }, []);

  if (loading) return <p className="p-4 text-sm text-[#6e6e73]">Loading...</p>;
  if (error)   return <p className="p-4 text-sm text-[#ff3b30]">Error: {error}</p>;
  if (!thread.length) return <p className="p-4 text-sm text-[#ff3b30]">Run not found</p>;

  const currentRun = thread[thread.length - 1];
  const isFinished = ['success', 'failed', 'cancelled'].includes(currentRun.status);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <Link to="/runs" className="text-xs text-[#0071e3] hover:underline">&larr; Runs</Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[#1d1d1f]">{currentRun.routine_name}</h1>
            <div className="mt-1 flex items-center gap-2 text-xs text-[#6e6e73]">
              <StatusBadge status={currentRun.status} />
              <span className="text-[#d1d1d6]">&middot;</span>
              <span className="capitalize">{currentRun.trigger_type}</span>
              <span className="text-[#d1d1d6]">&middot;</span>
              <span>{duration(currentRun.started_at, currentRun.finished_at)}</span>
              {thread.length > 1 && (
                <>
                  <span className="text-[#d1d1d6]">&middot;</span>
                  <span>{thread.length} turns</span>
                </>
              )}
            </div>
          </div>
          {currentRun.status === 'running' && (
            <button onClick={handleCancel} className="btn btn-danger shrink-0 text-xs">Cancel</button>
          )}
        </div>
      </div>

      {/* Conversation thread */}
      <div className="space-y-4 pb-4">
        {thread.map((run, ti) => {
          const isLast = ti === thread.length - 1;
          const segments = isLast && isStreaming
            ? liveSegments
            : parseSegments(run.stdout || '');
          const runToggled = toggledTools[run.id] ?? new Set<number>();

          return (
            <div key={run.id} className="space-y-3">
              {/* User prompt */}
              {run.prompt && <UserBubble text={run.prompt} />}

              {/* Prompt context — only shown once at the top of the thread (first run) */}
              {ti === 0 && typeof run.metadata?.prompt_context === 'string' && (
                <PromptContext context={run.metadata.prompt_context} />
              )}

              {/* Assistant response */}
              <AssistantCard
                segments={segments}
                toggledTools={runToggled}
                onToggleTool={(idx) => {
                  if (isLast && isStreaming) {
                    // Mutate live ref directly for streaming runs
                    liveRef.current = liveRef.current.map((s, i) =>
                      i === idx && s.kind === 'tool' ? { ...s, open: !s.open } : s,
                    );
                    updateLive();
                  } else {
                    toggleTool(run.id, idx);
                  }
                }}
                isStreaming={isLast && isStreaming}
              />

              {/* Turn divider (between turns, not after the last) */}
              {!isLast && (
                <div className="border-b border-[#f0f0f0]" />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Stderr (collapsed, only shown if present on the latest finished run) */}
      {currentRun.stderr && isFinished && (
        <details className="group mb-4">
          <summary className="cursor-pointer text-xs text-[#86868b] hover:text-[#1d1d1f] list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block text-[10px]">&rsaquo;</span>
            Stderr output
          </summary>
          <pre className="mt-2 rounded-lg border border-[#e8e8ed] bg-[#f5f5f7] px-3 py-2 text-[11px] font-mono text-[#6e6e73] whitespace-pre-wrap overflow-auto max-h-48">
            {currentRun.stderr}
          </pre>
        </details>
      )}

      {/* Reply input */}
      {isFinished && (
        <form
          onSubmit={handleReply}
          className="sticky bottom-0 bg-white border-t border-[#e8e8ed] pt-3 pb-2 flex items-end gap-2"
        >
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleReply(e as unknown as React.FormEvent);
            }}
            placeholder="Follow up..."
            rows={2}
            className="textarea-field flex-1 resize-none text-sm"
            disabled={replying}
          />
          <button
            type="submit"
            disabled={replying || !replyText.trim()}
            className="btn btn-primary shrink-0 self-end disabled:opacity-40 text-sm"
          >
            {replying ? 'Sending...' : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}

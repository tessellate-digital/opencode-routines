/**
 * runStreamStore — per-run event queue and replay history.
 *
 * Extracted from executor.ts to decouple queue/history management from
 * the execution implementation.  Callers (executor, event relay, SSE routes)
 * interact through the module-level functions below.
 *
 * Lifecycle per run:
 *   openRun(id)        — called when execution starts; creates queue + history
 *   push(id, event)    — called per translated event; fans out to live consumers
 *                        and persists incrementally to runs.stdout as JSONL
 *   close(id)          — called when execution ends; signals SSE consumers
 *   connectStream(id)  — called by SSE handler; terminates old consumer, returns
 *                        new queue for the connecting client
 *   getHistory(id)     — returns all events emitted so far (replay on connect)
 */

import { db } from '../database';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface StreamEvent {
  type: string;
  data: string;
}

export interface DonePayload {
  status: string;
  exit_code: number | null;
}

/**
 * Minimal async FIFO queue.  One consumer awaits `get()` at a time; extra
 * events accumulate in `items` until consumed.
 */
export class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: ((value: T) => void)[] = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  async get(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return item;
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

// ─── Internal state ───────────────────────────────────────────────────────────

interface RunStore {
  queue: AsyncQueue<StreamEvent | null>;
  history: StreamEvent[];
  /** All JSONL lines already persisted to stdout (for incremental writes). */
  stdoutLines: string[];
}

const stores = new Map<string, RunStore>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise per-run state.  Must be called before `push` or `connectStream`.
 */
export function openRun(runId: string): void {
  if (stores.has(runId)) {
    return;
  }
  stores.set(runId, {
    queue: new AsyncQueue<StreamEvent | null>(),
    history: [],
    stdoutLines: [],
  });
}

/**
 * Push a translated event to the live queue, append it to the in-memory
 * history, and persist it incrementally to `runs.stdout` as JSONL so late-
 * joining clients can replay the full transcript.
 *
 * Special handling:
 * - 'thinking' events: streamed to frontend but NOT persisted (ephemeral)
 * - 'stats' events: persisted to metadata.stats, not stdout
 *
 * Full transcripts are stored without truncation.
 */
export function push(runId: string, event: StreamEvent): void {
  const store = stores.get(runId);
  if (!store) {
    return;
  }

  // Always stream to queue for live SSE consumers
  store.queue.push(event);

  // Handle special event types
  if (event.type === 'thinking') {
    // Thinking tokens are ephemeral - stream only, don't persist or add to history
    // (history is used for replay, and we don't want to replay thinking)
    return;
  }

  if (event.type === 'stats') {
    // Stats are persisted to metadata.stats, not stdout
    try {
      const stats = JSON.parse(event.data);
      const row = db.prepare('SELECT metadata FROM runs WHERE id = ?').get(runId) as
        | { metadata: string }
        | undefined;
      const metadata = JSON.parse(row?.metadata ?? '{}');
      metadata.stats = stats;
      db.prepare('UPDATE runs SET metadata = ? WHERE id = ?').run(JSON.stringify(metadata), runId);
    } catch {
      // Ignore stats persistence errors
    }
    // Don't add stats to history or stdout - it's metadata
    return;
  }

  // Regular events: add to history and persist to stdout
  store.history.push(event);
  store.stdoutLines.push(JSON.stringify(event));
  db.prepare('UPDATE runs SET stdout = ? WHERE id = ?').run(store.stdoutLines.join('\n'), runId);
}

/**
 * Signal end-of-stream to the active SSE consumer and remove the per-run
 * state.  Safe to call more than once (idempotent).
 *
 * If `done` is provided, a `{ type: 'done' }` event carrying the authoritative
 * final status is pushed to the queue *before* the `null` sentinel.  This
 * ensures SSE consumers receive the correct status without a DB read race.
 * The done event is NOT added to history or persisted to stdout — it is a
 * control signal, not transcript content.
 */
export function close(runId: string, done?: DonePayload): void {
  const store = stores.get(runId);
  if (!store) {
    return;
  }
  stores.delete(runId);
  if (done) {
    store.queue.push({ type: 'done', data: JSON.stringify(done) });
  }
  store.queue.push(null);
}

/**
 * Returns true if any error-type events have been pushed to this run's stream.
 * Used as a defense-in-depth backup for the relay's `hadErrors` flag, in case
 * there is a timing issue between the relay loop and the executor's finally block.
 */
export function hasErrorEvents(runId: string): boolean {
  const store = stores.get(runId);
  if (!store) {
    return false;
  }
  return store.history.some((e) => e.type === 'error');
}

/**
 * Create a fresh queue for a new SSE consumer.  The old consumer (if any) is
 * terminated by pushing `null` to the old queue so it can close gracefully.
 * Returns `null` if no active stream exists for the run.
 */
export function connectStream(runId: string): AsyncQueue<StreamEvent | null> | null {
  const store = stores.get(runId);
  if (!store) {
    return null;
  }

  // Terminate any existing consumer
  store.queue.push(null);

  // Swap in a fresh queue for the new consumer
  const newQueue = new AsyncQueue<StreamEvent | null>();
  store.queue = newQueue;
  return newQueue;
}

/**
 * Return all events emitted so far for a run (used to replay to late-joining
 * SSE clients before they start receiving live events).
 */
export function getHistory(runId: string): StreamEvent[] {
  return stores.get(runId)?.history ?? [];
}

/**
 * opencodeEventRelay — shared per-server event relay with per-run demuxing.
 *
 * Architecture
 * ────────────
 * One `client.global.event()` SSE subscription is maintained per unique pooled
 * server client.  Multiple active runs on the same pooled server share this
 * single subscription; incoming SDK events are dispatched to the correct run by
 * matching `sessionId`.
 *
 * Lifecycle
 * ─────────
 *   subscribeRun(client, sessionId, runId)
 *     Register a run.  Starts the server relay loop lazily on first subscriber.
 *
 *   unsubscribeRun(sessionId)
 *     Remove a run's mapping (call when the run ends / session goes idle).
 *     The relay loop continues — other runs on the same server are unaffected.
 *
 *   closeServerRelay(client)
 *     Tear down the shared subscription for a pooled server (call on pool
 *     disposal / server eviction).  Any remaining subscribers are dropped.
 *
 * Event translation contract (mirrors the existing CLI JSONL format):
 *   TextPart          → { type: 'text',        data: part.text }
 *   ToolPart running  → { type: 'tool',         data: '[tool: <name>]\n<args>\n' }
 *   ToolPart complete → { type: 'tool_result',  data: '[result]\n<output>\n' }
 *   ToolPart error    → { type: 'tool_result',  data: '[result]\n<error>\n' }
 *   StepStartPart     → { type: 'status',       data: '--- step ---\n' }
 *   StepFinishPart    → { type: 'status',       data: '--- done (tokens: N, cost: $N) ---\n' }
 *   session.error     → { type: 'error',        data: '[error] <message>\n' }
 *   All other events  → ignored (no new frontend event types invented).
 */

import { db } from '../database';
import * as runStreamStore from './runStreamStore';
import type { StreamEvent } from './runStreamStore';
import { logger } from '../util/logger';

// ─── Internal types ───────────────────────────────────────────────────────────

interface RunSubscriber {
  runId: string;
  /** Per-ToolPart last-emitted state, to deduplicate tool call / result events. */
  toolStates: Map<string, string>;
  /** messageID → role, populated from message.updated events. */
  messageRoles: Map<string, string>;
  /** The user message ID for the current prompt — parts for other messages are assistant. */
  userMessageId: string | null;
  /** Set to true when a session.error event is received for this session. */
  errorSeen: boolean;
  /** Resolves when session.idle fires (or when the subscriber is removed). */
  drained: Promise<void>;
  /** Call to signal that the relay has fully drained for this session. */
  resolveDrained: () => void;
}

interface ServerRelay {
  /** sessionId → subscriber */
  subscribers: Map<string, RunSubscriber>;
  /** The underlying async generator so we can call .return() on close. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generator: AsyncIterator<any> | null;
  /** Set to true when closeServerRelay() is called so the loop exits cleanly. */
  closed: boolean;
  /** True while runRelayLoop is executing (set synchronously to avoid races). */
  loopActive: boolean;
}

// ─── Module-level state ───────────────────────────────────────────────────────

/** One ServerRelay per unique pooled client object reference. */
const serverRelays = new Map<unknown, ServerRelay>();

/** Reverse lookup: sessionId → client (so unsubscribeRun only needs sessionId). */
const sessionToClient = new Map<string, unknown>();

/**
 * Tracks whether a session.error event was seen for a given sessionId.
 * Outlives the subscriber (which is removed on session.idle) so it can be
 * read in the executor's finally block after waitForDrain resolves.
 * Cleaned up in unsubscribeRun() and closeServerRelay().
 */
const sessionErrorFlags = new Map<string, boolean>();

// ─── Translation helpers ──────────────────────────────────────────────────────

/**
 * Translate a single SDK `Part` (from a `message.part.updated` event) into
 * a StreamEvent.  Returns `null` for part types with no frontend equivalent.
 *
 * `toolStates` tracks the last-emitted state for each ToolPart so that we
 * only emit each logical event once (tool call on first `running`, tool result
 * on first `completed` or `error`).
 */
function translatePart(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part: any,
  toolStates: Map<string, string>
): StreamEvent | null {
  switch (part?.type) {
    case 'text': {
      if (part.text) {
        return { type: 'text', data: part.text as string };
      }
      return null;
    }

    case 'tool': {
      const state = part.state as Record<string, unknown>;
      const partId = part.id as string;
      const lastEmitted = toolStates.get(partId);

      if (state.status === 'running' && lastEmitted !== 'running') {
        toolStates.set(partId, 'running');
        const input = state.input;
        const args =
          typeof input === 'object' && input !== null
            ? JSON.stringify(input, null, 2)
            : String(input ?? '');
        return { type: 'tool', data: `[tool: ${part.tool as string}]\n${args}\n` };
      }

      if (state.status === 'completed' && lastEmitted !== 'completed') {
        toolStates.set(partId, 'completed');
        const output = String((state as Record<string, unknown>).output ?? '');
        return { type: 'tool_result', data: `[result]\n${output}\n` };
      }

      if (state.status === 'error' && lastEmitted !== 'error') {
        toolStates.set(partId, 'error');
        const error = String((state as Record<string, unknown>).error ?? '');
        return { type: 'tool_result', data: `[result]\n${error}\n` };
      }

      return null;
    }

    case 'reasoning': {
      // Thinking/reasoning tokens - streamed to frontend but NOT persisted
      if (part.text) {
        return { type: 'thinking', data: part.text as string };
      }
      return null;
    }

    case 'step-start': {
      return { type: 'status', data: '--- step ---\n' };
    }

    case 'step-finish': {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokens = (part.tokens ?? {}) as any;
      const cache = tokens.cache ?? {};
      const total = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0);
      const cost = (part.cost as number) ?? 0;
      // Return stats event with structured data for persistence
      return {
        type: 'stats',
        data: JSON.stringify({
          tokens: {
            input: tokens.input ?? 0,
            output: tokens.output ?? 0,
            reasoning: tokens.reasoning ?? 0,
            cache_read: cache.read ?? 0,
            cache_write: cache.write ?? 0,
            total,
          },
          cost,
        }),
      };
    }

    default:
      return null;
  }
}

// ─── Server relay loop ────────────────────────────────────────────────────────

/**
 * Start the shared event loop for `relay`.  Runs until `relay.closed` is set
 * (via `closeServerRelay`) or the SDK stream closes naturally.
 *
 * Events are dispatched to the matching `RunSubscriber` based on `sessionId`
 * extracted from each SDK event's payload.
 */
async function runRelayLoop(client: unknown, relay: ServerRelay): Promise<void> {
  relay.loopActive = true;
  logger.debug('[relay] Starting relay loop');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;

  let result: { stream: AsyncIterable<{ directory: string; payload: Record<string, unknown> }> };
  try {
    result = await c.global.event();
  } catch (err) {
    logger.error('[opencodeEventRelay] Failed to subscribe to global event stream:', err);
    return;
  }

  // Obtain the underlying iterator so we can call .return() to break cleanly.
  const iter = result.stream[Symbol.asyncIterator]();
  relay.generator = iter;

  try {
    while (!relay.closed) {
      const next = await iter.next();
      if (next.done || relay.closed) {
        break;
      }

      const globalEvent = next.value;
      const payload = globalEvent?.payload;
      if (!payload || typeof payload.type !== 'string') {
        continue;
      }

      console.log(
        `[relay] Event: ${payload.type}`,
        JSON.stringify(payload.properties ?? {}).slice(0, 300)
      );

      switch (payload.type) {
        case 'message.updated': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const props = payload.properties as any;
          const sid = props?.sessionID as string | undefined;
          const info = props?.info;
          if (!sid || !info?.id || typeof info.role !== 'string') {
            break;
          }
          const subscriber = relay.subscribers.get(sid);
          if (!subscriber) {
            break;
          }
          subscriber.messageRoles.set(info.id as string, info.role as string);
          // Track user message ID so we can identify assistant parts before role is known
          if (info.role === 'user') {
            subscriber.userMessageId = info.id as string;
          }
          break;
        }

        case 'message.part.updated': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const part = (payload.properties as any)?.part;
          if (!part || typeof part.sessionID !== 'string') {
            break;
          }

          const subscriber = relay.subscribers.get(part.sessionID as string);
          if (!subscriber) {
            break;
          }

          // Only relay assistant message parts. The SDK sends message.part.updated events
          // BEFORE the message.updated event that establishes the role, so we can't rely
          // on messageRoles. Instead, we track the user message ID and skip parts for it.
          // Any part for a different message is assumed to be from the assistant.
          if (part.messageID === subscriber.userMessageId) {
            break;
          }

          const translated = translatePart(part, subscriber.toolStates);
          if (translated) {
            runStreamStore.push(subscriber.runId, translated);
          }
          break;
        }

        case 'session.error': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const props = payload.properties as any;
          const sid = props?.sessionID as string | undefined;
          if (!sid) {
            break;
          }

          const subscriber = relay.subscribers.get(sid);
          if (!subscriber) {
            break;
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const error = props?.error as any;
          const msg: string =
            error?.data?.message ?? error?.data?.providerID ?? error?.name ?? 'unknown error';
          // Mark that an error was seen — persisted in sessionErrorFlags so the
          // executor can check after waitForDrain (subscriber may be gone by then).
          subscriber.errorSeen = true;
          sessionErrorFlags.set(sid, true);
          runStreamStore.push(subscriber.runId, { type: 'error', data: `[error] ${msg}\n` });
          db.prepare(
            `UPDATE runs SET status = 'failed', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status = 'running'`
          ).run(new Date().toISOString(), subscriber.runId);
          break;
        }

        case 'session.idle': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const props = payload.properties as any;
          const sid = props?.sessionID as string | undefined;
          if (!sid) {
            break;
          }

          const subscriber = relay.subscribers.get(sid);
          if (!subscriber) {
            break;
          }

          // Session is done — resolve the drain promise, then remove the
          // subscriber; the relay loop continues for any remaining sessions.
          subscriber.resolveDrained();
          relay.subscribers.delete(sid);
          sessionToClient.delete(sid);
          break;
        }

        default:
          // All other event types are intentionally ignored.
          break;
      }
    }
  } finally {
    relay.generator = null;
    relay.loopActive = false;
    logger.debug('[relay] Relay loop exited');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a run onto the server relay for `client`.
 *
 * If no relay exists yet for this client, one is started lazily (a single
 * `client.global.event()` subscription is opened in the background).
 *
 * @param client    The OpencodeClient returned by `acquireContext().client`.
 * @param sessionId The SDK session ID whose events should be relayed to `runId`.
 * @param runId     The run ID in the stream store to push translated events to.
 */
export function subscribeRun(client: unknown, sessionId: string, runId: string): void {
  let relay = serverRelays.get(client);

  if (!relay) {
    relay = {
      subscribers: new Map(),
      generator: null,
      closed: false,
      loopActive: false,
    };
    serverRelays.set(client, relay);
  }

  // (Re)start the relay loop if it is not currently running.
  // The loop may have exited because the global event stream closed
  // (network issue, server restart, etc.) — a fresh subscription is needed.
  if (!relay.closed && !relay.loopActive) {
    console.log(
      `[relay] ${serverRelays.has(client) ? 'Restarting' : 'Starting'} relay loop for session ${sessionId} (run ${runId})`
    );
    runRelayLoop(client, relay).catch((err) => {
      logger.error('[opencodeEventRelay] Server relay loop error:', err);
    });
  }

  let resolveDrained!: () => void;
  const drained = new Promise<void>((resolve) => {
    resolveDrained = resolve;
  });

  relay.subscribers.set(sessionId, {
    runId,
    toolStates: new Map(),
    messageRoles: new Map(),
    userMessageId: null,
    errorSeen: false,
    drained,
    resolveDrained,
  });

  sessionToClient.set(sessionId, client);
}

/**
 * Remove a run's subscription from its server relay.
 *
 * Safe to call after the run ends or if `session.idle` was already received
 * (which removes the subscriber internally — this call is then a no-op).
 *
 * @param sessionId The SDK session ID to stop relaying.
 */
export function unsubscribeRun(sessionId: string): void {
  const client = sessionToClient.get(sessionId);
  if (client) {
    const relay = serverRelays.get(client);
    if (relay) {
      relay.subscribers.delete(sessionId);
    }
    sessionToClient.delete(sessionId);
  }
  // Always clean up error flags — session.idle may have already removed
  // the sessionToClient mapping, but the stale flag must not leak to a
  // follow-up run that reuses the same sessionId.
  sessionErrorFlags.delete(sessionId);
}

/**
 * Tear down the shared event subscription for a pooled server.
 *
 * Should be called when the server is evicted from the pool (e.g. on process
 * shutdown via `disposeAll`, or when the server process dies unexpectedly).
 * Any remaining run subscribers are silently dropped.
 *
 * @param client The OpencodeClient whose relay should be closed.
 */
export function closeServerRelay(client: unknown): void {
  const relay = serverRelays.get(client);
  if (!relay) {
    return;
  }

  relay.closed = true;

  // Signal the async iterator to stop if it is currently awaiting the next event.
  if (relay.generator) {
    relay.generator.return?.(undefined);
  }

  // Clean up reverse-lookup entries for all remaining subscribers
  for (const sessionId of relay.subscribers.keys()) {
    sessionToClient.delete(sessionId);
    sessionErrorFlags.delete(sessionId);
  }
  relay.subscribers.clear();

  serverRelays.delete(client);
}

/**
 * Wait until the relay has finished pushing all buffered events for the given
 * session (i.e. until `session.idle` fires), then resolve.
 *
 * Since `prompt()` is non-blocking (returns immediately), this is the actual
 * wait for the LLM to finish responding. There is no timeout — the
 * `session.idle` event from the SDK is the authoritative completion signal.
 * Stuck runs should be cancelled via `cancelRun()`.
 *
 * - If the subscriber is already gone (already drained or manually removed),
 *   resolves immediately.
 *
 * @param sessionId The SDK session ID to wait on.
 */
export function waitForDrain(sessionId: string): Promise<void> {
  const client = sessionToClient.get(sessionId);
  if (!client) {
    return Promise.resolve();
  }

  const relay = serverRelays.get(client);
  const subscriber = relay?.subscribers.get(sessionId);
  if (!subscriber) {
    return Promise.resolve();
  }

  return subscriber.drained;
}

/**
 * Returns true if a `session.error` event was received for the given session
 * during its lifetime.
 *
 * Safe to call after `waitForDrain` resolves — the flag is stored in a
 * module-level map that outlives the subscriber (which is removed on
 * `session.idle`).  The flag is cleaned up in `unsubscribeRun`.
 *
 * @param sessionId The SDK session ID to check.
 */
export function hadErrors(sessionId: string): boolean {
  return sessionErrorFlags.get(sessionId) ?? false;
}

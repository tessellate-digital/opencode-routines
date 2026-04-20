/**
 * Unit tests for opencodeEventRelay — drain mechanism and role-based filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock runStreamStore ──────────────────────────────────────────────────────

vi.mock('../runStreamStore', () => ({
  push: vi.fn(),
}));

vi.mock('../../database', () => ({
  db: {
    prepare: vi.fn(() => ({ run: vi.fn() })),
  },
}));

// ─── Import module under test ─────────────────────────────────────────────────

import { subscribeRun, unsubscribeRun, waitForDrain, hadErrors } from '../opencodeEventRelay';
import * as runStreamStore from '../runStreamStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a fake client with a controllable global.event() stream. */
function makeFakeClient(events: Array<{ directory: string; payload: Record<string, unknown> }>) {
  let resolve: (
    val: IteratorResult<{ directory: string; payload: Record<string, unknown> }>
  ) => void;

  // Simple async iterable that yields events one by one on demand
  const queue: Array<{ directory: string; payload: Record<string, unknown> }> = [...events];

  const iter: AsyncIterator<{ directory: string; payload: Record<string, unknown> }> = {
    next: vi.fn(async () => {
      if (queue.length > 0) {
        return { value: queue.shift()!, done: false };
      }
      // Block forever (simulates open stream)
      return new Promise<IteratorResult<{ directory: string; payload: Record<string, unknown> }>>(
        (r) => {
          resolve = r;
        }
      );
    }),
    return: vi.fn(async () => {
      if (resolve) {
        resolve({ value: undefined as any, done: true });
      }
      return { value: undefined as any, done: true };
    }),
  };

  const asyncIterable = {
    [Symbol.asyncIterator]: () => iter,
  };

  return {
    global: {
      event: vi.fn(async () => ({ stream: asyncIterable })),
    },
    _resolve: (v: { directory: string; payload: Record<string, unknown> }) => {
      if (resolve) {
        resolve({ value: v, done: false });
      }
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('waitForDrain', () => {
  it('resolves immediately if the subscriber does not exist (already gone)', async () => {
    await expect(waitForDrain('non-existent-session')).resolves.toBeUndefined();
  });

  it('resolves when session.idle fires for the subscribed sessionId', async () => {
    const sessionId = 'session-drain-test-1';
    const runId = 'run-drain-test-1';

    const idleEvent = {
      directory: '',
      payload: {
        type: 'session.idle',
        properties: { sessionID: sessionId },
      },
    };

    const client = makeFakeClient([idleEvent]);

    subscribeRun(client, sessionId, runId);

    // waitForDrain should resolve after session.idle propagates through the relay loop
    await expect(waitForDrain(sessionId, 2_000)).resolves.toBeUndefined();
  });

  it('resolves immediately if subscriber was manually unsubscribed before waitForDrain', async () => {
    const sessionId = 'session-drain-test-2';
    const runId = 'run-drain-test-2';

    // Use a client that never emits (open stream, no events)
    const client = makeFakeClient([]);

    subscribeRun(client, sessionId, runId);
    unsubscribeRun(sessionId);

    // Subscriber is already gone — should resolve immediately
    await expect(waitForDrain(sessionId, 2_000)).resolves.toBeUndefined();
  });

  it('stays pending when session.idle never fires (no timeout)', async () => {
    const sessionId = 'session-drain-test-3';
    const runId = 'run-drain-test-3';

    const client = makeFakeClient([]); // no events ever

    subscribeRun(client, sessionId, runId);

    let resolved = false;
    waitForDrain(sessionId).then(() => {
      resolved = true;
    });

    // Give it a tick — should NOT resolve without session.idle
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);
  });
});

// ─── Role-based filtering via message.updated tracking ───────────────────────

describe('message.part.updated role filtering (via message.updated map)', () => {
  function makeMessageUpdatedEvent(sid: string, msgId: string, role: 'user' | 'assistant') {
    return {
      directory: '',
      payload: {
        type: 'message.updated',
        properties: {
          sessionID: sid,
          info: { id: msgId, sessionID: sid, role },
        },
      },
    };
  }

  function makeTextPartEvent(sid: string, msgId: string) {
    return {
      directory: '',
      payload: {
        type: 'message.part.updated',
        properties: {
          sessionID: sid,
          part: {
            id: 'part-1',
            sessionID: sid,
            messageID: msgId,
            type: 'text',
            text: 'hello from LLM',
          },
          time: Date.now(),
        },
      },
    };
  }

  it('does NOT forward text parts when message.updated marks role = "user"', async () => {
    const sid = 'session-role-new-1';
    const client = makeFakeClient([
      makeMessageUpdatedEvent(sid, 'msg-u1', 'user'),
      makeTextPartEvent(sid, 'msg-u1'),
    ]);
    subscribeRun(client, sid, 'run-role-new-1');
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(runStreamStore.push)).not.toHaveBeenCalled();
    unsubscribeRun(sid);
  });

  it('DOES forward text parts when message.updated marks role = "assistant"', async () => {
    const sid = 'session-role-new-2';
    const client = makeFakeClient([
      makeMessageUpdatedEvent(sid, 'msg-a1', 'assistant'),
      makeTextPartEvent(sid, 'msg-a1'),
    ]);
    subscribeRun(client, sid, 'run-role-new-2');
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(runStreamStore.push)).toHaveBeenCalledWith(
      'run-role-new-2',
      expect.objectContaining({ type: 'text', data: 'hello from LLM' })
    );
    unsubscribeRun(sid);
  });

  it('DOES forward text parts when no userMessageId is set (assumes assistant)', async () => {
    // With the new logic, parts are forwarded unless they match userMessageId.
    // If userMessageId is null (no user message.updated received yet), parts are forwarded.
    // This handles the case where assistant parts arrive before message.updated.
    const sid = 'session-role-new-3';
    const client = makeFakeClient([makeTextPartEvent(sid, 'msg-unknown')]);
    subscribeRun(client, sid, 'run-role-new-3');
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(runStreamStore.push)).toHaveBeenCalledWith(
      'run-role-new-3',
      expect.objectContaining({ type: 'text', data: 'hello from LLM' })
    );
    unsubscribeRun(sid);
  });
});

// ─── hadErrors ────────────────────────────────────────────────────────────────

describe('hadErrors', () => {
  it('returns false for a session that never had a session.error event', async () => {
    const sid = 'session-haderrors-1';
    const client = makeFakeClient([]);
    subscribeRun(client, sid, 'run-haderrors-1');
    expect(hadErrors(sid)).toBe(false);
    unsubscribeRun(sid);
  });

  it('returns false for a session that was never subscribed', () => {
    expect(hadErrors('session-never-existed')).toBe(false);
  });

  it('returns true after a session.error event fires for the session', async () => {
    const sid = 'session-haderrors-2';
    const errorEvent = {
      directory: '',
      payload: {
        type: 'session.error',
        properties: {
          sessionID: sid,
          error: { name: 'TestError', data: { message: 'something went wrong' } },
        },
      },
    };
    const client = makeFakeClient([errorEvent]);
    subscribeRun(client, sid, 'run-haderrors-2');
    // Give the relay loop time to process the session.error event
    await new Promise((r) => setTimeout(r, 50));
    expect(hadErrors(sid)).toBe(true);
    unsubscribeRun(sid);
  });

  it('returns false after unsubscribeRun cleans up the session', async () => {
    const sid = 'session-haderrors-3';
    const errorEvent = {
      directory: '',
      payload: {
        type: 'session.error',
        properties: {
          sessionID: sid,
          error: { name: 'TestError', data: { message: 'boom' } },
        },
      },
    };
    const client = makeFakeClient([errorEvent]);
    subscribeRun(client, sid, 'run-haderrors-3');
    await new Promise((r) => setTimeout(r, 50));
    // Flag is set
    expect(hadErrors(sid)).toBe(true);
    // After unsubscribe, flag is cleaned up
    unsubscribeRun(sid);
    expect(hadErrors(sid)).toBe(false);
  });
});

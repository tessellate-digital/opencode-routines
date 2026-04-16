/**
 * Integration tests for POST /api/runs/:id/reply using the actual Hono route handler.
 *
 * Uses vi.hoisted() so the DB/executor/eventBus mocks are accessible inside vi.mock()
 * factories (which are hoisted before variable declarations).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted shared state & mocks ────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const runsById: Record<string, unknown> = {};
  const routinesById: Record<string, unknown> = {};

  return {
    db: { runsById, routinesById },
    dbInsertRun: vi.fn(),
    startRun: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
    connectStream: vi.fn().mockReturnValue(null),
    getHistory: vi.fn().mockReturnValue([]),
    broadcast: vi.fn(),
  };
});

vi.mock('../../../src/database', () => ({
  db: {
    prepare: (sql: string) => ({
      get: (id: unknown) => {
        if (sql.includes('FROM runs WHERE')) {
          return mocks.db.runsById[id as string];
        }
        if (sql.includes('FROM routines WHERE')) {
          return mocks.db.routinesById[id as string];
        }
        return undefined;
      },
      run: () => {
        if (sql.includes('INSERT INTO runs')) {
          mocks.dbInsertRun();
        }
      },
      all: vi.fn(() => []),
    }),
  },
}));

vi.mock('../../../src/services/executor', () => ({
  executor: {
    startRun: mocks.startRun,
    cancelRun: mocks.cancelRun,
    connectStream: mocks.connectStream,
    getHistory: mocks.getHistory,
  },
}));

vi.mock('../../../src/services/eventBus', () => ({
  eventBus: { broadcast: mocks.broadcast },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRun(
  overrides: Partial<{
    id: string;
    routine_id: string;
    routine_name: string;
    trigger_id: string | null;
    trigger_type: string;
    prompt: string;
    parent_run_id: string | null;
    session_id: string | null;
    assistant_message_id: string | null;
    status: string;
    started_at: string | null;
    finished_at: string | null;
    exit_code: number | null;
    stdout: string;
    stderr: string;
    metadata: string;
    created_at: string;
  }> = {}
) {
  return {
    id: 'run-1',
    routine_id: 'routine-1',
    routine_name: 'Test Routine',
    trigger_id: null,
    trigger_type: 'manual',
    prompt: 'original question',
    parent_run_id: null,
    session_id: null,
    assistant_message_id: null,
    status: 'success',
    started_at: '2024-01-01T00:00:00.000Z',
    finished_at: '2024-01-01T00:01:00.000Z',
    exit_code: null,
    stdout: '',
    stderr: '',
    metadata: '{}',
    created_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRoutine(
  overrides: Partial<{
    id: string;
    name: string;
    description: string;
    prompt: string;
    model: string;
    repository: string;
    branch: string;
    agent: string;
    env_vars: string;
    enabled: number;
    run_mode: string;
    workspace_path: string;
    created_at: string;
    updated_at: string;
  }> = {}
) {
  return {
    id: 'routine-1',
    name: 'Test Routine',
    description: '',
    prompt: 'base prompt',
    model: '',
    repository: '',
    branch: 'main',
    agent: 'build',
    env_vars: '{}',
    enabled: 1,
    run_mode: 'background',
    workspace_path: '',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Build the Hono test app lazily (after mocks are registered)
async function buildApp() {
  const { default: runsRouter } = await import('../../../src/routes/runs');
  const app = new Hono().route('/', runsRouter);
  return app;
}

async function postReply(runId: string, text: string) {
  const app = await buildApp();
  return app.request(`/${runId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startRun.mockResolvedValue(undefined);
  mocks.cancelRun.mockResolvedValue(undefined);
  // Clear DB state
  for (const k of Object.keys(mocks.db.runsById)) {
    delete mocks.db.runsById[k];
  }
  for (const k of Object.keys(mocks.db.routinesById)) {
    delete mocks.db.routinesById[k];
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('POST /:id/reply — SDK-backed run (session_id IS NOT NULL)', () => {
  it('returns 202 with a run_id and calls startRun with existing session_id', async () => {
    const run = makeRun({ session_id: 'sdk-session-abc', status: 'success' });
    const routine = makeRoutine();
    mocks.db.runsById['run-1'] = run;
    mocks.db.routinesById['routine-1'] = routine;

    const res = await postReply('run-1', 'follow-up question');

    expect(res.status).toBe(202);
    const body = (await res.json()) as { run_id: string };
    expect(body.run_id).toBeTypeOf('string');

    expect(mocks.startRun).toHaveBeenCalledOnce();
    const [, , calledPrompt, calledSessionId] = mocks.startRun.mock.calls[0];
    // Only the new user text — no stdout history reconstruction
    expect(calledPrompt).toBe('follow-up question');
    // Existing session_id passed through
    expect(calledSessionId).toBe('sdk-session-abc');
  });

  it('does NOT include stdout content in the prompt for SDK-backed runs', async () => {
    const run = makeRun({
      session_id: 'sdk-session-abc',
      status: 'success',
      stdout: [
        JSON.stringify({ type: 'text', data: 'old answer part 1' }),
        JSON.stringify({ type: 'text', data: 'old answer part 2' }),
      ].join('\n'),
    });
    mocks.db.runsById['run-1'] = run;
    mocks.db.routinesById['routine-1'] = makeRoutine();

    await postReply('run-1', 'my follow-up');

    const [, , calledPrompt] = mocks.startRun.mock.calls[0];
    expect(calledPrompt).toBe('my follow-up');
    expect(calledPrompt).not.toContain('old answer');
  });
});

describe('POST /:id/reply — Legacy run (session_id IS NULL)', () => {
  it('calls startRun WITHOUT a session_id (starts fresh session)', async () => {
    const run = makeRun({ session_id: null, status: 'success' });
    mocks.db.runsById['run-1'] = run;
    mocks.db.routinesById['routine-1'] = makeRoutine();

    await postReply('run-1', 'follow-up');

    expect(mocks.startRun).toHaveBeenCalledOnce();
    const [, , , calledSessionId] = mocks.startRun.mock.calls[0];
    expect(calledSessionId).toBeUndefined();
  });

  it('includes a legacy transcript seed in the prompt', async () => {
    const run = makeRun({
      session_id: null,
      status: 'success',
      prompt: 'tell me about cats',
      stdout: JSON.stringify({ type: 'text', data: 'Cats are mammals.' }),
    });
    mocks.db.runsById['run-1'] = run;
    mocks.db.routinesById['routine-1'] = makeRoutine();

    await postReply('run-1', 'what about dogs?');

    const [, , calledPrompt] = mocks.startRun.mock.calls[0];
    expect(calledPrompt).toContain('Legacy conversation transcript:');
    expect(calledPrompt).toContain('User: tell me about cats');
    expect(calledPrompt).toContain('Assistant: Cats are mammals.');
    expect(calledPrompt).toContain('what about dogs?');
  });

  it('walks a multi-hop parent_run_id chain (2 runs) and includes both turns in transcript', async () => {
    // run-2 is replied to; run-1 is its parent (no session_id on either)
    const run1 = makeRun({
      id: 'run-1',
      session_id: null,
      status: 'success',
      prompt: 'first question',
      parent_run_id: null,
      stdout: JSON.stringify({ type: 'text', data: 'First answer.' }),
    });
    const run2 = makeRun({
      id: 'run-2',
      session_id: null,
      status: 'success',
      prompt: 'second question',
      parent_run_id: 'run-1',
      stdout: JSON.stringify({ type: 'text', data: 'Second answer.' }),
    });
    mocks.db.runsById['run-1'] = run1;
    mocks.db.runsById['run-2'] = run2;
    mocks.db.routinesById['routine-1'] = makeRoutine();

    await postReply('run-2', 'third question');

    const [, , calledPrompt] = mocks.startRun.mock.calls[0];
    // Should include BOTH prior turns in the transcript
    expect(calledPrompt).toContain('User: first question');
    expect(calledPrompt).toContain('Assistant: First answer.');
    expect(calledPrompt).toContain('User: second question');
    expect(calledPrompt).toContain('Assistant: Second answer.');
    expect(calledPrompt).toContain('third question');
  });

  it('falls back gracefully when legacy chain has no assistant text', async () => {
    const run = makeRun({
      session_id: null,
      status: 'failed',
      prompt: 'do something',
      stdout: '', // no output
    });
    mocks.db.runsById['run-1'] = run;
    mocks.db.routinesById['routine-1'] = makeRoutine();

    const res = await postReply('run-1', 'try again');

    expect(res.status).toBe(202);
    const [, , calledPrompt] = mocks.startRun.mock.calls[0];
    expect(calledPrompt).toContain('Legacy conversation transcript:');
    expect(calledPrompt).toContain('User: do something');
    expect(calledPrompt).toContain('try again');
  });
});

describe('POST /:id/reply — error cases', () => {
  it('returns 404 when run does not exist', async () => {
    // runsById is empty
    const res = await postReply('nonexistent', 'hello');
    expect(res.status).toBe(404);
  });

  it('returns 409 when run is not finished (status = running)', async () => {
    const run = makeRun({ status: 'running', session_id: null });
    mocks.db.runsById['run-1'] = run;

    const res = await postReply('run-1', 'hello');
    expect(res.status).toBe(409);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it('returns 404 when routine is missing', async () => {
    const run = makeRun({ session_id: null, status: 'success' });
    mocks.db.runsById['run-1'] = run;
    // routinesById has no 'routine-1'

    const res = await postReply('run-1', 'hello');
    expect(res.status).toBe(404);
    expect(mocks.startRun).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  runs: {} as Record<string, unknown>,
  routines: {} as Record<string, unknown>,
  createdRun: null as unknown,
  markedAsLost: null as string | null,
  startRun: vi.fn().mockResolvedValue(undefined),
  cancelRun: vi.fn().mockResolvedValue(undefined),
  connectStream: vi.fn().mockReturnValue(null),
  getHistory: vi.fn().mockReturnValue([]),
  broadcast: vi.fn(),
}));

vi.mock('../../repositories/runsRepository', () => ({
  runsRepository: {
    findById: (id: string) => mocks.runs[id],
    findAll: (filters: { limit: number; offset: number }) =>
      Object.values(mocks.runs).slice(filters.offset, filters.offset + filters.limit),
    findParentChain: (id: string) => {
      const run = mocks.runs[id];
      if (!run) {
        return [];
      }
      const chain = [run];
      let cur = run as any;
      while (cur.parent_run_id && mocks.runs[cur.parent_run_id]) {
        const parent = mocks.runs[cur.parent_run_id];
        chain.unshift(parent);
        cur = parent;
      }
      return chain;
    },
    getRoutineName: (routineId: string) => (mocks.routines[routineId] as any)?.name ?? '',
    markAsLost: (id: string) => {
      mocks.markedAsLost = id;
    },
    create: (params: unknown) => {
      mocks.createdRun = params;
    },
  },
}));

vi.mock('../../repositories/routinesRepository', () => ({
  routinesRepository: {
    findById: (id: string) => mocks.routines[id],
  },
}));

vi.mock('../../services/executor', () => ({
  executor: {
    startRun: mocks.startRun,
    cancelRun: mocks.cancelRun,
    connectStream: mocks.connectStream,
    getHistory: mocks.getHistory,
  },
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: { broadcast: mocks.broadcast },
}));

vi.mock('../../services/runStreamStore', () => ({
  openRun: vi.fn(),
}));

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    routine_id: 'routine-1',
    routine_name: 'Test Routine',
    trigger_id: null,
    trigger_type: 'manual',
    prompt: 'Do something',
    parent_run_id: null,
    session_id: 'session-1',
    status: 'success',
    started_at: '2024-01-01T00:00:00.000Z',
    finished_at: '2024-01-01T00:01:00.000Z',
    exit_code: 0,
    stdout: '',
    stderr: '',
    metadata: '{}',
    created_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRoutine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'routine-1',
    name: 'Test Routine',
    prompt: 'Do something',
    ...overrides,
  };
}

async function buildApp() {
  const { default: runsRouter } = await import('../runs');
  return new Hono().route('/', runsRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.runs)) {
    delete mocks.runs[k];
  }
  for (const k of Object.keys(mocks.routines)) {
    delete mocks.routines[k];
  }
  mocks.createdRun = null;
  mocks.markedAsLost = null;
});

describe('GET /', () => {
  it('returns all runs', async () => {
    mocks.runs['run-1'] = makeRun();
    mocks.runs['run-2'] = makeRun({ id: 'run-2' });

    const app = await buildApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });

  it('respects limit and offset', async () => {
    mocks.runs['run-1'] = makeRun();
    mocks.runs['run-2'] = makeRun({ id: 'run-2' });
    mocks.runs['run-3'] = makeRun({ id: 'run-3' });

    const app = await buildApp();
    const res = await app.request('/?limit=2&offset=1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });
});

describe('GET /:id', () => {
  it('returns run when found', async () => {
    mocks.runs['run-1'] = makeRun();

    const app = await buildApp();
    const res = await app.request('/run-1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('run-1');
  });

  it('returns 404 when not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent');

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/cancel', () => {
  it('cancels a running run', async () => {
    mocks.runs['run-1'] = makeRun({ status: 'running' });

    const app = await buildApp();
    const res = await app.request('/run-1/cancel', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mocks.cancelRun).toHaveBeenCalledWith('run-1');
  });

  it('returns 404 when run not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent/cancel', { method: 'POST' });

    expect(res.status).toBe(404);
  });

  it('returns success for already cancelled run (idempotent)', async () => {
    mocks.runs['run-1'] = makeRun({ status: 'cancelled' });

    const app = await buildApp();
    const res = await app.request('/run-1/cancel', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('cancelled');
  });

  it('returns 409 for already finished run', async () => {
    mocks.runs['run-1'] = makeRun({ status: 'success' });

    const app = await buildApp();
    const res = await app.request('/run-1/cancel', { method: 'POST' });

    expect(res.status).toBe(409);
  });
});

describe('GET /:id/thread', () => {
  it('returns thread with parent chain', async () => {
    mocks.runs['run-1'] = makeRun({ id: 'run-1', parent_run_id: null });
    mocks.runs['run-2'] = makeRun({ id: 'run-2', parent_run_id: 'run-1' });

    const app = await buildApp();
    const res = await app.request('/run-2/thread');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe('run-1');
    expect(body[1].id).toBe('run-2');
  });

  it('returns 404 when run not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent/thread');

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/reply', () => {
  it('creates a reply run for SDK-backed run', async () => {
    mocks.runs['run-1'] = makeRun({ session_id: 'session-abc', status: 'success' });
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/run-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'follow up' }),
    });

    expect(res.status).toBe(202);
    expect(mocks.createdRun).not.toBeNull();
    expect(mocks.startRun).toHaveBeenCalled();
  });

  it('returns 400 when run has no session', async () => {
    mocks.runs['run-1'] = makeRun({ session_id: null, status: 'success' });
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/run-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'follow up' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 409 when run is not finished', async () => {
    mocks.runs['run-1'] = makeRun({ status: 'running', session_id: 'session-1' });

    const app = await buildApp();
    const res = await app.request('/run-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'follow up' }),
    });

    expect(res.status).toBe(409);
  });
});

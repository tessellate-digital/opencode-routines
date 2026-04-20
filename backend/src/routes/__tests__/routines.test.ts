import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  routines: {} as Record<string, unknown>,
  createdRoutine: null as unknown,
  updatedRoutine: null as unknown,
  deletedId: null as string | null,
  createdRun: null as unknown,
  startRun: vi.fn().mockResolvedValue(undefined),
  broadcast: vi.fn(),
}));

vi.mock('../../repositories/routinesRepository', () => ({
  routinesRepository: {
    findById: (id: string) => mocks.routines[id],
    findAll: () => Object.values(mocks.routines),
    create: (id: string, data: any) => {
      mocks.createdRoutine = {
        id,
        name: data.name,
        description: data.description ?? '',
        prompt: data.prompt,
        model: data.model ?? '',
        repository: data.repository ?? '',
        branch: data.branch ?? 'main',
        agent: data.agent ?? 'build',
        env_vars: JSON.stringify(data.env_vars ?? {}),
        enabled: data.enabled ? 1 : 0,
        run_mode: data.run_mode ?? 'background',
        workspace_path: data.workspace_path ?? '',
        last_run_status: null,
        triggers_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mocks.routines[id] = mocks.createdRoutine;
      return mocks.createdRoutine;
    },
    update: (id: string, data: unknown) => {
      mocks.updatedRoutine = { ...mocks.routines[id], ...data };
      mocks.routines[id] = mocks.updatedRoutine;
      return mocks.updatedRoutine;
    },
    delete: (id: string) => {
      mocks.deletedId = id;
      delete mocks.routines[id];
    },
  },
}));

vi.mock('../../repositories/runsRepository', () => ({
  runsRepository: {
    create: (params: unknown) => {
      mocks.createdRun = params;
    },
  },
}));

vi.mock('../../services/executor', () => ({
  executor: {
    startRun: mocks.startRun,
  },
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: { broadcast: mocks.broadcast },
}));

vi.mock('../../services/runStreamStore', () => ({
  openRun: vi.fn(),
}));

function makeRoutine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'routine-1',
    name: 'Test Routine',
    description: 'A test routine',
    prompt: 'Do something',
    model: '',
    repository: '',
    branch: 'main',
    agent: 'build',
    env_vars: '{}',
    enabled: 1,
    run_mode: 'background',
    workspace_path: '',
    last_run_status: null,
    triggers_count: 0,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function buildApp() {
  const { default: routinesRouter } = await import('../routines');
  return new Hono().route('/', routinesRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.routines)) {
    delete mocks.routines[k];
  }
  mocks.createdRoutine = null;
  mocks.updatedRoutine = null;
  mocks.deletedId = null;
  mocks.createdRun = null;
});

describe('GET /', () => {
  it('returns all routines', async () => {
    mocks.routines['routine-1'] = makeRoutine();
    mocks.routines['routine-2'] = makeRoutine({ id: 'routine-2', name: 'Second' });

    const app = await buildApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });

  it('returns empty array when no routines', async () => {
    const app = await buildApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(0);
  });
});

describe('GET /:id', () => {
  it('returns routine when found', async () => {
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/routine-1');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe('routine-1');
    expect(body.name).toBe('Test Routine');
  });

  it('returns 404 when not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent');

    expect(res.status).toBe(404);
  });
});

describe('POST /', () => {
  it('creates a routine and returns 201', async () => {
    const app = await buildApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Routine',
        prompt: 'Do something new',
      }),
    });

    expect(res.status).toBe(201);
    expect(mocks.createdRoutine).not.toBeNull();
    expect(mocks.broadcast).toHaveBeenCalledWith('routine_created', expect.any(Object));
  });

  it('returns 400 for invalid data', async () => {
    const app = await buildApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('PUT /:id', () => {
  it('updates routine and returns updated data', async () => {
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/routine-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    expect(res.status).toBe(200);
    expect(mocks.broadcast).toHaveBeenCalledWith('routine_updated', expect.any(Object));
  });

  it('returns 404 when routine not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /:id', () => {
  it('deletes routine and returns 204', async () => {
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/routine-1', { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(mocks.deletedId).toBe('routine-1');
    expect(mocks.broadcast).toHaveBeenCalledWith('routine_deleted', { routine_id: 'routine-1' });
  });

  it('returns 404 when routine not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });
});

describe('POST /:id/run', () => {
  it('creates a run and returns 202', async () => {
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/routine-1/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { run_id: string };
    expect(body.run_id).toBeDefined();
    expect(mocks.createdRun).not.toBeNull();
    expect(mocks.startRun).toHaveBeenCalled();
  });

  it('returns 404 when routine not found', async () => {
    const app = await buildApp();
    const res = await app.request('/nonexistent/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(404);
  });
});

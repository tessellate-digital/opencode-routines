import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  triggers: {} as Record<string, unknown>,
  routines: {} as Record<string, unknown>,
  createdTrigger: null as unknown,
  updatedTrigger: null as unknown,
  deletedId: null as string | null,
  registerTrigger: vi.fn(),
  unregisterTrigger: vi.fn(),
}));

vi.mock('../../repositories/triggersRepository', () => ({
  triggersRepository: {
    findById: (id: string) => mocks.triggers[id],
    findByRoutineId: (routineId: string) =>
      Object.values(mocks.triggers).filter((t: any) => t.routine_id === routineId),
    findEnabled: (type?: string) =>
      Object.values(mocks.triggers).filter(
        (t: any) => t.enabled === 1 && (!type || t.type === type)
      ),
    routineExists: (id: string) => !!mocks.routines[id],
    create: (id: string, routineId: string, data: any, config: unknown) => {
      mocks.createdTrigger = {
        id,
        routine_id: routineId,
        type: data.type,
        config: JSON.stringify(config),
        enabled: data.enabled ? 1 : 0,
        created_at: new Date().toISOString(),
      };
      mocks.triggers[id] = mocks.createdTrigger;
      return mocks.createdTrigger;
    },
    update: (id: string, data: any) => {
      const existing = mocks.triggers[id] as any;
      mocks.updatedTrigger = {
        ...existing,
        ...(data.config !== undefined && { config: JSON.stringify(data.config) }),
        ...(data.enabled !== undefined && { enabled: data.enabled ? 1 : 0 }),
      };
      mocks.triggers[id] = mocks.updatedTrigger;
      return mocks.updatedTrigger;
    },
    delete: (id: string) => {
      mocks.deletedId = id;
      delete mocks.triggers[id];
    },
  },
}));

vi.mock('../../repositories/routinesRepository', () => ({
  routinesRepository: {
    findById: (id: string) => mocks.routines[id],
  },
}));

vi.mock('../../services/scheduler', () => ({
  schedulerService: {
    registerTrigger: mocks.registerTrigger,
    unregisterTrigger: mocks.unregisterTrigger,
  },
}));

function makeTrigger(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'trigger-1',
    routine_id: 'routine-1',
    type: 'cron',
    config: JSON.stringify({ schedule: '0 * * * *' }),
    enabled: 1,
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
  const { default: triggersRouter } = await import('../triggers');
  return new Hono().route('/', triggersRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.triggers)) {
    delete mocks.triggers[k];
  }
  for (const k of Object.keys(mocks.routines)) {
    delete mocks.routines[k];
  }
  mocks.createdTrigger = null;
  mocks.updatedTrigger = null;
  mocks.deletedId = null;
});

describe('GET /triggers', () => {
  it('returns all enabled triggers', async () => {
    mocks.triggers['trigger-1'] = makeTrigger();
    mocks.triggers['trigger-2'] = makeTrigger({ id: 'trigger-2', enabled: 0 });

    const app = await buildApp();
    const res = await app.request('/triggers');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  it('filters by type', async () => {
    mocks.triggers['trigger-1'] = makeTrigger({ type: 'cron' });
    mocks.triggers['trigger-2'] = makeTrigger({ id: 'trigger-2', type: 'api' });

    const app = await buildApp();
    const res = await app.request('/triggers?type=cron');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe('GET /routines/:routineId/triggers', () => {
  it('returns triggers for a routine', async () => {
    mocks.routines['routine-1'] = makeRoutine();
    mocks.triggers['trigger-1'] = makeTrigger();

    const app = await buildApp();
    const res = await app.request('/routines/routine-1/triggers');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  it('returns 404 when routine not found', async () => {
    const app = await buildApp();
    const res = await app.request('/routines/nonexistent/triggers');

    expect(res.status).toBe(404);
  });
});

describe('POST /routines/:routineId/triggers', () => {
  it('creates a trigger and returns 201', async () => {
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/routines/routine-1/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'cron',
        config: { schedule: '0 * * * *' },
        enabled: true,
      }),
    });

    expect(res.status).toBe(201);
    expect(mocks.createdTrigger).not.toBeNull();
    expect(mocks.registerTrigger).toHaveBeenCalled();
  });

  it('generates token for api triggers', async () => {
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/routines/routine-1/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'api',
        config: {},
        enabled: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { config: { token: string } };
    expect(body.config.token).toBeDefined();
  });

  it('returns 404 when routine not found', async () => {
    const app = await buildApp();
    const res = await app.request('/routines/nonexistent/triggers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'cron', config: {}, enabled: true }),
    });

    expect(res.status).toBe(404);
  });
});

describe('PUT /triggers/:triggerId', () => {
  it('updates trigger and returns updated data', async () => {
    mocks.triggers['trigger-1'] = makeTrigger();
    mocks.routines['routine-1'] = makeRoutine();

    const app = await buildApp();
    const res = await app.request('/triggers/trigger-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(mocks.unregisterTrigger).toHaveBeenCalledWith('trigger-1');
  });

  it('returns 404 when trigger not found', async () => {
    const app = await buildApp();
    const res = await app.request('/triggers/nonexistent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(404);
  });
});

describe('DELETE /triggers/:triggerId', () => {
  it('deletes trigger and returns 204', async () => {
    mocks.triggers['trigger-1'] = makeTrigger();

    const app = await buildApp();
    const res = await app.request('/triggers/trigger-1', { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(mocks.deletedId).toBe('trigger-1');
    expect(mocks.unregisterTrigger).toHaveBeenCalledWith('trigger-1');
  });

  it('returns 404 when trigger not found', async () => {
    const app = await buildApp();
    const res = await app.request('/triggers/nonexistent', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });
});

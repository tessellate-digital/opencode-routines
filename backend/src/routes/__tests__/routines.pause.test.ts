import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  routines: {} as Record<string, unknown>,
  runs: [] as Array<{ id: string; routine_id: string; status: string }>,
  cancelRun: vi.fn().mockResolvedValue(undefined),
  broadcast: vi.fn(),
}));

vi.mock('../../repositories/routinesRepository', () => ({
  routinesRepository: {
    findById: (id: string) => mocks.routines[id],
    findAll: () => Object.values(mocks.routines),
    create: vi.fn(),
    update: (id: string, data: any) => {
      const existing = mocks.routines[id] as any;
      const updated = {
        ...existing,
        ...(data.enabled !== undefined && { enabled: data.enabled ? 1 : 0 }),
        updated_at: new Date().toISOString(),
      };
      mocks.routines[id] = updated;
      return updated;
    },
    delete: vi.fn(),
  },
}));

vi.mock('../../repositories/runsRepository', () => ({
  runsRepository: {
    findRunningByRoutineId: (routineId: string) =>
      mocks.runs.filter(
        (r) => r.routine_id === routineId && (r.status === 'running' || r.status === 'pending')
      ),
  },
}));

vi.mock('../../services/executor', () => ({
  executor: {
    cancelRun: mocks.cancelRun,
    startRun: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/eventBus', () => ({
  eventBus: { broadcast: mocks.broadcast },
}));

vi.mock('../../services/runStreamStore', () => ({
  openRun: vi.fn(),
  close: vi.fn(),
}));

function makeRoutine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'routine-1',
    name: 'Test Routine',
    description: '',
    prompt: 'Do stuff',
    model: '',
    repository: '',
    branch: 'main',
    agent: '',
    env_vars: '{}',
    enabled: 1,
    run_mode: 'foreground',
    workspace_path: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    triggers_count: 0,
    last_run_status: null,
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
  mocks.runs.length = 0;
});

describe('PUT /:id — pause cancels active runs', () => {
  it('cancels running runs when disabling a routine', async () => {
    mocks.routines['routine-1'] = makeRoutine({ enabled: 1 });
    mocks.runs.push(
      { id: 'run-1', routine_id: 'routine-1', status: 'running' },
      { id: 'run-2', routine_id: 'routine-1', status: 'pending' }
    );

    const app = await buildApp();
    const res = await app.request('/routine-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(mocks.cancelRun).toHaveBeenCalledTimes(2);
    expect(mocks.cancelRun).toHaveBeenCalledWith('run-1');
    expect(mocks.cancelRun).toHaveBeenCalledWith('run-2');
  });

  it('does not cancel runs when enabling a routine', async () => {
    mocks.routines['routine-1'] = makeRoutine({ enabled: 0 });

    const app = await buildApp();
    const res = await app.request('/routine-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    expect(res.status).toBe(200);
    expect(mocks.cancelRun).not.toHaveBeenCalled();
  });

  it('does not cancel runs when already disabled', async () => {
    mocks.routines['routine-1'] = makeRoutine({ enabled: 0 });

    const app = await buildApp();
    const res = await app.request('/routine-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(mocks.cancelRun).not.toHaveBeenCalled();
  });

  it('does not cancel runs when update has no enabled field', async () => {
    mocks.routines['routine-1'] = makeRoutine({ enabled: 1 });
    mocks.runs.push({ id: 'run-1', routine_id: 'routine-1', status: 'running' });

    const app = await buildApp();
    const res = await app.request('/routine-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });

    expect(res.status).toBe(200);
    expect(mocks.cancelRun).not.toHaveBeenCalled();
  });

  it('does not cancel runs from other routines', async () => {
    mocks.routines['routine-1'] = makeRoutine({ enabled: 1 });
    mocks.runs.push({ id: 'run-99', routine_id: 'routine-2', status: 'running' });

    const app = await buildApp();
    const res = await app.request('/routine-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(mocks.cancelRun).not.toHaveBeenCalled();
  });
});

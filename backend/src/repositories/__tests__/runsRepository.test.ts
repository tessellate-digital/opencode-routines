import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const rows: Record<string, unknown> = {};
  const routineRows: Record<string, unknown> = {};
  const insertedRuns: unknown[][] = [];

  return {
    rows,
    routineRows,
    insertedRuns,
  };
});

vi.mock('../../database', () => ({
  db: {
    prepare: (sql: string) => ({
      get: (id: unknown) => {
        if (sql.includes('FROM runs WHERE')) {
          return mocks.rows[id as string];
        }
        if (sql.includes('FROM routines WHERE') && sql.includes('SELECT name')) {
          return mocks.routineRows[id as string];
        }
        return undefined;
      },
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO runs')) {
          mocks.insertedRuns.push(args);
        }
      },
      all: () => {
        if (sql.includes('FROM runs')) {
          return Object.values(mocks.rows);
        }
        return [];
      },
    }),
  },
}));

import { runsRepository } from '../runsRepository';

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    routine_id: 'routine-1',
    routine_name: 'Test Routine',
    trigger_id: null,
    trigger_type: 'manual',
    prompt: 'test prompt',
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

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.rows)) {
    delete mocks.rows[k];
  }
  for (const k of Object.keys(mocks.routineRows)) {
    delete mocks.routineRows[k];
  }
  mocks.insertedRuns.length = 0;
});

describe('runsRepository.findById', () => {
  it('returns the run when found', () => {
    const run = makeRun({ id: 'run-1' });
    mocks.rows['run-1'] = run;

    const result = runsRepository.findById('run-1');

    expect(result).toEqual(run);
  });

  it('returns undefined when not found', () => {
    const result = runsRepository.findById('nonexistent');

    expect(result).toBeUndefined();
  });
});

describe('runsRepository.findAll', () => {
  it('returns all runs', () => {
    mocks.rows['run-1'] = makeRun({ id: 'run-1' });
    mocks.rows['run-2'] = makeRun({ id: 'run-2' });

    const result = runsRepository.findAll({ limit: 50, offset: 0 });

    expect(result).toHaveLength(2);
  });
});

describe('runsRepository.findParentChain', () => {
  it('returns empty array when run not found', () => {
    const result = runsRepository.findParentChain('nonexistent');

    expect(result).toEqual([]);
  });

  it('returns single run when no parent', () => {
    const run = makeRun({ id: 'run-1', parent_run_id: null });
    mocks.rows['run-1'] = run;

    const result = runsRepository.findParentChain('run-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(run);
  });

  it('walks parent chain and returns runs in chronological order', () => {
    const run1 = makeRun({ id: 'run-1', parent_run_id: null });
    const run2 = makeRun({ id: 'run-2', parent_run_id: 'run-1' });
    const run3 = makeRun({ id: 'run-3', parent_run_id: 'run-2' });
    mocks.rows['run-1'] = run1;
    mocks.rows['run-2'] = run2;
    mocks.rows['run-3'] = run3;

    const result = runsRepository.findParentChain('run-3');

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('run-1');
    expect(result[1].id).toBe('run-2');
    expect(result[2].id).toBe('run-3');
  });
});

describe('runsRepository.getRoutineName', () => {
  it('returns routine name when found', () => {
    mocks.routineRows['routine-1'] = { name: 'My Routine' };

    const result = runsRepository.getRoutineName('routine-1');

    expect(result).toBe('My Routine');
  });

  it('returns empty string when not found', () => {
    const result = runsRepository.getRoutineName('nonexistent');

    expect(result).toBe('');
  });
});

describe('runsRepository.create', () => {
  it('inserts a new run with correct parameters', () => {
    runsRepository.create({
      id: 'new-run',
      routineId: 'routine-1',
      routineName: 'Test Routine',
      triggerId: 'trigger-1',
      triggerType: 'manual',
      prompt: 'hello',
      parentRunId: 'parent-run',
      metadata: { key: 'value' },
    });

    expect(mocks.insertedRuns).toHaveLength(1);
    const [id, routineId, routineName, triggerId, triggerType, prompt, parentRunId, metadata] =
      mocks.insertedRuns[0];
    expect(id).toBe('new-run');
    expect(routineId).toBe('routine-1');
    expect(routineName).toBe('Test Routine');
    expect(triggerId).toBe('trigger-1');
    expect(triggerType).toBe('manual');
    expect(prompt).toBe('hello');
    expect(parentRunId).toBe('parent-run');
    expect(metadata).toBe('{"key":"value"}');
  });
});

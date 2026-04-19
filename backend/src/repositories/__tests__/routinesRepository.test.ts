import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const rows: Record<string, unknown> = {};
  return { rows };
});

vi.mock('../../database', () => ({
  db: {
    prepare: (sql: string) => ({
      get: (id: unknown) => {
        if (sql.includes('FROM routines WHERE')) {
          return mocks.rows[id as string];
        }
        return undefined;
      },
      all: () => Object.values(mocks.rows),
    }),
  },
}));

import { routinesRepository } from '../routinesRepository';

function makeRoutine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'routine-1',
    name: 'Test Routine',
    description: '',
    prompt: 'test prompt',
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

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.rows)) {
    delete mocks.rows[k];
  }
});

describe('routinesRepository.findById', () => {
  it('returns the routine when found', () => {
    const routine = makeRoutine({ id: 'routine-1' });
    mocks.rows['routine-1'] = routine;

    const result = routinesRepository.findById('routine-1');

    expect(result).toEqual(routine);
  });

  it('returns undefined when not found', () => {
    const result = routinesRepository.findById('nonexistent');

    expect(result).toBeUndefined();
  });
});

describe('routinesRepository.findAll', () => {
  it('returns all routines', () => {
    mocks.rows['routine-1'] = makeRoutine();
    mocks.rows['routine-2'] = makeRoutine({ id: 'routine-2' });

    const result = routinesRepository.findAll();

    expect(result).toHaveLength(2);
  });

  it('returns empty array when no routines', () => {
    const result = routinesRepository.findAll();

    expect(result).toEqual([]);
  });
});

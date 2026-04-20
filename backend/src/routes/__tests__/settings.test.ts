import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  upsertedSetting: null as unknown,
  deletedKey: null as string | null,
  invalidateAll: vi.fn(),
}));

vi.mock('../../repositories/settingsRepository', () => ({
  settingsRepository: {
    findByKey: (key: string) => mocks.settings[key],
    findAll: () => Object.values(mocks.settings),
    upsert: (data: { key: string; value: string; is_secret: boolean }) => {
      mocks.upsertedSetting = {
        key: data.key,
        value: data.value,
        is_secret: data.is_secret ? 1 : 0,
        updated_at: new Date().toISOString(),
      };
      mocks.settings[data.key] = mocks.upsertedSetting;
      return mocks.upsertedSetting;
    },
    exists: (key: string) => !!mocks.settings[key],
    delete: (key: string) => {
      mocks.deletedKey = key;
      delete mocks.settings[key];
    },
  },
}));

vi.mock('../../services/opencodeServerPool', () => ({
  invalidateAll: mocks.invalidateAll,
}));

function makeSetting(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: 'API_KEY',
    value: 'secret-value',
    is_secret: 1,
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function buildApp() {
  const { default: settingsRouter } = await import('../settings');
  return new Hono().route('/', settingsRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(mocks.settings)) {
    delete mocks.settings[k];
  }
  mocks.upsertedSetting = null;
  mocks.deletedKey = null;
});

describe('GET /', () => {
  it('returns all settings', async () => {
    mocks.settings['API_KEY'] = makeSetting();
    mocks.settings['DEBUG'] = makeSetting({ key: 'DEBUG', value: 'true', is_secret: 0 });

    const app = await buildApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });

  it('masks secret values', async () => {
    mocks.settings['API_KEY'] = makeSetting({ is_secret: 1 });

    const app = await buildApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: string }[];
    expect(body[0].value).toBe('***');
  });

  it('shows non-secret values', async () => {
    mocks.settings['DEBUG'] = makeSetting({ key: 'DEBUG', value: 'true', is_secret: 0 });

    const app = await buildApp();
    const res = await app.request('/');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: string }[];
    expect(body[0].value).toBe('true');
  });
});

describe('PUT /', () => {
  it('creates or updates a setting', async () => {
    const app = await buildApp();
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: 'NEW_KEY',
        value: 'new-value',
        is_secret: false,
      }),
    });

    expect(res.status).toBe(200);
    expect(mocks.upsertedSetting).not.toBeNull();
    expect(mocks.invalidateAll).toHaveBeenCalled();
  });

  it('returns 400 for invalid data', async () => {
    const app = await buildApp();
    const res = await app.request('/', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: '', value: 'test' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /:key', () => {
  it('deletes a setting and returns 204', async () => {
    mocks.settings['API_KEY'] = makeSetting();

    const app = await buildApp();
    const res = await app.request('/API_KEY', { method: 'DELETE' });

    expect(res.status).toBe(204);
    expect(mocks.deletedKey).toBe('API_KEY');
    expect(mocks.invalidateAll).toHaveBeenCalled();
  });

  it('returns 404 when setting not found', async () => {
    const app = await buildApp();
    const res = await app.request('/NONEXISTENT', { method: 'DELETE' });

    expect(res.status).toBe(404);
  });
});

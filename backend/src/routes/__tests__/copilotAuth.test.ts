import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const mocks = vi.hoisted(() => ({
  acquireContext: vi.fn(),
  release: vi.fn(),
  upsert: vi.fn(),
  client: {
    provider: {
      oauth: {
        authorize: vi.fn(),
        callback: vi.fn(),
      },
    },
  },
}));

vi.mock('../../services/opencodeServerPool', () => ({
  acquireContext: mocks.acquireContext,
}));

vi.mock('../../repositories/settingsRepository', () => ({
  settingsRepository: {
    upsert: mocks.upsert,
  },
}));

vi.mock('../../config', () => ({
  config: {
    workspacesDir: '/test/workspaces',
  },
}));

async function buildApp() {
  const { default: copilotAuthRouter } = await import('../copilotAuth');
  return new Hono().route('/', copilotAuthRouter);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquireContext.mockResolvedValue({
    client: mocks.client,
    release: mocks.release,
  });
});

describe('POST /authorize', () => {
  it('returns authorization URL and instructions on success', async () => {
    mocks.client.provider.oauth.authorize.mockResolvedValue({
      data: {
        url: 'https://github.com/login/device',
        instructions: 'Enter code: ABCD-1234',
        method: 'auto',
      },
    });

    const app = await buildApp();
    const res = await app.request('/authorize', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      url: 'https://github.com/login/device',
      instructions: 'Enter code: ABCD-1234',
      method: 'auto',
    });
    expect(mocks.release).toHaveBeenCalled();
  });

  it('calls SDK with correct parameters', async () => {
    mocks.client.provider.oauth.authorize.mockResolvedValue({
      data: { url: 'https://github.com/login/device', instructions: 'test', method: 'auto' },
    });

    const app = await buildApp();
    await app.request('/authorize', { method: 'POST' });

    expect(mocks.client.provider.oauth.authorize).toHaveBeenCalledWith({
      path: { id: 'github-copilot' },
      body: { method: 0 },
      query: { directory: '/test/workspaces' },
    });
  });

  it('returns 500 when acquireContext fails', async () => {
    mocks.acquireContext.mockRejectedValue(new Error('Server unavailable'));

    const app = await buildApp();
    const res = await app.request('/authorize', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to connect to OpenCode server');
  });

  it('returns 500 when SDK returns no data', async () => {
    mocks.client.provider.oauth.authorize.mockResolvedValue({ data: null });

    const app = await buildApp();
    const res = await app.request('/authorize', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('No authorization data returned');
    expect(mocks.release).toHaveBeenCalled();
  });

  it('returns 500 when SDK throws', async () => {
    mocks.client.provider.oauth.authorize.mockRejectedValue(new Error('SDK error'));

    const app = await buildApp();
    const res = await app.request('/authorize', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Authorization failed');
    expect(mocks.release).toHaveBeenCalled();
  });
});

describe('POST /callback', () => {
  it('returns success when OAuth completes', async () => {
    mocks.client.provider.oauth.callback.mockResolvedValue({});

    const app = await buildApp();
    const res = await app.request('/callback', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'success' });
    expect(mocks.release).toHaveBeenCalled();
  });

  it('calls SDK with correct parameters', async () => {
    mocks.client.provider.oauth.callback.mockResolvedValue({});

    const app = await buildApp();
    await app.request('/callback', { method: 'POST' });

    expect(mocks.client.provider.oauth.callback).toHaveBeenCalledWith({
      path: { id: 'github-copilot' },
      body: { method: 0 },
      query: { directory: '/test/workspaces' },
    });
  });

  it('returns 500 when acquireContext fails', async () => {
    mocks.acquireContext.mockRejectedValue(new Error('Server unavailable'));

    const app = await buildApp();
    const res = await app.request('/callback', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to connect to OpenCode server');
  });

  it('returns 400 when SDK returns error', async () => {
    mocks.client.provider.oauth.callback.mockResolvedValue({
      error: 'access_denied',
    });

    const app = await buildApp();
    const res = await app.request('/callback', { method: 'POST' });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('access_denied');
    expect(mocks.release).toHaveBeenCalled();
  });

  it('returns 500 when SDK throws', async () => {
    mocks.client.provider.oauth.callback.mockRejectedValue(new Error('Timeout'));

    const app = await buildApp();
    const res = await app.request('/callback', { method: 'POST' });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('Callback failed');
    expect(mocks.release).toHaveBeenCalled();
  });
});

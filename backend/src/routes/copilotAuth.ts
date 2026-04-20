import { Hono } from 'hono';
import { acquireContext } from '../services/opencodeServerPool';
import { settingsRepository } from '../repositories/settingsRepository';
import { config } from '../config';
import { logger } from '../util/logger';

/**
 * GitHub Copilot authentication via the OpenCode SDK.
 *
 * Flow:
 *   1. POST /api/auth/github-copilot/authorize
 *      → Calls SDK's provider.oauth.authorize(), returns { url, instructions, method }
 *   2. POST /api/auth/github-copilot/callback
 *      → Calls SDK's provider.oauth.callback(), polls until auth completes
 *
 * The SDK handles the device code flow, token storage, and refresh internally.
 */

const PROVIDER_ID = 'github-copilot';

const router = new Hono();

// Step 1: Start OAuth authorization flow
router.post('/authorize', async (c) => {
  let serverCtx;
  try {
    serverCtx = await acquireContext({ cwd: config.workspacesDir, env: process.env });
  } catch (err) {
    logger.error('Failed to acquire OpenCode server for auth:', err);
    return c.json({ error: 'Failed to connect to OpenCode server' }, 500);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = serverCtx.client as any;

    const result = await client.provider.oauth.authorize({
      path: { id: PROVIDER_ID },
      body: { method: 0 },
      query: { directory: config.workspacesDir },
    });

    if (!result.data) {
      return c.json({ error: 'No authorization data returned' }, 500);
    }

    return c.json({
      url: result.data.url,
      instructions: result.data.instructions,
      method: result.data.method,
    });
  } catch (err) {
    logger.error('OAuth authorize failed:', err);
    return c.json({ error: `Authorization failed: ${err}` }, 500);
  } finally {
    serverCtx.release();
  }
});

// Step 2: Complete OAuth flow (polls for token)
router.post('/callback', async (c) => {
  let serverCtx;
  try {
    serverCtx = await acquireContext({ cwd: config.workspacesDir, env: process.env });
  } catch (err) {
    logger.error('Failed to acquire OpenCode server for auth callback:', err);
    return c.json({ error: 'Failed to connect to OpenCode server' }, 500);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = serverCtx.client as any;

    const result = await client.provider.oauth.callback({
      path: { id: PROVIDER_ID },
      body: { method: 0 },
      query: { directory: config.workspacesDir },
    });

    if (result.error) {
      return c.json({ error: result.error }, 400);
    }

    // Store a marker so the UI knows Copilot is connected
    // (actual token is managed by the SDK in ~/.local/share/opencode/auth.json)
    settingsRepository.upsert({
      key: 'GITHUB_TOKEN',
      value: 'managed-by-sdk',
      is_secret: true,
    });

    return c.json({ status: 'success' });
  } catch (err) {
    logger.error('OAuth callback failed:', err);
    return c.json({ error: `Callback failed: ${err}` }, 500);
  } finally {
    serverCtx.release();
  }
});

export default router;

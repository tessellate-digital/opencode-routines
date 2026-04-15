import { Hono } from 'hono';
import { db } from '../database';

/**
 * GitHub Copilot uses the OAuth Device Authorization flow.
 *
 * Flow:
 *   1. POST /api/auth/github-copilot/device-code
 *      → Requests a device code from GitHub, returns { user_code, verification_uri, device_code, interval }
 *   2. GET  /api/auth/github-copilot/poll?device_code=…
 *      → Polls GitHub for the access token. Returns { status, token? }
 *
 * The client ID below is the well-known Copilot VS Code extension client ID,
 * which is the same one used by opencode's /connect command.
 */

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const router = new Hono();

// Step 1: Request a device code from GitHub
router.post('/device-code', async (c) => {
  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: 'read:user',
  });

  const res = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    return c.json({ error: `GitHub returned ${res.status}: ${text}` }, 502);
  }

  const data = (await res.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  return c.json({
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    expires_in: data.expires_in,
    interval: data.interval,
  });
});

// Step 2: Poll GitHub for the access token
router.get('/poll', async (c) => {
  const deviceCode = c.req.query('device_code');
  if (!deviceCode) {
    return c.json({ error: 'Missing device_code query parameter' }, 400);
  }

  const body = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  const res = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    return c.json({ error: `GitHub returned ${res.status}: ${text}` }, 502);
  }

  const data = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  // GitHub returns error codes in the JSON body (not HTTP status) while waiting
  if (data.error) {
    // authorization_pending = user hasn't entered the code yet (keep polling)
    // slow_down             = polling too fast (back off)
    // expired_token         = device code expired
    // access_denied         = user rejected
    return c.json({
      status: data.error,
      description: data.error_description ?? '',
    });
  }

  // Success — store the token in the settings table
  if (data.access_token) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = 1, updated_at = excluded.updated_at
    `).run('GITHUB_TOKEN', data.access_token, now);

    return c.json({ status: 'success' });
  }

  return c.json({ status: 'unknown', description: 'Unexpected response from GitHub' });
});

export default router;

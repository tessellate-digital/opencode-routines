import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { config } from './config';
import { initDb, db } from './database';
import { schedulerService } from './services/scheduler';
import { eventBus } from './services/eventBus';
import routinesRouter from './routes/routines';
import triggersRouter from './routes/triggers';
import runsRouter from './routes/runs';
import webhooksRouter from './routes/webhooks';
import settingsRouter from './routes/settings';
import copilotAuthRouter from './routes/copilotAuth';

const execAsync = promisify(exec);
const app = new Hono();

// Auth middleware for /api routes
app.use('/api/*', async (c, next) => {
  if (config.adminToken) {
    const auth = c.req.header('Authorization') ?? '';
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== config.adminToken) {
      return c.json({ detail: 'Unauthorized' }, 401);
    }
  }
  return next();
});

// Routes
app.route('/api/routines', routinesRouter);
app.route('/api', triggersRouter);
app.route('/api/runs', runsRouter);
app.route('/hooks', webhooksRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/auth/github-copilot', copilotAuthRouter);

// Host volume mappings pushed by the host agent on startup (containerPath -> hostPath)
let hostMounts: Record<string, string> = {};
app.get('/api/host-mounts', (c) => c.json(hostMounts));
app.post('/api/host-mounts', async (c) => {
  hostMounts = (await c.req.json()) as Record<string, string>;
  return c.json({ ok: true });
});

// Global SSE events endpoint — broadcasts all state changes to connected frontends
app.get('/api/events', async (c) => {
  const { clientId, next } = eventBus.subscribe();

  return streamSSE(c, async (stream) => {
    // Send a keepalive ping every 30 seconds
    const pingInterval = setInterval(async () => {
      try {
        await stream.writeSSE({ event: 'ping', data: '' });
      } catch {
        clearInterval(pingInterval);
      }
    }, 30_000);

    stream.onAbort(() => {
      clearInterval(pingInterval);
      eventBus.unsubscribe(clientId);
    });

    try {
      while (true) {
        const event = await next();
        if (event === null) {
          break;
        }
        await stream.writeSSE({ event: event.event, data: event.data });
      }
    } finally {
      clearInterval(pingInterval);
      eventBus.unsubscribe(clientId);
    }
  });
});

// Build an env that includes all stored settings (API keys etc.)
// so CLI commands like `opencode models` can see configured providers.
function buildGlobalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  for (const row of rows) {
    env[row.key] = row.value;
  }
  return env;
}

// Models endpoint
app.get('/api/models', async (c) => {
  try {
    const env = buildGlobalEnv();
    const { stdout } = await execAsync(`${config.opencodePath} models`, {
      timeout: 30_000,
      env,
    });
    const models = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('/') && !l.startsWith('#') && !l.startsWith('='));
    return c.json({ models });
  } catch (err) {
    return c.json({ models: [], error: String(err) });
  }
});

// Returns the direct subdirectories of workspacesDir — these are the
// user-mounted volumes and the only paths the user should be able to select
// as a workspace folder.
async function getUserMounts(): Promise<string[]> {
  const root = path.resolve(config.workspacesDir);
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name))
      .sort();
  } catch {
    return [];
  }
}

// Returns the list of user-mounted workspace directories.
// An empty array means nothing is mounted and the folder picker should be disabled.
app.get('/api/fs/mounts', async (c) => {
  const mounts = await getUserMounts();
  return c.json({ mounts });
});

// Filesystem browser endpoint — lets users navigate inside a mounted workspace.
// Browsing is strictly limited to paths within a known user mount (never the
// workspacesDir root itself, which contains app-internal scratch dirs).
app.get('/api/fs', async (c) => {
  const root = path.resolve(config.workspacesDir);
  const rawPath = c.req.query('path') || '';
  if (!rawPath) {
    return c.json({ detail: 'path query parameter is required' }, 400);
  }
  const resolved = path.resolve(rawPath.replace(/\.\./g, ''));

  // Must be inside workspacesDir (or workspacesDir itself)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return c.json({ detail: 'Path is outside the workspaces directory' }, 400);
  }

  // Browsing the root itself — list all mount directories
  if (resolved === root) {
    try {
      const entries = await fs.promises.readdir(resolved, {
        withFileTypes: true,
      });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return c.json({ path: resolved, parent: null, root, entries: dirs });
    } catch {
      return c.json({ detail: 'Cannot read directory' }, 400);
    }
  }

  // Must be inside a known user mount
  const mounts = await getUserMounts();
  const insideMount = mounts.some((m) => resolved === m || resolved.startsWith(m + path.sep));
  if (!insideMount) {
    return c.json({ detail: 'Path is not inside a mounted workspace' }, 400);
  }

  // Find which mount this path belongs to (used to know when "up" hits the boundary)
  const mountRoot = mounts.find((m) => resolved === m || resolved.startsWith(m + path.sep))!;

  try {
    const entries = await fs.promises.readdir(resolved, {
      withFileTypes: true,
    });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // parent is root when at mount root, null only at root itself
    const parent = resolved === mountRoot ? root : path.dirname(resolved);
    return c.json({ path: resolved, parent, root: mountRoot, entries: dirs });
  } catch {
    return c.json({ detail: 'Cannot read directory' }, 400);
  }
});

// In production, serve the React frontend build
const frontendDist = path.join(process.cwd(), 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use('/*', serveStatic({ root: path.relative(process.cwd(), frontendDist) }));

  // SPA fallback: serve index.html for all non-API/non-file routes
  app.get('*', async (c) => {
    const indexPath = path.join(frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      const html = await fs.promises.readFile(indexPath, 'utf-8');
      return c.html(html);
    }
    return c.notFound();
  });
} else {
  // Fallback to old static files if frontend not built yet
  const staticDir = path.join(process.cwd(), 'backend', 'static');
  app.use('/static/*', serveStatic({ root: path.join(process.cwd(), 'backend') }));

  app.get('/', async (c) => {
    const html = await fs.promises.readFile(path.join(staticDir, 'index.html'), 'utf-8');
    return c.html(html);
  });
}

// Start
initDb();
schedulerService.start();

serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`Server running on http://0.0.0.0:${config.port}`);
});

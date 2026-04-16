/**
 * Singleton OpenCode server pool.
 *
 * Manages `opencode serve` subprocesses, one per unique (cwd + env) context.
 * Two runs with the same resolved workspace path and fully-merged env share a
 * single server. Servers idle for longer than IDLE_TIMEOUT_MS are disposed
 * automatically.
 *
 * Public API:
 *   acquireContext({ cwd, env }) → ServerContext  (call context.release() when done)
 *   invalidateAll()              → disposes all idle servers (no active leases)
 *   disposeAll()                 → disposes all servers unconditionally (shutdown hook)
 */

import { createHash } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import { config as appConfig } from '../config';

// ─── Public types ────────────────────────────────────────────────────────────

export interface ServerContext {
  /** The connected OpencodeClient instance (typed as unknown; callers cast as needed). */
  client: unknown;
  /** Base URL of the underlying opencode serve process. */
  baseUrl: string;
  /** Release the lease. If no more leases remain, the idle-disposal timer starts. */
  release(): void;
}

// ─── Internal pool entry ─────────────────────────────────────────────────────

interface PoolEntry {
  key: string;
  baseUrl: string;
  client: unknown;
  process: ChildProcess;
  leases: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Set to true by invalidateAll() when the entry has active leases.
   * When the last lease is released, the entry is disposed immediately
   * instead of starting an idle timer.
   */
  stale: boolean;
}

// ─── Module-level state ───────────────────────────────────────────────────────

/** Fully-started pool entries, keyed by context hash. */
const pool = new Map<string, PoolEntry>();

/**
 * In-flight startup promises. A second caller arriving while a server is still
 * starting will await the existing promise instead of spawning a second process.
 */
const inflight = new Map<string, Promise<PoolEntry>>();

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const HEALTH_CHECK_TIMEOUT_MS = 10_000; // 10 seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a stable hash for the (cwd, env) pair without logging raw values.
 * `cwd` is resolved to an absolute path before hashing so that relative paths
 * and their absolute equivalents produce the same key.
 */
function computeKey(cwd: string, env: NodeJS.ProcessEnv): string {
  const absCwd = path.resolve(cwd);
  const sortedEnv = Object.keys(env)
    .sort()
    .map((k) => `${k}=${env[k] ?? ''}`)
    .join('\n');
  return createHash('sha256').update(`${absCwd}\n${sortedEnv}`).digest('hex');
}

/**
 * Bind to port 0 on 127.0.0.1, read the OS-assigned port, then close the
 * listening socket so opencode can claim that port.
 *
 * NOTE: There is a brief TOCTOU window between closing the probe socket and
 * opencode binding. In practice this is deterministic on loopback; if port
 * contention ever becomes an issue, retry logic can be added here.
 */
function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

/**
 * Spawn `opencode serve` and wait until it prints "opencode server listening on <url>".
 * Rejects if the process exits before printing the URL, or if the timeout fires.
 */
function spawnAndWaitForServer(
  cwd: string,
  env: NodeJS.ProcessEnv,
  port: number
): Promise<{ url: string; proc: ChildProcess }> {
  const STARTUP_TIMEOUT_MS = 30_000;

  return new Promise((resolve, reject) => {
    const proc = spawn(
      appConfig.opencodePath,
      ['serve', `--hostname=127.0.0.1`, `--port=${port}`],
      {
        cwd: path.resolve(cwd),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    let output = '';
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      proc.kill();
      reject(
        new Error(`opencode serve did not start within ${STARTUP_TIMEOUT_MS}ms on port ${port}`)
      );
    }, STARTUP_TIMEOUT_MS);

    function tryResolve(line: string) {
      if (!line.includes('opencode server listening')) {
        return;
      }
      const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
      if (!match) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve({ url: match[1], proc });
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split('\n')) {
        tryResolve(line);
        if (settled) {
          break;
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      for (const line of output.split('\n')) {
        tryResolve(line);
        if (settled) {
          break;
        }
      }
    });

    proc.on('exit', (code) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        reject(new Error(`opencode serve exited early (code ${code})\n${output}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

/**
 * Dynamically import the ESM-only @opencode-ai/sdk and call createOpencodeClient.
 * Using Function() wrapper to avoid TypeScript's static module resolution for
 * "moduleResolution": "node" which cannot resolve ESM-only packages.
 */
async function createClient(baseUrl: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdk = await (Function('m', 'return import(m)')('@opencode-ai/sdk') as Promise<any>);
  return sdk.createOpencodeClient({ baseUrl }) as unknown;
}

/**
 * Perform a lightweight health check against a freshly-started server by calling
 * `client.config.get()`. Times out after HEALTH_CHECK_TIMEOUT_MS.
 * Throws if the call fails or times out.
 */
async function healthCheck(client: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = client as any;
  await Promise.race([
    c.config.get(),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Health check timed out after ${HEALTH_CHECK_TIMEOUT_MS}ms`)),
        HEALTH_CHECK_TIMEOUT_MS
      )
    ),
  ]);
}

/**
 * Terminate a pool entry and remove it from the map.
 */
function disposeEntry(entry: PoolEntry): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }
  try {
    entry.process.kill();
  } catch {
    // Process may have already exited
  }
  pool.delete(entry.key);
}

/**
 * Start the idle timer for an entry. Called when leases drop to 0.
 */
function scheduleIdle(entry: PoolEntry): void {
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
  }
  entry.idleTimer = setTimeout(() => {
    // Double-check: only dispose if still idle
    if (entry.leases === 0) {
      disposeEntry(entry);
    }
  }, IDLE_TIMEOUT_MS);
}

/**
 * Start a new server, run the health check, register it in the pool, and
 * remove the in-flight promise when done (whether success or failure).
 * This is the single-flight work unit referenced by `inflight`.
 */
async function startNewEntry(
  key: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv }
): Promise<PoolEntry> {
  const port = await allocateEphemeralPort();
  const { url, proc } = await spawnAndWaitForServer(opts.cwd, opts.env, port);
  const client = await createClient(url);

  // Health-check: confirm the server is actually accepting requests.
  // On failure, kill the process and propagate the error so the caller retries.
  try {
    await healthCheck(client);
  } catch (err) {
    proc.kill();
    throw err;
  }

  const entry: PoolEntry = {
    key,
    baseUrl: url,
    client,
    process: proc,
    leases: 0,
    idleTimer: null,
    stale: false,
  };
  pool.set(key, entry);

  // If the server dies unexpectedly, evict it from the pool
  proc.on('exit', () => {
    if (pool.get(key) === entry) {
      pool.delete(key);
    }
  });

  return entry;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Acquire a server context for the given workspace path and merged environment.
 * If a compatible server is already running, it is reused. Otherwise a new
 * `opencode serve` process is started.
 *
 * Concurrent callers with the same key share a single startup promise — only
 * one subprocess is ever spawned per context, even under concurrent load.
 *
 * The caller MUST call `context.release()` when the run finishes to avoid
 * resource leaks.
 */
export async function acquireContext(opts: {
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<ServerContext> {
  const key = computeKey(opts.cwd, opts.env);

  // Fast path: already-running server
  let entry = pool.get(key);

  if (!entry) {
    // Check for an in-flight startup (concurrent deduplication)
    let startPromise = inflight.get(key);

    if (!startPromise) {
      // We are first — kick off startup and register the in-flight promise
      startPromise = startNewEntry(key, opts).finally(() => {
        // Always remove from inflight map once settled, success or failure
        inflight.delete(key);
      });
      inflight.set(key, startPromise);
    }

    entry = await startPromise;
  }

  // Cancel any pending idle disposal
  if (entry.idleTimer !== null) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = null;
  }

  entry.leases++;

  const capturedEntry = entry;
  let released = false;

  return {
    client: capturedEntry.client,
    baseUrl: capturedEntry.baseUrl,
    release() {
      if (released) {
        return;
      }
      released = true;
      capturedEntry.leases = Math.max(0, capturedEntry.leases - 1);
      if (capturedEntry.leases === 0) {
        if (capturedEntry.stale) {
          // Settings changed while this run was active — dispose now that it's idle.
          disposeEntry(capturedEntry);
        } else {
          scheduleIdle(capturedEntry);
        }
      }
    },
  };
}

/**
 * Dispose all servers that currently have no active leases, and mark
 * busy servers as stale so they are disposed when their last lease is released.
 * Used when settings change, invalidating cached env contexts.
 */
export async function invalidateAll(): Promise<void> {
  for (const entry of Array.from(pool.values())) {
    if (entry.leases === 0) {
      disposeEntry(entry);
    } else {
      // Active run in progress — mark stale so release() disposes it immediately
      // once the last lease is returned, without aborting the in-flight run.
      entry.stale = true;
    }
  }
}

/**
 * Dispose ALL pooled servers unconditionally. Must be called on process shutdown.
 */
export async function disposeAll(): Promise<void> {
  for (const entry of Array.from(pool.values())) {
    disposeEntry(entry);
  }
}

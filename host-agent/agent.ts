import chokidar, { type FSWatcher } from 'chokidar';
import { readFileSync } from 'fs';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { resolve, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const BASE_URL = process.env.ROUTINES_URL ?? 'http://localhost:8080';
const AGENT_PORT = parseInt(process.env.AGENT_PORT ?? '3000', 10);
const POLL_INTERVAL_MS = 60_000;

const COMPOSE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docker-compose.yml');

interface WatcherTrigger {
  triggerId: string;
  secret: string;
  containerPaths: string[];
  hostPaths: string[];
  events: string[];
  debounce: number;
  fileFilter?: { mode: 'include' | 'exclude' | 'none'; patterns: string[] };
}

interface TriggerResponse {
  id: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

function parseVolumeMounts(): Map<string, string> {
  const mounts = new Map<string, string>();
  let content: string;
  try {
    content = readFileSync(COMPOSE_FILE, 'utf8');
  } catch {
    console.warn(`[watcher] Could not read ${COMPOSE_FILE} — path translation disabled`);
    return mounts;
  }
  const re = /^\s*-\s*["']?(\/[^:'"]+):(\/[^:'"\r\n]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    mounts.set(m[2].trim(), m[1].trim());
  }
  return mounts;
}

function toHostPath(containerPath: string, mounts: Map<string, string>): string {
  let bestLen = 0;
  let result = containerPath;
  for (const [cMount, hMount] of mounts) {
    if (containerPath.startsWith(cMount) && cMount.length > bestLen) {
      bestLen = cMount.length;
      result = hMount + containerPath.slice(cMount.length);
    }
  }
  return result;
}

function toContainerPath(hostPath: string, mounts: Map<string, string>): string {
  let bestLen = 0;
  let result = hostPath;
  for (const [cMount, hMount] of mounts) {
    if (hostPath.startsWith(hMount) && hMount.length > bestLen) {
      bestLen = hMount.length;
      result = cMount + hostPath.slice(hMount.length);
    }
  }
  return result;
}

const volumeMounts = parseVolumeMounts();

if (volumeMounts.size > 0) {
  console.log('[watcher] Volume mappings:');
  for (const [c, h] of volumeMounts) {
    console.log(`  ${c} → ${h}`);
  }
}

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let activeTriggers: WatcherTrigger[] = [];
let lastPollAt: string | null = null;
let lastPollError: string | null = null;

async function fetchWatcherTriggers(): Promise<WatcherTrigger[]> {
  const res = await fetch(`${BASE_URL}/api/triggers?type=watcher`);
  if (!res.ok) {
    throw new Error(`Failed to fetch triggers: ${res.status}`);
  }

  const triggers = (await res.json()) as TriggerResponse[];

  return triggers
    .filter((t) => t.enabled)
    .map((t) => {
      // Support both config.paths (array) and legacy config.path (string)
      const rawPaths: string[] = Array.isArray(t.config.paths)
        ? (t.config.paths as string[])
        : typeof t.config.path === 'string' && t.config.path
          ? [t.config.path as string]
          : [];
      const containerPaths = rawPaths.filter(Boolean);
      const hostPaths = containerPaths.map((p) => toHostPath(p, volumeMounts)).filter(Boolean);

      // Parse optional file filter
      const rawFilter = t.config.fileFilter as { mode?: string; patterns?: string[] } | undefined;
      const fileFilter =
        rawFilter && Array.isArray(rawFilter.patterns) && rawFilter.patterns.length > 0
          ? {
              mode:
                rawFilter.mode === 'exclude'
                  ? ('exclude' as const)
                  : rawFilter.mode === 'none'
                    ? ('none' as const)
                    : ('include' as const),
              patterns: rawFilter.patterns,
            }
          : undefined;

      return {
        triggerId: t.id,
        secret: String(t.config.secret ?? ''),
        containerPaths,
        hostPaths,
        events: Array.isArray(t.config.events)
          ? (t.config.events as string[])
          : ['add', 'change', 'addDir'],
        debounce: typeof t.config.debounce === 'number' ? t.config.debounce : 500,
        fileFilter,
      };
    })
    .filter((t) => t.hostPaths.length > 0);
}

async function fireEvent(
  triggerId: string,
  secret: string,
  fsEvent: string,
  fsPath: string
): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/hooks/watcher/${triggerId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        event: fsEvent,
        path: fsPath,
        container_path: toContainerPath(fsPath, volumeMounts),
        timestamp: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      console.error(`[watcher] Event rejected for trigger ${triggerId}: ${res.status}`);
    }
  } catch (err) {
    console.error(`[watcher] Failed to send event to ${triggerId}:`, (err as Error).message);
  }
}

const CHOKIDAR_EVENTS = ['add', 'change', 'addDir', 'unlink', 'unlinkDir'] as const;

const FOLDER_EVENTS = new Set(['addDir', 'unlinkDir']);

function matchesFileFilter(
  filePath: string,
  filter: WatcherTrigger['fileFilter'],
  evtType: string
): boolean {
  // Folder events bypass the filter
  if (FOLDER_EVENTS.has(evtType)) {
    return true;
  }
  if (!filter || filter.mode === 'none' || filter.patterns.length === 0) {
    return true;
  }
  const ext = extname(filePath).toLowerCase();
  if (!ext) {
    return filter.mode === 'exclude';
  } // no extension: include only if mode is exclude
  if (filter.mode === 'include') {
    return filter.patterns.includes(ext);
  }
  return !filter.patterns.includes(ext); // exclude mode
}

function reconcileWatchers(triggers: WatcherTrigger[]): void {
  const neededPaths = new Set(triggers.flatMap((t) => t.hostPaths));

  for (const [p, w] of watchers) {
    if (!neededPaths.has(p)) {
      w.close();
      watchers.delete(p);
      console.log(`[watcher] Stopped watching: ${p}`);
    }
  }

  for (const p of neededPaths) {
    if (watchers.has(p)) {
      continue;
    }

    const w = chokidar.watch(p, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: false,
    });

    for (const evtType of CHOKIDAR_EVENTS) {
      w.on(evtType, (filePath: string) => {
        const matching = triggers.filter(
          (t) =>
            t.hostPaths.includes(p) &&
            t.events.includes(evtType) &&
            matchesFileFilter(filePath, t.fileFilter, evtType)
        );
        for (const t of matching) {
          const key = `${t.triggerId}:${evtType}:${filePath}`;
          clearTimeout(debounceTimers.get(key));
          debounceTimers.set(
            key,
            setTimeout(() => {
              debounceTimers.delete(key);
              fireEvent(t.triggerId, t.secret, evtType, filePath);
            }, t.debounce)
          );
        }
      });
    }

    w.on('error', (err: unknown) => console.error(`[watcher] Error on ${p}:`, err));
    watchers.set(p, w);
    console.log(`[watcher] Watching: ${p}`);
  }
}

async function poll(): Promise<void> {
  lastPollAt = new Date().toISOString();
  try {
    const triggers = await fetchWatcherTriggers();
    activeTriggers = triggers;
    lastPollError = null;
    reconcileWatchers(triggers);
    if (triggers.length === 0) {
      console.log('[watcher] No active watcher triggers found.');
    }
  } catch (err) {
    lastPollError = (err as Error).message;
    console.error('[watcher] Poll failed:', lastPollError);
  }
}

// --- Debug HTTP server ---

function serveDebug(_req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (_req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const body = JSON.stringify(
    {
      backendUrl: BASE_URL,
      lastPollAt,
      lastPollError,
      volumeMounts: Object.fromEntries(volumeMounts),
      watchers: activeTriggers.map((t) => ({
        triggerId: t.triggerId,
        containerPaths: t.containerPaths,
        hostPaths: t.hostPaths,
        events: t.events,
        fileFilter: t.fileFilter ?? null,
        watching: t.hostPaths.some((p) => watchers.has(p)),
      })),
    },
    null,
    2
  );

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
}

createServer(serveDebug).listen(AGENT_PORT, () => {
  console.log(`[watcher] Debug server: http://localhost:${AGENT_PORT}`);
});

// --- Start ---

async function pushHostMounts(): Promise<void> {
  if (volumeMounts.size === 0) {
    return;
  }
  try {
    await fetch(`${BASE_URL}/api/host-mounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(volumeMounts)),
    });
  } catch (err) {
    console.error('[watcher] Failed to push host mounts:', (err as Error).message);
  }
}

console.log(`[watcher] Starting. Backend: ${BASE_URL}`);
pushHostMounts();
poll();
setInterval(poll, POLL_INTERVAL_MS);

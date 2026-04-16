import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { timingSafeEqual } from 'crypto';
import { db } from '../database';
import { executor } from '../services/executor';
import { verifySignature, parseEvent } from '../services/github';
import type { TriggerRow, RoutineRow } from '../types';

const router = new Hono();

router.post('/api/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = db
    .prepare(
      `
    SELECT * FROM triggers WHERE id = ? AND type = 'api' AND enabled = 1
  `
    )
    .get(triggerId) as TriggerRow | undefined;
  if (!trigger) {
    return c.json({ detail: 'Trigger not found' }, 404);
  }

  const triggerConfig = JSON.parse(trigger.config) as Record<string, string>;
  const token = triggerConfig.token ?? '';

  const auth = c.req.header('Authorization') ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  let valid = false;
  try {
    valid =
      provided.length > 0 &&
      token.length > 0 &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(token));
  } catch {
    /* length mismatch = invalid */
  }

  if (!valid) {
    return c.json({ detail: 'Invalid token' }, 401);
  }

  const routine = db
    .prepare('SELECT * FROM routines WHERE id = ? AND enabled = 1')
    .get(trigger.routine_id) as RoutineRow | undefined;
  if (!routine) {
    return c.json({ detail: 'Routine not found or disabled' }, 404);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* no body */
  }

  const text = (body.text as string) ?? '';
  const prompt = text ? `${routine.prompt}\n\nAdditional context:\n${text}` : routine.prompt;

  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO runs (id, routine_id, routine_name, trigger_id, trigger_type, prompt, status, metadata, created_at)
    VALUES (?, ?, ?, ?, 'api', ?, 'pending', ?, ?)
  `
  ).run(
    runId,
    routine.id,
    routine.name,
    trigger.id,
    prompt,
    JSON.stringify(text ? { text } : {}),
    now
  );

  executor
    .startRun(runId, routine, prompt)
    .catch((err) => console.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId });
});

router.post('/github/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = db
    .prepare(
      `
    SELECT * FROM triggers WHERE id = ? AND type = 'github' AND enabled = 1
  `
    )
    .get(triggerId) as TriggerRow | undefined;
  if (!trigger) {
    return c.json({ detail: 'Trigger not found' }, 404);
  }

  const triggerConfig = JSON.parse(trigger.config) as Record<string, unknown>;
  const secret = (triggerConfig.secret as string) ?? '';

  const payloadBuffer = Buffer.from(await c.req.arrayBuffer());
  const signature = c.req.header('X-Hub-Signature-256') ?? '';

  if (!verifySignature(payloadBuffer, secret, signature)) {
    return c.json({ detail: 'Invalid signature' }, 401);
  }

  const eventHeader = c.req.header('X-GitHub-Event') ?? '';
  if (!eventHeader) {
    return c.json({ detail: 'Missing X-GitHub-Event header' }, 400);
  }

  const payload = JSON.parse(payloadBuffer.toString('utf8')) as Record<string, unknown>;
  const allowedEvents = (triggerConfig.events as string[]) ?? [];
  const [matched, metadata] = parseEvent(eventHeader, payload, allowedEvents);

  if (!matched) {
    return c.json({
      status: 'skipped',
      reason: `Event ${eventHeader} not in filter`,
    });
  }

  const routine = db
    .prepare('SELECT * FROM routines WHERE id = ? AND enabled = 1')
    .get(trigger.routine_id) as RoutineRow | undefined;
  if (!routine) {
    return c.json({ detail: 'Routine not found or disabled' }, 404);
  }

  const contextLines = [`GitHub event: ${eventHeader}`];
  for (const [k, v] of Object.entries(metadata)) {
    if (k !== 'event') {
      contextLines.push(`  ${k}: ${v}`);
    }
  }
  const prompt = `${routine.prompt}\n\nGitHub event context:\n${contextLines.join('\n')}`;

  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO runs (id, routine_id, routine_name, trigger_id, trigger_type, prompt, status, metadata, created_at)
    VALUES (?, ?, ?, ?, 'github', ?, 'pending', ?, ?)
  `
  ).run(runId, routine.id, routine.name, trigger.id, prompt, JSON.stringify(metadata), now);

  executor
    .startRun(runId, routine, prompt)
    .catch((err) => console.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId });
});

router.post('/watcher/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = db
    .prepare(
      `
    SELECT * FROM triggers WHERE id = ? AND type = 'watcher' AND enabled = 1
  `
    )
    .get(triggerId) as TriggerRow | undefined;
  if (!trigger) {
    return c.json({ detail: 'Trigger not found' }, 404);
  }

  const triggerConfig = JSON.parse(trigger.config) as Record<string, unknown>;
  const secret = (triggerConfig.secret as string) ?? '';

  const auth = c.req.header('Authorization') ?? '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  let valid = false;
  try {
    valid =
      provided.length > 0 &&
      secret.length > 0 &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    /* length mismatch = invalid */
  }

  if (!valid) {
    return c.json({ detail: 'Invalid secret' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await c.req.json();
  } catch {
    /* no body */
  }

  const fsEvent = (body.event as string) ?? '';
  const fsPath = (body.path as string) ?? '';
  const containerPath = (body.container_path as string) ?? '';

  const allowedEvents = (triggerConfig.events as string[]) ?? [];
  if (allowedEvents.length > 0 && !allowedEvents.includes(fsEvent)) {
    return c.json({
      status: 'skipped',
      reason: `Event '${fsEvent}' not in filter`,
    });
  }

  const routine = db
    .prepare('SELECT * FROM routines WHERE id = ? AND enabled = 1')
    .get(trigger.routine_id) as RoutineRow | undefined;
  if (!routine) {
    return c.json({ detail: 'Routine not found or disabled' }, 404);
  }

  const prompt = routine.prompt;
  const metadata = { fs_event: fsEvent, fs_path: containerPath || fsPath };

  const runId = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO runs (id, routine_id, routine_name, trigger_id, trigger_type, prompt, status, metadata, created_at)
    VALUES (?, ?, ?, ?, 'watcher', ?, 'pending', ?, ?)
  `
  ).run(runId, routine.id, routine.name, trigger.id, prompt, JSON.stringify(metadata), now);

  executor
    .startRun(runId, routine, prompt)
    .catch((err) => console.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId });
});

export default router;

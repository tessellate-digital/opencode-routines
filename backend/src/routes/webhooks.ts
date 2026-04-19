import { Hono } from 'hono';
import { randomUUID } from 'crypto';
import { timingSafeEqual } from 'crypto';
import { executor } from '../services/executor';
import { verifySignature, parseEvent } from '../services/github';
import { triggersRepository } from '../repositories/triggersRepository';
import { routinesRepository } from '../repositories/routinesRepository';
import { runsRepository } from '../repositories/runsRepository';
import { logger } from '../util/logger';

const router = new Hono();

router.post('/api/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = triggersRepository.findEnabledByIdAndType(triggerId, 'api');
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

  const routine = routinesRepository.findEnabledById(trigger.routine_id);
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
  runsRepository.create({
    id: runId,
    routineId: routine.id,
    routineName: routine.name,
    triggerId: trigger.id,
    triggerType: 'api',
    prompt,
    metadata: text ? { text } : {},
  });

  executor
    .startRun(runId, routine, prompt)
    .catch((err) => logger.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId });
});

router.post('/github/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = triggersRepository.findEnabledByIdAndType(triggerId, 'github');
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

  const routine = routinesRepository.findEnabledById(trigger.routine_id);
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
  runsRepository.create({
    id: runId,
    routineId: routine.id,
    routineName: routine.name,
    triggerId: trigger.id,
    triggerType: 'github',
    prompt,
    metadata,
  });

  executor
    .startRun(runId, routine, prompt)
    .catch((err) => logger.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId });
});

router.post('/watcher/:triggerId', async (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = triggersRepository.findEnabledByIdAndType(triggerId, 'watcher');
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

  const routine = routinesRepository.findEnabledById(trigger.routine_id);
  if (!routine) {
    return c.json({ detail: 'Routine not found or disabled' }, 404);
  }

  const prompt = routine.prompt;
  const metadata = { fs_event: fsEvent, fs_path: containerPath || fsPath };

  const runId = randomUUID();
  runsRepository.create({
    id: runId,
    routineId: routine.id,
    routineName: routine.name,
    triggerId: trigger.id,
    triggerType: 'watcher',
    prompt,
    metadata,
  });

  executor
    .startRun(runId, routine, prompt)
    .catch((err) => logger.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId });
});

export default router;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID, randomBytes } from 'crypto';
import { schedulerService } from '../services/scheduler';
import { triggersRepository } from '../repositories/triggersRepository';
import { routinesRepository } from '../repositories/routinesRepository';
import { TriggerCreateSchema, TriggerUpdateSchema } from '../types';
import type { TriggerRow } from '../types';

const router = new Hono();

function triggerToResponse(t: TriggerRow) {
  return {
    id: t.id,
    routine_id: t.routine_id,
    type: t.type,
    config: JSON.parse(t.config) as Record<string, unknown>,
    enabled: t.enabled === 1,
    created_at: t.created_at,
  };
}

router.get('/triggers', (c) => {
  const type = c.req.query('type');
  const rows = triggersRepository.findEnabled(type);
  return c.json(rows.map(triggerToResponse));
});

router.get('/routines/:routineId/triggers', (c) => {
  const routineId = c.req.param('routineId');
  if (!triggersRepository.routineExists(routineId)) {
    return c.json({ detail: 'Routine not found' }, 404);
  }

  const triggers = triggersRepository.findByRoutineId(routineId);
  return c.json(triggers.map(triggerToResponse));
});

router.post('/routines/:routineId/triggers', zValidator('json', TriggerCreateSchema), (c) => {
  const routineId = c.req.param('routineId');
  const routine = routinesRepository.findById(routineId);
  if (!routine) {
    return c.json({ detail: 'Routine not found' }, 404);
  }

  const data = c.req.valid('json');
  const triggerConfig = { ...(data.config as Record<string, unknown>) };

  if (data.type === 'api' && !triggerConfig.token) {
    triggerConfig.token = randomBytes(32).toString('hex');
  }
  if (data.type === 'github' && !triggerConfig.secret) {
    triggerConfig.secret = randomBytes(20).toString('hex');
  }
  if (data.type === 'watcher' && !triggerConfig.secret) {
    triggerConfig.secret = randomBytes(20).toString('hex');
  }

  const id = randomUUID();
  const trigger = triggersRepository.create(id, routineId, data, triggerConfig);

  if (trigger.type === 'cron' && trigger.enabled === 1) {
    schedulerService.registerTrigger(trigger, routine);
  }

  return c.json(triggerToResponse(trigger), 201);
});

router.put('/triggers/:triggerId', zValidator('json', TriggerUpdateSchema), (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = triggersRepository.findById(triggerId);
  if (!trigger) {
    return c.json({ detail: 'Trigger not found' }, 404);
  }

  const data = c.req.valid('json');
  const updated = triggersRepository.update(triggerId, data);

  if (updated.type === 'cron') {
    const routine = routinesRepository.findById(updated.routine_id)!;
    if (updated.enabled === 1) {
      schedulerService.registerTrigger(updated, routine);
    } else {
      schedulerService.unregisterTrigger(updated.id);
    }
  }

  return c.json(triggerToResponse(updated));
});

router.delete('/triggers/:triggerId', (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = triggersRepository.findById(triggerId);
  if (!trigger) {
    return c.json({ detail: 'Trigger not found' }, 404);
  }

  if (trigger.type === 'cron') {
    schedulerService.unregisterTrigger(triggerId);
  }

  triggersRepository.delete(triggerId);
  return new Response(null, { status: 204 });
});

export default router;

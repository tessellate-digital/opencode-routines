import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID, randomBytes } from 'crypto';
import { db } from '../database';
import { schedulerService } from '../services/scheduler';
import { TriggerCreateSchema, TriggerUpdateSchema } from '../types';
import type { TriggerRow, RoutineRow } from '../types';

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

router.get('/routines/:routineId/triggers', (c) => {
  const routineId = c.req.param('routineId');
  const routine = db.prepare('SELECT id FROM routines WHERE id = ?').get(routineId);
  if (!routine) return c.json({ detail: 'Routine not found' }, 404);

  const triggers = db.prepare('SELECT * FROM triggers WHERE routine_id = ?').all(routineId) as TriggerRow[];
  return c.json(triggers.map(triggerToResponse));
});

router.post('/routines/:routineId/triggers', zValidator('json', TriggerCreateSchema), (c) => {
  const routineId = c.req.param('routineId');
  const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId) as RoutineRow | undefined;
  if (!routine) return c.json({ detail: 'Routine not found' }, 404);

  const data = c.req.valid('json');
  const triggerConfig = { ...data.config as Record<string, unknown> };

  if (data.type === 'api' && !triggerConfig.token) {
    triggerConfig.token = randomBytes(32).toString('hex');
  }
  if (data.type === 'github' && !triggerConfig.secret) {
    triggerConfig.secret = randomBytes(20).toString('hex');
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO triggers (id, routine_id, type, config, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, routineId, data.type, JSON.stringify(triggerConfig), data.enabled ? 1 : 0, now);

  const trigger = db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as TriggerRow;

  if (trigger.type === 'cron' && trigger.enabled === 1) {
    schedulerService.registerTrigger(trigger, routine);
  }

  return c.json(triggerToResponse(trigger), 201);
});

router.put('/triggers/:triggerId', zValidator('json', TriggerUpdateSchema), (c) => {
  const triggerId = c.req.param('triggerId');
  const trigger = db.prepare('SELECT * FROM triggers WHERE id = ?').get(triggerId) as TriggerRow | undefined;
  if (!trigger) return c.json({ detail: 'Trigger not found' }, 404);

  const data = c.req.valid('json');
  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.config !== undefined) { updates.push('config = ?'); values.push(JSON.stringify(data.config)); }
  if (data.enabled !== undefined) { updates.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }

  if (updates.length > 0) {
    values.push(triggerId);
    db.prepare(`UPDATE triggers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM triggers WHERE id = ?').get(triggerId) as TriggerRow;

  if (updated.type === 'cron') {
    const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(updated.routine_id) as RoutineRow;
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
  const trigger = db.prepare('SELECT * FROM triggers WHERE id = ?').get(triggerId) as TriggerRow | undefined;
  if (!trigger) return c.json({ detail: 'Trigger not found' }, 404);

  if (trigger.type === 'cron') {
    schedulerService.unregisterTrigger(triggerId);
  }

  db.prepare('DELETE FROM triggers WHERE id = ?').run(triggerId);
  return new Response(null, { status: 204 });
});

export default router;

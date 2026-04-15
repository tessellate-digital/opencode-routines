import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { db } from '../database';
import { executor } from '../services/executor';
import { eventBus } from '../services/eventBus';
import { RoutineCreateSchema, RoutineUpdateSchema, RunTriggerSchema } from '../types';
import type { RoutineRow, RunRow } from '../types';

const router = new Hono();

function routineToResponse(r: RoutineRow) {
  const lastRun = db.prepare('SELECT status FROM runs WHERE routine_id = ? ORDER BY created_at DESC LIMIT 1').get(r.id) as Pick<RunRow, 'status'> | undefined;
  const triggersCount = (db.prepare('SELECT COUNT(*) as count FROM triggers WHERE routine_id = ?').get(r.id) as { count: number }).count;

  // Check if workspace folder is still accessible (only when one is configured)
  let workspaceOk = true;
  if (r.workspace_path) {
    try { workspaceOk = fs.statSync(r.workspace_path).isDirectory(); }
    catch { workspaceOk = false; }
  }

  return {
    id: r.id,
    name: r.name,
    description: r.description,
    prompt: r.prompt,
    model: r.model,
    repository: r.repository,
    branch: r.branch,
    agent: r.agent,
    env_vars: JSON.parse(r.env_vars) as Record<string, string>,
    enabled: r.enabled === 1,
    run_mode: r.run_mode as 'background' | 'foreground',
    workspace_path: r.workspace_path,
    workspace_accessible: workspaceOk,
    created_at: r.created_at,
    updated_at: r.updated_at,
    triggers_count: triggersCount,
    last_run_status: lastRun?.status ?? null,
  };
}

router.get('/', (c) => {
  const rows = db.prepare('SELECT * FROM routines ORDER BY created_at DESC').all() as RoutineRow[];
  return c.json(rows.map(r => routineToResponse(r)));
});

router.post('/', zValidator('json', RoutineCreateSchema), (c) => {
  const data = c.req.valid('json');
  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO routines (id, name, description, prompt, model, repository, branch, agent, env_vars, enabled, run_mode, workspace_path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.description, data.prompt, data.model, data.repository, data.branch, data.agent, JSON.stringify(data.env_vars), data.enabled ? 1 : 0, data.run_mode, data.workspace_path, now, now);

  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow;
  const response = routineToResponse(row);
  eventBus.broadcast('routine_created', { routine: response });
  return c.json(response, 201);
});

router.get('/:id', (c) => {
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(c.req.param('id')) as RoutineRow | undefined;
  if (!row) return c.json({ detail: 'Routine not found' }, 404);
  return c.json(routineToResponse(row));
});

router.put('/:id', zValidator('json', RoutineUpdateSchema), (c) => {
  const id = c.req.param('id');
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined;
  if (!row) return c.json({ detail: 'Routine not found' }, 404);

  const data = c.req.valid('json');
  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { updates.push('description = ?'); values.push(data.description); }
  if (data.prompt !== undefined) { updates.push('prompt = ?'); values.push(data.prompt); }
  if (data.model !== undefined) { updates.push('model = ?'); values.push(data.model); }
  if (data.repository !== undefined) { updates.push('repository = ?'); values.push(data.repository); }
  if (data.branch !== undefined) { updates.push('branch = ?'); values.push(data.branch); }
  if (data.agent !== undefined) { updates.push('agent = ?'); values.push(data.agent); }
  if (data.env_vars !== undefined) { updates.push('env_vars = ?'); values.push(JSON.stringify(data.env_vars)); }
  if (data.enabled !== undefined) { updates.push('enabled = ?'); values.push(data.enabled ? 1 : 0); }
  if (data.run_mode !== undefined) { updates.push('run_mode = ?'); values.push(data.run_mode); }
  if (data.workspace_path !== undefined) { updates.push('workspace_path = ?'); values.push(data.workspace_path); }

  if (updates.length > 0) {
    updates.push('updated_at = ?');
    values.push(new Date().toISOString(), id);
    db.prepare(`UPDATE routines SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow;
  const response = routineToResponse(updated);
  eventBus.broadcast('routine_updated', { routine: response });
  return c.json(response);
});

router.delete('/:id', (c) => {
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(c.req.param('id')) as RoutineRow | undefined;
  if (!row) return c.json({ detail: 'Routine not found' }, 404);
  db.prepare('DELETE FROM routines WHERE id = ?').run(c.req.param('id'));
  eventBus.broadcast('routine_deleted', { routine_id: c.req.param('id') });
  return new Response(null, { status: 204 });
});

router.post('/:id/run', zValidator('json', RunTriggerSchema.partial()), async (c) => {
  const id = c.req.param('id');
  const row = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined;
  if (!row) return c.json({ detail: 'Routine not found' }, 404);

  // Pre-flight: check workspace folder is still accessible
  if (row.workspace_path) {
    try {
      const stat = fs.statSync(row.workspace_path);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch {
      return c.json({
        detail: `Workspace folder is no longer accessible: ${row.workspace_path}. Check your docker-compose.yml volumes and restart the container.`,
      }, 409);
    }
  }

  const body = c.req.valid('json');
  const text = body?.text ?? '';
  const runId = randomUUID();
  const now = new Date().toISOString();
  const prompt = text ? `${row.prompt}\n\nAdditional context:\n${text}` : row.prompt;

  db.prepare(`
    INSERT INTO runs (id, routine_id, trigger_type, prompt, status, metadata, created_at)
    VALUES (?, ?, 'manual', ?, 'pending', ?, ?)
  `).run(runId, row.id, prompt, JSON.stringify(text ? { text } : {}), now);

  eventBus.broadcast('run_created', { run_id: runId, routine_id: row.id, status: 'pending' });

  executor.startRun(runId, row, prompt).catch(err => console.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId }, 202);
});

export default router;

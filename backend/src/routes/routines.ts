import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { executor } from '../services/executor';
import { eventBus } from '../services/eventBus';
import { routinesRepository } from '../repositories/routinesRepository';
import type { RoutineRow } from '../types';
import { runsRepository } from '../repositories/runsRepository';
import { RoutineCreateSchema, RoutineUpdateSchema, RunTriggerSchema } from '../types';

const router = new Hono();

function routineToResponse(r: RoutineRow) {
  let workspaceOk = true;
  if (r.workspace_path) {
    try {
      workspaceOk = fs.statSync(r.workspace_path).isDirectory();
    } catch {
      workspaceOk = false;
    }
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
    triggers_count: r.triggers_count,
    last_run_status: r.last_run_status,
  };
}

router.get('/', (c) => {
  const rows = routinesRepository.findAll();
  return c.json(rows.map((r) => routineToResponse(r)));
});

router.post('/', zValidator('json', RoutineCreateSchema), (c) => {
  const data = c.req.valid('json');
  const id = randomUUID();
  const row = routinesRepository.create(id, data);
  const response = routineToResponse(row);
  eventBus.broadcast('routine_created', { routine: response });
  return c.json(response, 201);
});

router.get('/:id', (c) => {
  const row = routinesRepository.findById(c.req.param('id'));
  if (!row) {
    return c.json({ detail: 'Routine not found' }, 404);
  }
  return c.json(routineToResponse(row));
});

router.put('/:id', zValidator('json', RoutineUpdateSchema), (c) => {
  const id = c.req.param('id');
  if (!routinesRepository.findById(id)) {
    return c.json({ detail: 'Routine not found' }, 404);
  }

  const data = c.req.valid('json');
  const updated = routinesRepository.update(id, data);
  const response = routineToResponse(updated);
  eventBus.broadcast('routine_updated', { routine: response });
  return c.json(response);
});

router.delete('/:id', (c) => {
  const id = c.req.param('id');
  const row = routinesRepository.findById(id);
  if (!row) {
    return c.json({ detail: 'Routine not found' }, 404);
  }
  routinesRepository.delete(id);
  eventBus.broadcast('routine_deleted', { routine_id: id });
  return new Response(null, { status: 204 });
});

router.post('/:id/run', zValidator('json', RunTriggerSchema.partial()), async (c) => {
  const id = c.req.param('id');
  const row = routinesRepository.findById(id);
  if (!row) {
    return c.json({ detail: 'Routine not found' }, 404);
  }

  if (row.workspace_path) {
    try {
      const stat = fs.statSync(row.workspace_path);
      if (!stat.isDirectory()) {
        throw new Error('not a directory');
      }
    } catch {
      return c.json(
        {
          detail: `Workspace folder is no longer accessible: ${row.workspace_path}. Check your docker-compose.yml volumes and restart the container.`,
        },
        409
      );
    }
  }

  const body = c.req.valid('json');
  const text = body?.text ?? '';
  const runId = randomUUID();
  const prompt = text ? `${row.prompt}\n\nAdditional context:\n${text}` : row.prompt;

  runsRepository.create({
    id: runId,
    routineId: row.id,
    routineName: row.name,
    triggerType: 'manual',
    prompt,
    parentRunId: null,
    metadata: text ? { text } : {},
  });

  eventBus.broadcast('run_created', {
    run_id: runId,
    routine_id: row.id,
    status: 'pending',
  });

  executor.startRun(runId, row, prompt).catch((err) => console.error(`Run ${runId} error:`, err));

  return c.json({ run_id: runId }, 202);
});

export default router;

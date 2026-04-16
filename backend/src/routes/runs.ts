import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'crypto';
import { db } from '../database';
import { executor } from '../services/executor';
import { eventBus } from '../services/eventBus';
import type { RunRow, RoutineRow } from '../types';

const router = new Hono();

function runToResponse(r: RunRow) {
  // Use the snapshotted name first; fall back to live lookup for older rows
  const routine_name =
    r.routine_name ||
    (r.routine_id
      ? ((
          db.prepare('SELECT name FROM routines WHERE id = ?').get(r.routine_id) as
            | Pick<RoutineRow, 'name'>
            | undefined
        )?.name ?? '')
      : '');
  return {
    id: r.id,
    routine_id: r.routine_id,
    routine_name,
    trigger_id: r.trigger_id,
    trigger_type: r.trigger_type,
    prompt: r.prompt,
    parent_run_id: r.parent_run_id ?? null,
    status: r.status,
    started_at: r.started_at,
    finished_at: r.finished_at,
    exit_code: r.exit_code,
    stdout: r.stdout,
    stderr: r.stderr,
    metadata: JSON.parse(r.metadata) as Record<string, unknown>,
    created_at: r.created_at,
  };
}

router.get('/', (c) => {
  const routineId = c.req.query('routine_id');
  const status = c.req.query('status');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10), 1), 200);
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10), 0);

  let sql = 'SELECT * FROM runs';
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (routineId) {
    conditions.push('routine_id = ?');
    params.push(routineId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (conditions.length) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as RunRow[];
  return c.json(rows.map(runToResponse));
});

router.get('/:id', (c) => {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(c.req.param('id')) as
    | RunRow
    | undefined;
  if (!row) {
    return c.json({ detail: 'Run not found' }, 404);
  }
  return c.json(runToResponse(row));
});

router.post('/:id/cancel', async (c) => {
  const runId = c.req.param('id');
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!row) {
    return c.json({ detail: 'Run not found' }, 404);
  }

  // Already cancelled — idempotent success
  if (row.status === 'cancelled') {
    return c.json({ status: 'cancelled' });
  }

  // Already finished — nothing to cancel
  if (['success', 'failed', 'lost'].includes(row.status)) {
    return c.json({ detail: `Run already finished with status '${row.status}'` }, 409);
  }

  // DB says running or pending — cancel it (best-effort kill if process handle exists)
  await executor.cancelRun(runId);
  return c.json({ status: 'cancelled' });
});

router.get('/:id/stream', async (c) => {
  const runId = c.req.param('id');
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!row) {
    return c.json({ detail: 'Run not found' }, 404);
  }

  // Already finished — replay stored output
  if (['success', 'failed', 'cancelled'].includes(row.status)) {
    return streamSSE(c, async (stream) => {
      if (row.stdout) {
        for (const line of row.stdout.split('\n')) {
          if (!line) {
            continue;
          }
          try {
            const evt = JSON.parse(line) as { type: string; data: string };
            await stream.writeSSE({ event: evt.type, data: evt.data });
          } catch {
            // Legacy plain-text format fallback
            await stream.writeSSE({ event: 'text', data: line });
          }
        }
      }
      if (row.stderr) {
        await stream.writeSSE({ event: 'stderr', data: row.stderr });
      }
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ status: row.status, exit_code: row.exit_code }),
      });
    });
  }

  const queue = executor.getStream(runId);
  if (!queue) {
    // No active stream but run is still marked running — the process died without
    // updating the DB (e.g. container restart).  Mark it 'lost' so it's visually
    // distinct and the frontend stops trying to stream.
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE runs SET status = 'lost', finished_at = ? WHERE id = ? AND status = 'running'`
    ).run(now, runId);
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ status: 'lost', exit_code: null }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    while (true) {
      const msg = await queue.get();
      if (msg === null) {
        const finalRun = db
          .prepare('SELECT status, exit_code FROM runs WHERE id = ?')
          .get(runId) as Pick<RunRow, 'status' | 'exit_code'> | undefined;
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({
            status: finalRun?.status ?? 'unknown',
            exit_code: finalRun?.exit_code ?? null,
          }),
        });
        break;
      }
      await stream.writeSSE({ event: msg.type, data: msg.data });
    }
  });
});

// Get the full conversation thread for a run — walks parent_run_id up to the root
// and returns the runs in chronological order (oldest first).
router.get('/:id/thread', (c) => {
  const runId = c.req.param('id');
  const startRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!startRow) {
    return c.json({ detail: 'Run not found' }, 404);
  }

  const chain: RunRow[] = [startRow];
  let cur = startRow;
  // Walk up the parent chain (safety limit to avoid infinite loops)
  for (let i = 0; i < 50 && cur.parent_run_id; i++) {
    const parent = db.prepare('SELECT * FROM runs WHERE id = ?').get(cur.parent_run_id) as
      | RunRow
      | undefined;
    if (!parent) {
      break;
    }
    chain.unshift(parent);
    cur = parent;
  }

  return c.json(chain.map(runToResponse));
});

// Reply to a finished run — creates a new follow-up run with full conversation context.
// The new run stores only the user's follow-up text as `prompt` and links to the parent
// via `parent_run_id`.  The full conversation history is reconstructed at execution time
// and sent to the CLI so the model has context.
router.post('/:id/reply', zValidator('json', z.object({ text: z.string().min(1) })), async (c) => {
  const runId = c.req.param('id');
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
  if (!row) {
    return c.json({ detail: 'Run not found' }, 404);
  }

  if (!['success', 'failed', 'cancelled'].includes(row.status)) {
    return c.json({ detail: 'Can only reply to finished runs' }, 409);
  }

  const routine = row.routine_id
    ? (db.prepare('SELECT * FROM routines WHERE id = ?').get(row.routine_id) as
        | RoutineRow
        | undefined)
    : undefined;
  if (!routine) {
    return c.json({ detail: 'Routine not found' }, 404);
  }

  const { text } = c.req.valid('json');

  // Walk the ancestor chain to reconstruct the full conversation for the CLI.
  // Each run in the chain has: prompt (user text) + stdout (assistant output).
  const chain: RunRow[] = [];
  let cur: RunRow | undefined = row;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parent_run_id
      ? (db.prepare('SELECT * FROM runs WHERE id = ?').get(cur.parent_run_id) as RunRow | undefined)
      : undefined;
  }

  // Build the full prompt: each turn's user prompt + assistant text output
  const parts: string[] = [];
  for (const r of chain) {
    parts.push(r.prompt);
    const assistantText = r.stdout
      ? r.stdout
          .split('\n')
          .flatMap((line: string) => {
            if (!line) {
              return [];
            }
            try {
              const evt = JSON.parse(line) as { type: string; data: string };
              return evt.type === 'text' ? [evt.data] : [];
            } catch {
              return [];
            }
          })
          .join('')
      : '';
    if (assistantText) {
      parts.push(`\n\n--- Assistant response ---\n${assistantText}`);
    }
  }
  parts.push(`\n\n--- User follow-up ---\n${text}`);
  const fullPrompt = parts.join('');

  const newRunId = randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO runs (id, routine_id, routine_name, trigger_type, prompt, parent_run_id, status, metadata, created_at)
    VALUES (?, ?, ?, 'manual', ?, ?, 'pending', ?, ?)
  `
  ).run(newRunId, routine.id, routine.name, text, runId, JSON.stringify({ reply_to: runId }), now);

  eventBus.broadcast('run_created', {
    run_id: newRunId,
    routine_id: routine.id,
    status: 'pending',
  });
  executor
    .startRun(newRunId, routine, fullPrompt)
    .catch((err) => console.error(`Reply run ${newRunId} error:`, err));

  return c.json({ run_id: newRunId }, 202);
});

export default router;

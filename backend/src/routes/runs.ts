import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'crypto';
import { executor } from '../services/executor';
import { eventBus } from '../services/eventBus';
import * as runStreamStore from '../services/runStreamStore';
import { runsRepository } from '../repositories/runsRepository';
import { routinesRepository } from '../repositories/routinesRepository';
import { logger } from '../util/logger';
import type { RunRow } from '../types';

const router = new Hono();

function parseStdout(raw: string): Array<{ type: string; data: string }> {
  if (!raw) {
    return [];
  }
  const events: Array<{ type: string; data: string }> = [];
  for (const line of raw.split('\n')) {
    if (!line) {
      continue;
    }
    try {
      const evt = JSON.parse(line) as { type: string; data: string };
      events.push(evt);
    } catch {
      events.push({ type: 'text', data: line });
    }
  }
  return events;
}

function runToResponse(r: RunRow) {
  // Use the snapshotted name first; fall back to live lookup for older rows
  const routine_name =
    r.routine_name || (r.routine_id ? runsRepository.getRoutineName(r.routine_id) : '');
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
    stdout: parseStdout(r.stdout),
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

  const rows = runsRepository.findAll({ routineId, status, limit, offset });
  return c.json(rows.map(runToResponse));
});

router.get('/stats', (c) => {
  return c.json({ running: runsRepository.countByStatus('running') });
});

router.get('/:id', (c) => {
  const row = runsRepository.findById(c.req.param('id'));
  if (!row) {
    return c.json({ detail: 'Run not found' }, 404);
  }
  return c.json(runToResponse(row));
});

router.post('/:id/cancel', async (c) => {
  const runId = c.req.param('id');
  const row = runsRepository.findById(runId);
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
  const row = runsRepository.findById(runId);
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

  // connectStream terminates any existing SSE consumer and creates a fresh queue.
  const queue = executor.connectStream(runId);
  if (!queue) {
    // No active stream — the run may have finished between our initial status
    // check and this point (race with executor's close()), or the process died.
    // Re-read the DB to distinguish between the two cases.
    const freshRow = runsRepository.findById(runId);
    if (freshRow && ['success', 'failed', 'cancelled', 'lost'].includes(freshRow.status)) {
      // Already finished — replay stored output (same as the finished-run path)
      return streamSSE(c, async (stream) => {
        if (freshRow.stdout) {
          for (const line of freshRow.stdout.split('\n')) {
            if (!line) {
              continue;
            }
            try {
              const evt = JSON.parse(line) as { type: string; data: string };
              await stream.writeSSE({ event: evt.type, data: evt.data });
            } catch {
              await stream.writeSSE({ event: 'text', data: line });
            }
          }
        }
        if (freshRow.stderr) {
          await stream.writeSSE({ event: 'stderr', data: freshRow.stderr });
        }
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ status: freshRow.status, exit_code: freshRow.exit_code }),
        });
      });
    }

    // Truly lost — process died without updating the DB
    runsRepository.markAsLost(runId);
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ status: 'lost', exit_code: null }),
      });
    });
  }

  return streamSSE(c, async (stream) => {
    // Replay events that were emitted before this client connected.
    // This handles page refreshes and late-joining viewers so they see
    // the full conversation so far, not just future events.
    const history = executor.getHistory(runId);
    for (const evt of history) {
      await stream.writeSSE({ event: evt.type, data: evt.data });
    }

    // Stream new events going forward.  The executor pushes an authoritative
    // `done` event (with the final status) before the `null` sentinel, so we
    // break on either signal.  A bare `null` without a preceding done means
    // the stream was interrupted (e.g. a reconnecting client replaced this
    // consumer via connectStream) — we just break silently.
    while (true) {
      const msg = await queue.get();
      if (msg === null) {
        break;
      }
      await stream.writeSSE({ event: msg.type, data: msg.data });
      if (msg.type === 'done') {
        break;
      }
    }
  });
});

// Get the full conversation thread for a run — walks parent_run_id up to the root
// and returns the runs in chronological order (oldest first).
router.get('/:id/thread', (c) => {
  const runId = c.req.param('id');
  const chain = runsRepository.findParentChain(runId);
  if (chain.length === 0) {
    return c.json({ detail: 'Run not found' }, 404);
  }
  return c.json(chain.map(runToResponse));
});

// Reply to a finished run — creates a new follow-up run linked via parent_run_id.
// The existing session_id is passed to executor.startRun() so the SDK resumes
// the conversation natively.
router.post('/:id/reply', zValidator('json', z.object({ text: z.string().min(1) })), async (c) => {
  const runId = c.req.param('id');
  const row = runsRepository.findById(runId);
  if (!row) {
    return c.json({ detail: 'Run not found' }, 404);
  }

  if (!['success', 'failed', 'cancelled'].includes(row.status)) {
    return c.json({ detail: 'Can only reply to finished runs' }, 409);
  }

  if (!row.session_id) {
    return c.json({ detail: 'Run has no session to reply to' }, 400);
  }

  const routine = row.routine_id ? routinesRepository.findById(row.routine_id) : undefined;
  if (!routine) {
    return c.json({ detail: 'Routine not found' }, 404);
  }

  const { text } = c.req.valid('json');
  const newRunId = randomUUID();

  runsRepository.create({
    id: newRunId,
    routineId: routine.id,
    routineName: routine.name,
    triggerType: 'manual',
    prompt: text,
    parentRunId: runId,
    metadata: { reply_to: runId },
  });

  runStreamStore.openRun(newRunId);

  eventBus.broadcast('run_created', {
    run_id: newRunId,
    routine_id: routine.id,
    status: 'pending',
  });
  executor
    .startRun(newRunId, routine, text, row.session_id)
    .catch((err) => logger.error(`Reply run ${newRunId} error:`, err));

  return c.json({ run_id: newRunId }, 202);
});

export default router;

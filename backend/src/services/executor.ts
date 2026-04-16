import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { db } from '../database';
import { eventBus } from './eventBus';
import * as runStreamStore from './runStreamStore';
import { AsyncQueue } from './runStreamStore';
import type { StreamEvent } from './runStreamStore';
import * as pool from './opencodeServerPool';
import * as relay from './opencodeEventRelay';
import type { RoutineRow } from '../types';

const execFileAsync = promisify(execFile);

// ─── Model string parser ──────────────────────────────────────────────────────

/**
 * Parse a `provider/model` string into the SDK model object.
 *
 * - Empty string → returns `null` (let the server pick the default).
 * - `provider/model` → `{ providerID: 'provider', modelID: 'model' }`.
 * - `provider/nested/model` → `{ providerID: 'provider', modelID: 'nested/model' }`.
 * - Any other format (no slash, leading slash, trailing slash) → throws.
 */
export function parseModelString(model: string): { providerID: string; modelID: string } | null {
  if (model === '') {
    return null;
  }

  const slashIdx = model.indexOf('/');
  if (slashIdx === -1 || slashIdx === 0 || slashIdx === model.length - 1) {
    throw new Error(
      `Malformed model string "${model}". Expected format: "providerID/modelID" (e.g. "anthropic/claude-opus-4-5").`
    );
  }

  const providerID = model.slice(0, slashIdx);
  const modelID = model.slice(slashIdx + 1);
  return { providerID, modelID };
}

// ─── Executor class ───────────────────────────────────────────────────────────

export class Executor {
  /**
   * Active SDK-backed runs: runId → { client, sessionId }
   * Used by cancelRun() to abort sessions and by the pool cleanup.
   */
  private activeSessions = new Map<string, { client: unknown; sessionId: string }>();

  private async prepareWorkspace(routine: RoutineRow): Promise<string> {
    // If the routine has an explicit local folder, use it directly.
    if (routine.workspace_path) {
      const stat = await fs.promises.stat(routine.workspace_path).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        throw new Error(
          `Workspace folder is no longer accessible: ${routine.workspace_path}\n` +
            `The bind-mount may have been removed. Check your docker-compose.yml volumes and restart the container.`
        );
      }
      return routine.workspace_path;
    }

    const workspace = path.join('/workspaces/internal', routine.id);
    await fs.promises.mkdir(workspace, { recursive: true });

    if (routine.repository) {
      const repoDir = path.join(workspace, 'repo');
      if (fs.existsSync(path.join(repoDir, '.git'))) {
        await execFileAsync('git', ['-C', repoDir, 'fetch', 'origin'], {
          timeout: 120_000,
        });
        await execFileAsync('git', ['-C', repoDir, 'checkout', routine.branch], {
          timeout: 30_000,
        });
        await execFileAsync('git', ['-C', repoDir, 'pull', '--ff-only'], {
          timeout: 120_000,
        });
      } else {
        await execFileAsync('git', ['clone', '-b', routine.branch, routine.repository, repoDir], {
          timeout: 300_000,
        });
      }
      return repoDir;
    }

    return workspace;
  }

  private buildEnv(routine: RoutineRow): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Load global settings
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    for (const row of rows) {
      env[row.key] = row.value;
    }

    // Routine-specific overrides
    try {
      const routineEnv = JSON.parse(routine.env_vars) as Record<string, string>;
      Object.assign(env, routineEnv);
    } catch {
      /* ignore */
    }

    return env;
  }

  /**
   * Build an execution context preamble that gives the LLM useful metadata
   * about the routine and its run history.  This is prepended to the prompt
   * so the model can answer questions like "summarise commits since last run".
   *
   * Returns `{ context, fullPrompt }` — `context` is the preamble string
   * (stored in metadata for the frontend), `fullPrompt` is what's sent to
   * the SDK.
   */
  private buildPromptContext(
    routine: RoutineRow,
    userPrompt: string,
    extraLines: string[] = []
  ): { context: string; fullPrompt: string } {
    const now = new Date();

    // Fetch the most recent *finished* run for this routine (excluding the current one)
    const lastRun = db
      .prepare(
        `
      SELECT status, started_at, finished_at
      FROM runs
      WHERE routine_id = ? AND status IN ('success', 'failed', 'cancelled')
      ORDER BY finished_at DESC LIMIT 1
    `
      )
      .get(routine.id) as
      | {
          status: string;
          started_at: string | null;
          finished_at: string | null;
        }
      | undefined;

    const lines: string[] = [
      `[Execution Context]`,
      `Routine: ${routine.name}`,
      `Current time: ${now.toISOString()}`,
    ];

    if (routine.workspace_path) {
      lines.push(`Workspace: ${routine.workspace_path}`);
    }
    if (routine.repository) {
      lines.push(`Repository: ${routine.repository} (branch: ${routine.branch})`);
    }

    if (lastRun) {
      lines.push(`Last run status: ${lastRun.status}`);
      if (lastRun.started_at) {
        lines.push(`Last run started: ${lastRun.started_at}`);
      }
      if (lastRun.finished_at) {
        lines.push(`Last run finished: ${lastRun.finished_at}`);
      }
    } else {
      lines.push(`Last run: none (this is the first execution)`);
    }

    for (const line of extraLines) {
      lines.push(line);
    }

    lines.push(''); // blank line before user prompt

    const context = lines.join('\n');
    const fullPrompt = `${context}\n${userPrompt}`;

    return { context, fullPrompt };
  }

  async startRun(
    runId: string,
    routine: RoutineRow,
    prompt: string,
    existingSessionId?: string
  ): Promise<void> {
    // Build context preamble and store it in the run's metadata
    const existingMeta = db.prepare('SELECT metadata FROM runs WHERE id = ?').get(runId) as
      | { metadata: string }
      | undefined;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(existingMeta?.metadata ?? '{}');
    } catch {
      /* ignore */
    }

    // Extract trigger-specific context lines to include in the [Execution Context] preamble
    const extraLines: string[] = [];
    if (meta.fs_event) {
      extraLines.push(`Filesystem event: ${meta.fs_event}`);
    }
    if (meta.fs_path) {
      extraLines.push(`Changed path: ${meta.fs_path}`);
    }

    const { context, fullPrompt } = this.buildPromptContext(routine, prompt, extraLines);
    meta.prompt_context = context;
    db.prepare('UPDATE runs SET metadata = ? WHERE id = ?').run(JSON.stringify(meta), runId);

    db.prepare(`UPDATE runs SET status = 'running', started_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      runId
    );

    eventBus.broadcast('run_started', {
      run_id: runId,
      routine_id: routine.id,
      status: 'running',
    });

    runStreamStore.openRun(runId);

    // Parse model string; on error, persist and bail out immediately
    let sdkModel: { providerID: string; modelID: string } | null;
    try {
      sdkModel = parseModelString(routine.model ?? '');
    } catch (err) {
      db.prepare(
        `UPDATE runs SET status = 'failed', stderr = ?, exit_code = NULL, finished_at = ? WHERE id = ?`
      ).run(`${err}`, new Date().toISOString(), runId);
      eventBus.broadcast('run_finished', {
        run_id: runId,
        routine_id: routine.id,
        status: 'failed',
      });
      runStreamStore.close(runId, { status: 'failed', exit_code: null });
      return;
    }

    // Prepare workspace
    let workdir: string;
    try {
      workdir = await this.prepareWorkspace(routine);
    } catch (err) {
      db.prepare(
        `UPDATE runs SET status = 'failed', stderr = ?, exit_code = NULL, finished_at = ? WHERE id = ?`
      ).run(`Workspace preparation failed: ${err}`, new Date().toISOString(), runId);
      eventBus.broadcast('run_finished', {
        run_id: runId,
        routine_id: routine.id,
        status: 'failed',
      });
      runStreamStore.close(runId, { status: 'failed', exit_code: null });
      return;
    }

    const env = this.buildEnv(routine);

    // Acquire a pooled server context for this workspace + env
    let serverCtx: pool.ServerContext;
    try {
      serverCtx = await pool.acquireContext({ cwd: workdir, env });
    } catch (err) {
      db.prepare(
        `UPDATE runs SET status = 'failed', stderr = ?, exit_code = NULL, finished_at = ? WHERE id = ?`
      ).run(`Failed to acquire OpenCode server: ${err}`, new Date().toISOString(), runId);
      eventBus.broadcast('run_finished', {
        run_id: runId,
        routine_id: routine.id,
        status: 'failed',
      });
      runStreamStore.close(runId, { status: 'failed', exit_code: null });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = serverCtx.client as any;

    // Track whether prompt() resolved normally so the finally block can set
    // the final run status (after waitForDrain + hadErrors check).
    let promptCompletedNormally = false;

    try {
      // Determine session ID:
      // 1. Use caller-supplied existingSessionId (reply path — skip session.create()).
      // 2. Reuse existing session_id from DB if already persisted.
      // 3. Otherwise create a fresh SDK session.
      let sessionId: string | null = existingSessionId ?? null;

      if (!sessionId) {
        const existingRunRow = db.prepare('SELECT session_id FROM runs WHERE id = ?').get(runId) as
          | { session_id: string | null }
          | undefined;
        sessionId = existingRunRow?.session_id ?? null;
      }

      if (!sessionId) {
        // Create a new SDK session
        const createResult = await client.session.create();
        const session = createResult?.data ?? createResult;
        sessionId = (session?.id ?? session?.sessionID ?? null) as string | null;
        if (!sessionId) {
          throw new Error('SDK session.create() returned no session ID');
        }
      }

      // Persist session_id as soon as it is known (defensive: may already be set)
      db.prepare('UPDATE runs SET session_id = ? WHERE id = ?').run(sessionId, runId);

      // Register with event relay BEFORE sending the prompt so no events are missed
      relay.subscribeRun(serverCtx.client, sessionId, runId);

      // Track active session for cancellation
      this.activeSessions.set(runId, { client: serverCtx.client, sessionId });

      // ── Cancellation race guard ──────────────────────────────────────────
      // Check if cancelRun() was called during workspace/pool/session setup,
      // before activeSessions was populated.  The finally block will clean up
      // serverCtx and runStreamStore, so we only need to return early here.
      const prePromptRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        | { status: string }
        | undefined;
      if (prePromptRow?.status === 'cancelled') {
        return;
      }

      // Build prompt body
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promptBody: Record<string, any> = {
        parts: [{ type: 'text', text: fullPrompt }],
      };

      if (sdkModel) {
        promptBody.model = sdkModel;
      }

      if (routine.agent) {
        promptBody.agent = routine.agent;
      }

      // Send the prompt — this call blocks until the LLM finishes responding
      const result = await client.session.prompt({
        path: { id: sessionId },
        body: promptBody,
      });
      const promptResult = result?.data ?? result;

      // Persist assistant_message_id if available in the response
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assistantMessageId = (promptResult as any)?.info?.id ?? null;
      if (assistantMessageId) {
        db.prepare('UPDATE runs SET assistant_message_id = ? WHERE id = ?').run(
          assistantMessageId,
          runId
        );
      }

      // Re-read status from DB — cancel may have already transitioned it
      const currentRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        | { status: string }
        | undefined;
      const alreadyCancelled = currentRow?.status === 'cancelled';

      if (!alreadyCancelled) {
        // Mark completion — final status (success or failed) is written in the
        // finally block after waitForDrain so we can incorporate hadErrors.
        promptCompletedNormally = true;
      }
    } catch (err) {
      // Don't overwrite cancelled status on unexpected errors either
      const currentRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        | { status: string }
        | undefined;
      if (currentRow?.status !== 'cancelled') {
        db.prepare(
          `UPDATE runs SET status = 'failed', stderr = ?, exit_code = NULL, finished_at = ? WHERE id = ?`
        ).run(`Unexpected error: ${err}`, new Date().toISOString(), runId);
        eventBus.broadcast('run_finished', {
          run_id: runId,
          routine_id: routine.id,
          status: 'failed',
        });
      }
    } finally {
      const activeSession = this.activeSessions.get(runId);
      let finalStatus = 'unknown';
      let finalExitCode: number | null = null;

      if (activeSession) {
        await relay.waitForDrain(activeSession.sessionId, 10_000);

        // Write the final run status now that all relay events have been received.
        // This is intentionally deferred from the try block so hadErrors can
        // downgrade a successful completion to failed when session.error fired.
        if (promptCompletedNormally) {
          // Defense in depth: check both the relay's error flag and the stream
          // history for error events, in case there's a timing gap in the relay.
          const errored =
            relay.hadErrors(activeSession.sessionId) || runStreamStore.hasErrorEvents(runId);
          if (errored) {
            finalStatus = 'failed';
            db.prepare(
              `UPDATE runs SET status = 'failed', stderr = ?, exit_code = NULL, finished_at = ? WHERE id = ?`
            ).run(
              'Run completed with session errors — see error events in stream',
              new Date().toISOString(),
              runId
            );
            eventBus.broadcast('run_finished', {
              run_id: runId,
              routine_id: routine.id,
              status: 'failed',
            });
          } else {
            finalStatus = 'success';
            db.prepare(
              `UPDATE runs SET status = 'success', exit_code = NULL, finished_at = ? WHERE id = ?`
            ).run(new Date().toISOString(), runId);
            eventBus.broadcast('run_finished', {
              run_id: runId,
              routine_id: routine.id,
              status: 'success',
              exit_code: null,
            });
          }
        } else {
          // catch block already wrote status; read it back for the done payload.
          const row = db.prepare('SELECT status, exit_code FROM runs WHERE id = ?').get(runId) as
            | { status: string; exit_code: number | null }
            | undefined;
          finalStatus = row?.status ?? 'failed';
          finalExitCode = row?.exit_code ?? null;
        }

        relay.unsubscribeRun(activeSession.sessionId);
        this.activeSessions.delete(runId);
      }
      serverCtx.release();
      runStreamStore.close(runId, { status: finalStatus, exit_code: finalExitCode });
    }
  }

  async cancelRun(runId: string): Promise<void> {
    // DB is source of truth — mark cancelled unconditionally
    db.prepare(
      `UPDATE runs SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status IN ('pending', 'running')`
    ).run(new Date().toISOString(), runId);

    eventBus.broadcast('run_cancelled', { run_id: runId, status: 'cancelled' });

    // Best-effort abort via SDK — never kill the shared pooled server
    const activeSession = this.activeSessions.get(runId);
    if (activeSession) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = activeSession.client as any;
      try {
        await c.session.abort({ path: { id: activeSession.sessionId } });
      } catch {
        // Best-effort — ignore errors (run is already marked cancelled in DB)
      }
    }

    // Close the run stream so SSE clients get the end-of-stream signal
    runStreamStore.close(runId, { status: 'cancelled', exit_code: null });
  }

  /**
   * Create a fresh queue for a new SSE consumer.  Terminates any existing
   * consumer (by pushing `null` to the old queue) and swaps in the new one
   * so future events flow to the new client.  Returns `null` if no active
   * stream exists for the run.
   */
  connectStream(runId: string): AsyncQueue<StreamEvent | null> | null {
    return runStreamStore.connectStream(runId);
  }

  /** Returns all events emitted so far for a running stream (for replay to late-joining clients). */
  getHistory(runId: string): StreamEvent[] {
    return runStreamStore.getHistory(runId);
  }
}

export const executor = new Executor();

import { spawn, execFile } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { config } from '../config';
import { db } from '../database';
import { eventBus } from './eventBus';
import type { RoutineRow } from '../types';

const execFileAsync = promisify(execFile);

interface StreamEvent {
  type: string;
  data: string;
}

class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: ((value: T) => void)[] = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  async get(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return item;
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function parseOpencodeEvent(line: string): StreamEvent | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return { type: 'text', data: line };
  }

  const etype = event.type as string;

  if (etype === 'text') {
    const text = ((event.part as Record<string, unknown>)?.text as string) ?? '';
    if (text) {
      return { type: 'text', data: text };
    }
  } else if (etype === 'tool_call') {
    const part = (event.part as Record<string, unknown>) ?? {};
    const tool = (part.name ?? part.tool ?? 'unknown') as string;
    let args = (part.input ?? part.args ?? '') as unknown;
    if (typeof args === 'object') {
      args = JSON.stringify(args, null, 2);
    }
    return { type: 'tool', data: `[tool: ${tool}]\n${args}\n` };
  } else if (etype === 'tool_result') {
    const part = (event.part as Record<string, unknown>) ?? {};
    let result = (part.output ?? part.result ?? '') as unknown;
    if (typeof result === 'object') {
      result = JSON.stringify(result, null, 2);
    }
    return { type: 'tool_result', data: `[result]\n${result}\n` };
  } else if (etype === 'step_start') {
    return { type: 'status', data: '--- step ---\n' };
  } else if (etype === 'step_finish') {
    const part = (event.part as Record<string, unknown>) ?? {};
    const tokens = (part.tokens as Record<string, unknown>) ?? {};
    const cost = (part.cost as number) ?? 0;
    if (tokens || cost) {
      return {
        type: 'status',
        data: `--- done (tokens: ${tokens.total ?? 0}, cost: $${cost.toFixed(4)}) ---\n`,
      };
    }
  } else if (etype === 'error') {
    const err = (event.error as Record<string, unknown>) ?? {};
    const msg =
      ((err.data as Record<string, unknown>)?.message as string) ??
      (err.name as string) ??
      'unknown error';
    return { type: 'error', data: `[error] ${msg}\n` };
  }

  return null;
}

export class Executor {
  private processes = new Map<string, ReturnType<typeof spawn>>();
  private streams = new Map<string, AsyncQueue<StreamEvent | null>>();

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
   * the CLI.
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

  async startRun(runId: string, routine: RoutineRow, prompt: string): Promise<void> {
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

    const queue = new AsyncQueue<StreamEvent | null>();
    this.streams.set(runId, queue);

    try {
      let workdir: string;
      try {
        workdir = await this.prepareWorkspace(routine);
      } catch (err) {
        db.prepare(
          `UPDATE runs SET status = 'failed', stderr = ?, finished_at = ? WHERE id = ?`
        ).run(`Workspace preparation failed: ${err}`, new Date().toISOString(), runId);
        eventBus.broadcast('run_finished', {
          run_id: runId,
          routine_id: routine.id,
          status: 'failed',
        });
        queue.push(null);
        this.streams.delete(runId);
        return;
      }

      const env = this.buildEnv(routine);
      const cmd = [config.opencodePath, 'run', fullPrompt];
      if (routine.model) {
        cmd.push('--model', routine.model);
      } else if (config.opencodeModel) {
        cmd.push('--model', config.opencodeModel);
      }
      cmd.push('--format', 'json');

      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(cmd[0], cmd.slice(1), {
          cwd: workdir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (err) {
        db.prepare(
          `UPDATE runs SET status = 'failed', stderr = ?, finished_at = ? WHERE id = ?`
        ).run(`Failed to start opencode: ${err}`, new Date().toISOString(), runId);
        eventBus.broadcast('run_finished', {
          run_id: runId,
          routine_id: routine.id,
          status: 'failed',
        });
        queue.push(null);
        this.streams.delete(runId);
        return;
      }

      this.processes.set(runId, proc);

      const stdoutBuf: string[] = [];
      const stderrBuf: string[] = [];

      // Track whether we've seen a step_finish so we can apply an idle
      // timeout — the opencode CLI sometimes hangs after finishing.
      let sawStepFinish = false;
      let killedByIdleTimeout = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const IDLE_TIMEOUT_MS = 15_000; // 15 seconds after last step_finish with no new output

      const resetIdleTimer = () => {
        if (idleTimer) {
          clearTimeout(idleTimer);
        }
        idleTimer = null;
      };

      const startIdleTimer = () => {
        resetIdleTimer();
        idleTimer = setTimeout(() => {
          killedByIdleTimeout = true;
          console.warn(
            `[executor] Run ${runId}: opencode process idle for ${IDLE_TIMEOUT_MS / 1000}s after step_finish — killing.`
          );
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (this.processes.has(runId)) {
              proc.kill('SIGKILL');
            }
          }, 5000);
        }, IDLE_TIMEOUT_MS);
      };

      const rl = readline.createInterface({ input: proc.stdout! });
      rl.on('line', (line) => {
        const parsed = parseOpencodeEvent(line);
        if (parsed) {
          stdoutBuf.push(JSON.stringify(parsed));
          queue.push(parsed);

          // Detect step_finish to start idle timeout
          if (parsed.type === 'status' && parsed.data.startsWith('--- done')) {
            sawStepFinish = true;
            startIdleTimer();
          } else {
            // Any other output resets the idle timer (new step may have started)
            if (sawStepFinish) {
              sawStepFinish = false;
              resetIdleTimer();
            }
          }
        }
      });

      proc.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        stderrBuf.push(text);
        queue.push({ type: 'stderr', data: text });
      });

      // Wait for readline to finish processing all buffered lines before
      // relying on the process exit code.  This avoids a race where
      // proc.on('close') fires before readline has emitted trailing lines.
      const rlClosed = new Promise<void>((resolve) => rl.on('close', resolve));

      const exitCode = await new Promise<number>((resolve) => {
        proc.on('close', (code) => resolve(code ?? 1));
      });

      resetIdleTimer();
      await rlClosed;

      // Re-read status from DB — cancel may have already transitioned it
      const currentRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        | { status: string }
        | undefined;
      const alreadyCancelled = currentRow?.status === 'cancelled';

      const MAX = 1024 * 1024;
      if (alreadyCancelled) {
        // Preserve cancelled status, just persist output
        db.prepare(`UPDATE runs SET stdout = ?, stderr = ?, exit_code = ? WHERE id = ?`).run(
          stdoutBuf.join('\n').slice(0, MAX),
          stderrBuf.join('').slice(0, MAX),
          exitCode,
          runId
        );
      } else {
        const finalStatus =
          exitCode === 0 || (killedByIdleTimeout && sawStepFinish) ? 'success' : 'failed';
        db.prepare(
          `UPDATE runs SET stdout = ?, stderr = ?, exit_code = ?, status = ?, finished_at = ? WHERE id = ?`
        ).run(
          stdoutBuf.join('\n').slice(0, MAX),
          stderrBuf.join('').slice(0, MAX),
          exitCode,
          finalStatus,
          new Date().toISOString(),
          runId
        );
        eventBus.broadcast('run_finished', {
          run_id: runId,
          routine_id: routine.id,
          status: finalStatus,
          exit_code: exitCode,
        });
      }
    } catch (err) {
      // Don't overwrite cancelled status on unexpected errors either
      const currentRow = db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as
        | { status: string }
        | undefined;
      if (currentRow?.status !== 'cancelled') {
        db.prepare(
          `UPDATE runs SET status = 'failed', stderr = ?, finished_at = ? WHERE id = ?`
        ).run(`Unexpected error: ${err}`, new Date().toISOString(), runId);
        eventBus.broadcast('run_finished', {
          run_id: runId,
          routine_id: routine.id,
          status: 'failed',
        });
      }
    } finally {
      queue.push(null);
      this.processes.delete(runId);
      this.streams.delete(runId);
    }
  }

  async cancelRun(runId: string): Promise<void> {
    // DB is source of truth — mark cancelled unconditionally
    db.prepare(
      `UPDATE runs SET status = 'cancelled', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status IN ('pending', 'running')`
    ).run(new Date().toISOString(), runId);

    eventBus.broadcast('run_cancelled', { run_id: runId, status: 'cancelled' });

    // Best-effort kill if we still have the process handle
    const proc = this.processes.get(runId);
    if (proc) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      if (this.processes.has(runId)) {
        proc.kill('SIGKILL');
      }
    }

    // Clean up stream so SSE clients get notified
    const queue = this.streams.get(runId);
    queue?.push(null);
  }

  getStream(runId: string): AsyncQueue<StreamEvent | null> | undefined {
    return this.streams.get(runId);
  }
}

export const executor = new Executor();

import cron from 'node-cron';
import * as fs from 'fs';
import { db } from '../database';
import { eventBus } from './eventBus';
import type { TriggerRow, RoutineRow } from '../types';

class SchedulerService {
  private tasks = new Map<string, cron.ScheduledTask>();

  start(): void {
    const triggers = db
      .prepare(
        `
      SELECT t.* FROM triggers t
      JOIN routines r ON r.id = t.routine_id
      WHERE t.type = 'cron' AND t.enabled = 1 AND r.enabled = 1
    `
      )
      .all() as TriggerRow[];

    for (const trigger of triggers) {
      const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(trigger.routine_id) as
        | RoutineRow
        | undefined;
      if (routine) {
        try {
          this.registerTrigger(trigger, routine);
        } catch (err) {
          console.error(`Failed to register cron trigger ${trigger.id}:`, err);
        }
      }
    }

    console.log(`Scheduler started with ${triggers.length} cron triggers`);
  }

  shutdown(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }

  registerTrigger(trigger: TriggerRow, routine: RoutineRow): void {
    const triggerConfig = JSON.parse(trigger.config) as Record<string, unknown>;
    const expression = (triggerConfig.expression as string) ?? '';

    if (!expression) {
      console.warn(`Cron trigger ${trigger.id} has no expression`);
      return;
    }

    if (!cron.validate(expression)) {
      console.warn(`Cron trigger ${trigger.id} has invalid expression: ${expression}`);
      return;
    }

    // Remove existing job if any
    this.unregisterTrigger(trigger.id);

    const task = cron.schedule(expression, () => {
      this.executeRoutine(routine.id, trigger.id).catch((err) =>
        console.error(`Cron execution error for trigger ${trigger.id}:`, err)
      );
    });

    this.tasks.set(trigger.id, task);
    console.log(`Registered cron trigger ${trigger.id}: ${expression}`);
  }

  unregisterTrigger(triggerId: string): void {
    const task = this.tasks.get(triggerId);
    if (task) {
      task.stop();
      this.tasks.delete(triggerId);
      console.log(`Unregistered cron trigger ${triggerId}`);
    }
  }

  private async executeRoutine(routineId: string, triggerId: string): Promise<void> {
    // Lazy import to avoid circular dependency
    const { executor } = await import('./executor');
    const { randomUUID } = await import('crypto');

    const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId) as
      | RoutineRow
      | undefined;
    if (!routine || !routine.enabled) {
      return;
    }

    // Pre-flight: skip if the workspace folder is no longer accessible
    if (routine.workspace_path) {
      try {
        const stat = fs.statSync(routine.workspace_path);
        if (!stat.isDirectory()) {
          throw new Error('not a directory');
        }
      } catch {
        console.warn(
          `Skipping cron run for routine ${routineId}: workspace folder is no longer accessible: ${routine.workspace_path}`
        );
        return;
      }
    }

    // If the routine is set to foreground-only, skip when no browser clients are connected
    if (routine.run_mode === 'foreground' && !eventBus.hasActiveClients) {
      console.log(
        `Skipping cron run for routine ${routineId}: run_mode=foreground and no active clients`
      );
      return;
    }

    const runId = randomUUID();
    db.prepare(
      `
      INSERT INTO runs (id, routine_id, routine_name, trigger_id, trigger_type, prompt, status, metadata, created_at)
      VALUES (?, ?, ?, ?, 'cron', ?, 'pending', '{}', ?)
    `
    ).run(runId, routine.id, routine.name, triggerId, routine.prompt, new Date().toISOString());

    executor
      .startRun(runId, routine, routine.prompt)
      .catch((err) => console.error(`Run ${runId} error:`, err));
  }
}

export const schedulerService = new SchedulerService();

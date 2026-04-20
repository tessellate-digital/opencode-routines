import { db } from '../database';
import type { RoutineRow, RoutineCreate, RoutineUpdate } from '../types';

export const routinesRepository = {
  findById(id: string): RoutineRow | undefined {
    return db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined;
  },

  findEnabledById(id: string): RoutineRow | undefined {
    return db.prepare('SELECT * FROM routines WHERE id = ? AND enabled = 1').get(id) as
      | RoutineRow
      | undefined;
  },

  findAll(filters?: { status?: string }): RoutineRow[] {
    if (filters?.status) {
      return db
        .prepare('SELECT * FROM routines WHERE last_run_status = ? ORDER BY created_at DESC')
        .all(filters.status) as RoutineRow[];
    }
    return db.prepare('SELECT * FROM routines ORDER BY created_at DESC').all() as RoutineRow[];
  },

  create(id: string, data: RoutineCreate): RoutineRow {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO routines (id, name, description, prompt, model, repository, branch, agent, env_vars, enabled, run_mode, workspace_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      id,
      data.name,
      data.description,
      data.prompt,
      data.model,
      data.repository,
      data.branch,
      data.agent,
      JSON.stringify(data.env_vars),
      data.enabled ? 1 : 0,
      data.run_mode,
      data.workspace_path,
      now,
      now
    );
    return this.findById(id)!;
  },

  update(id: string, data: RoutineUpdate): RoutineRow {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.prompt !== undefined) {
      updates.push('prompt = ?');
      values.push(data.prompt);
    }
    if (data.model !== undefined) {
      updates.push('model = ?');
      values.push(data.model);
    }
    if (data.repository !== undefined) {
      updates.push('repository = ?');
      values.push(data.repository);
    }
    if (data.branch !== undefined) {
      updates.push('branch = ?');
      values.push(data.branch);
    }
    if (data.agent !== undefined) {
      updates.push('agent = ?');
      values.push(data.agent);
    }
    if (data.env_vars !== undefined) {
      updates.push('env_vars = ?');
      values.push(JSON.stringify(data.env_vars));
    }
    if (data.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(data.enabled ? 1 : 0);
    }
    if (data.run_mode !== undefined) {
      updates.push('run_mode = ?');
      values.push(data.run_mode);
    }
    if (data.workspace_path !== undefined) {
      updates.push('workspace_path = ?');
      values.push(data.workspace_path);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      values.push(new Date().toISOString(), id);
      db.prepare(`UPDATE routines SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.findById(id)!;
  },

  delete(id: string): void {
    db.prepare('DELETE FROM routines WHERE id = ?').run(id);
  },
};

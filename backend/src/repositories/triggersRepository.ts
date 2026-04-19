import { db } from '../database';
import type { TriggerRow, TriggerCreate, TriggerUpdate } from '../types';

export const triggersRepository = {
  findById(id: string): TriggerRow | undefined {
    return db.prepare('SELECT * FROM triggers WHERE id = ?').get(id) as TriggerRow | undefined;
  },

  findEnabledByIdAndType(id: string, type: string): TriggerRow | undefined {
    return db
      .prepare('SELECT * FROM triggers WHERE id = ? AND type = ? AND enabled = 1')
      .get(id, type) as TriggerRow | undefined;
  },

  findByRoutineId(routineId: string): TriggerRow[] {
    return db.prepare('SELECT * FROM triggers WHERE routine_id = ?').all(routineId) as TriggerRow[];
  },

  findEnabled(type?: string): TriggerRow[] {
    if (type) {
      return db
        .prepare('SELECT * FROM triggers WHERE type = ? AND enabled = 1')
        .all(type) as TriggerRow[];
    }
    return db.prepare('SELECT * FROM triggers WHERE enabled = 1').all() as TriggerRow[];
  },

  create(
    id: string,
    routineId: string,
    data: TriggerCreate,
    config: Record<string, unknown>
  ): TriggerRow {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO triggers (id, routine_id, type, config, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(id, routineId, data.type, JSON.stringify(config), data.enabled ? 1 : 0, now);
    return this.findById(id)!;
  },

  update(id: string, data: TriggerUpdate): TriggerRow {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(data.config));
    }
    if (data.enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(data.enabled ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE triggers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.findById(id)!;
  },

  delete(id: string): void {
    db.prepare('DELETE FROM triggers WHERE id = ?').run(id);
  },

  routineExists(routineId: string): boolean {
    return !!db.prepare('SELECT id FROM routines WHERE id = ?').get(routineId);
  },
};

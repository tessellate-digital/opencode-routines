import { db } from '../database';
import type { RunRow, RoutineRow } from '../types';

export interface RunFilters {
  routineId?: string;
  status?: string;
  limit: number;
  offset: number;
}

export interface CreateRunParams {
  id: string;
  routineId: string;
  routineName: string;
  triggerId?: string | null;
  triggerType: string;
  prompt: string;
  parentRunId?: string | null;
  metadata: Record<string, unknown>;
}

export const runsRepository = {
  findById(id: string): RunRow | undefined {
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  },

  findAll(filters: RunFilters): RunRow[] {
    let sql = 'SELECT * FROM runs';
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (filters.routineId) {
      conditions.push('routine_id = ?');
      params.push(filters.routineId);
    }
    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (conditions.length) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(filters.limit, filters.offset);

    return db.prepare(sql).all(...params) as RunRow[];
  },

  findParentChain(startId: string, maxDepth = 50): RunRow[] {
    const startRow = this.findById(startId);
    if (!startRow) {
      return [];
    }

    const chain: RunRow[] = [startRow];
    let cur = startRow;

    for (let i = 0; i < maxDepth && cur.parent_run_id; i++) {
      const parent = this.findById(cur.parent_run_id);
      if (!parent) {
        break;
      }
      chain.unshift(parent);
      cur = parent;
    }

    return chain;
  },

  getRoutineName(routineId: string): string {
    const routine = db.prepare('SELECT name FROM routines WHERE id = ?').get(routineId) as
      | Pick<RoutineRow, 'name'>
      | undefined;
    return routine?.name ?? '';
  },

  markAsLost(id: string): void {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE runs SET status = 'lost', finished_at = ? WHERE id = ? AND status = 'running'`
    ).run(now, id);
  },

  create(params: CreateRunParams): void {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO runs (id, routine_id, routine_name, trigger_id, trigger_type, prompt, parent_run_id, status, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `
    ).run(
      params.id,
      params.routineId,
      params.routineName,
      params.triggerId ?? null,
      params.triggerType,
      params.prompt,
      params.parentRunId ?? null,
      JSON.stringify(params.metadata),
      now
    );
  },
};

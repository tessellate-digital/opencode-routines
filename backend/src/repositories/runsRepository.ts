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

  findParentChain(startId: string): RunRow[] {
    // Use recursive CTE to get entire thread in one query
    // First find the root (walk up), then get all descendants (walk down)
    const rows = db
      .prepare(
        `
        WITH RECURSIVE
          -- Find the root by walking up parent_run_id
          ancestors AS (
            SELECT * FROM runs WHERE id = ?
            UNION ALL
            SELECT r.* FROM runs r
            JOIN ancestors a ON r.id = a.parent_run_id
          ),
          -- Get the root (the one with no parent)
          root AS (
            SELECT * FROM ancestors WHERE parent_run_id IS NULL
            LIMIT 1
          ),
          -- Walk down from root to get all descendants
          thread AS (
            SELECT * FROM root
            UNION ALL
            SELECT r.* FROM runs r
            JOIN thread t ON r.parent_run_id = t.id
          )
        SELECT * FROM thread ORDER BY created_at ASC
        `
      )
      .all(startId) as RunRow[];

    return rows;
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

  markStaleAsLost(): number {
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE runs SET status = 'lost', finished_at = ? WHERE status IN ('running', 'pending')`
      )
      .run(now);
    return result.changes;
  },

  findRunningByRoutineId(routineId: string): RunRow[] {
    return db
      .prepare("SELECT * FROM runs WHERE routine_id = ? AND status IN ('running', 'pending')")
      .all(routineId) as RunRow[];
  },

  countByStatus(status: string): number {
    const row = db.prepare('SELECT COUNT(*) as count FROM runs WHERE status = ?').get(status) as {
      count: number;
    };
    return row.count;
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

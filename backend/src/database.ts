import Database from 'better-sqlite3';
import { config } from './config';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      repository TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT 'main',
      agent TEXT NOT NULL DEFAULT 'build',
      env_vars TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      run_mode TEXT NOT NULL DEFAULT 'background',
      workspace_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS triggers (
      id TEXT PRIMARY KEY,
      routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
      trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
      trigger_type TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      finished_at TEXT,
      exit_code INTEGER,
      stdout TEXT NOT NULL DEFAULT '',
      stderr TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      is_secret INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration: add run_mode column if it doesn't exist yet
  const routineColumns = (
    db.prepare('PRAGMA table_info(routines)').all() as { name: string }[]
  ).map((c) => c.name);
  if (!routineColumns.includes('run_mode')) {
    db.exec("ALTER TABLE routines ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'background'");
  }
  // Migration: add workspace_path column (local folder to run against)
  if (!routineColumns.includes('workspace_path')) {
    db.exec("ALTER TABLE routines ADD COLUMN workspace_path TEXT NOT NULL DEFAULT ''");
  }

  // Migration: make runs.routine_id nullable with ON DELETE SET NULL so that
  // deleting a routine preserves its run history.
  // SQLite doesn't support ALTER COLUMN, so we recreate the table if the old
  // schema (NOT NULL cascade) is still in place.
  const runsTableInfo = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='runs'")
    .get() as { sql: string } | undefined;
  if (runsTableInfo && /routine_id TEXT NOT NULL/i.test(runsTableInfo.sql)) {
    db.exec(`
      BEGIN;
      ALTER TABLE runs RENAME TO runs_old;
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        routine_id TEXT REFERENCES routines(id) ON DELETE SET NULL,
        trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
        trigger_type TEXT NOT NULL,
        prompt TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT,
        finished_at TEXT,
        exit_code INTEGER,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      INSERT INTO runs SELECT id, routine_id, trigger_id, trigger_type, '', status, started_at, finished_at, exit_code, stdout, stderr, metadata, created_at FROM runs_old;
      DROP TABLE runs_old;
      COMMIT;
    `);
  }

  // Migration: add prompt column to runs if it doesn't exist yet
  const runColumns = (db.prepare('PRAGMA table_info(runs)').all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!runColumns.includes('prompt')) {
    db.exec("ALTER TABLE runs ADD COLUMN prompt TEXT NOT NULL DEFAULT ''");
  }
  // Migration: add parent_run_id to link reply runs to their parent
  if (!runColumns.includes('parent_run_id')) {
    db.exec('ALTER TABLE runs ADD COLUMN parent_run_id TEXT DEFAULT NULL');
  }
  // Migration: add routine_name snapshot so the name persists even if routine is deleted
  if (!runColumns.includes('routine_name')) {
    db.exec("ALTER TABLE runs ADD COLUMN routine_name TEXT NOT NULL DEFAULT ''");
    // Back-fill existing rows from the routines table where the routine still exists
    db.exec(`
      UPDATE runs SET routine_name = (
        SELECT name FROM routines WHERE routines.id = runs.routine_id
      ) WHERE routine_id IS NOT NULL AND routine_name = ''
    `);
  }
}

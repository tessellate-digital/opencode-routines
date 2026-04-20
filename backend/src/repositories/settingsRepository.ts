import { db } from '../database';
import type { SettingRow, SettingCreate } from '../types';

export const settingsRepository = {
  findByKey(key: string): SettingRow | undefined {
    return db.prepare('SELECT * FROM settings WHERE key = ?').get(key) as SettingRow | undefined;
  },

  findAll(): SettingRow[] {
    return db.prepare('SELECT * FROM settings ORDER BY key').all() as SettingRow[];
  },

  upsert(data: SettingCreate): SettingRow {
    const now = new Date().toISOString();
    db.prepare(
      `
      INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at
    `
    ).run(data.key, data.value, data.is_secret ? 1 : 0, now);
    return this.findByKey(data.key)!;
  },

  exists(key: string): boolean {
    return !!db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  },

  delete(key: string): void {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  },
};

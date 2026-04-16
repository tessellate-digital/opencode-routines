import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { db } from '../database';
import { SettingCreateSchema } from '../types';
import type { SettingRow } from '../types';

const router = new Hono();

function settingToResponse(s: SettingRow) {
  return {
    key: s.key,
    value: s.is_secret ? '***' : s.value,
    is_secret: s.is_secret === 1,
    updated_at: s.updated_at,
  };
}

router.get('/', (c) => {
  const rows = db.prepare('SELECT * FROM settings ORDER BY key').all() as SettingRow[];
  return c.json(rows.map(settingToResponse));
});

router.put('/', zValidator('json', SettingCreateSchema), (c) => {
  const data = c.req.valid('json');
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO settings (key, value, is_secret, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_secret = excluded.is_secret, updated_at = excluded.updated_at
  `
  ).run(data.key, data.value, data.is_secret ? 1 : 0, now);

  const row = db.prepare('SELECT * FROM settings WHERE key = ?').get(data.key) as SettingRow;
  return c.json(settingToResponse(row));
});

router.delete('/:key', (c) => {
  const key = c.req.param('key');
  const row = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (!row) {
    return c.json({ detail: 'Setting not found' }, 404);
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  return new Response(null, { status: 204 });
});

export default router;

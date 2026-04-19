import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { settingsRepository } from '../repositories/settingsRepository';
import { SettingCreateSchema } from '../types';
import type { SettingRow } from '../types';
import { invalidateAll } from '../services/opencodeServerPool';

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
  const rows = settingsRepository.findAll();
  return c.json(rows.map(settingToResponse));
});

router.put('/', zValidator('json', SettingCreateSchema), (c) => {
  const data = c.req.valid('json');
  const row = settingsRepository.upsert(data);
  void invalidateAll();
  return c.json(settingToResponse(row));
});

router.delete('/:key', (c) => {
  const key = c.req.param('key');
  if (!settingsRepository.exists(key)) {
    return c.json({ detail: 'Setting not found' }, 404);
  }
  settingsRepository.delete(key);
  void invalidateAll();
  return new Response(null, { status: 204 });
});

export default router;

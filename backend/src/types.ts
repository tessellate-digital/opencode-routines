import { z } from 'zod';

// --- DB Row types ---

export interface RoutineRow {
  id: string;
  name: string;
  description: string;
  prompt: string;
  model: string;
  repository: string;
  branch: string;
  agent: string;
  env_vars: string;
  enabled: number;
  run_mode: string;
  workspace_path: string;
  last_run_status: string | null;
  triggers_count: number;
  created_at: string;
  updated_at: string;
}

export interface TriggerRow {
  id: string;
  routine_id: string;
  type: string;
  config: string;
  enabled: number;
  created_at: string;
}

export interface RunRow {
  id: string;
  routine_id: string | null;
  routine_name: string;
  trigger_id: string | null;
  trigger_type: string;
  prompt: string;
  parent_run_id: string | null;
  session_id: string | null;
  assistant_message_id: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  metadata: string;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
  is_secret: number;
  updated_at: string;
}

// --- Zod schemas ---

export const RoutineCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  prompt: z.string().min(1),
  model: z.string().default(''),
  repository: z.string().default(''),
  branch: z.string().default('main'),
  agent: z.string().default('build'),
  env_vars: z.record(z.string()).default({}),
  enabled: z.boolean().default(true),
  run_mode: z.enum(['background', 'foreground']).default('background'),
  workspace_path: z.string().default(''),
});

export const RoutineUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  prompt: z.string().min(1).optional(),
  model: z.string().optional(),
  repository: z.string().optional(),
  branch: z.string().optional(),
  agent: z.string().optional(),
  env_vars: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
  run_mode: z.enum(['background', 'foreground']).optional(),
  workspace_path: z.string().optional(),
});

export const TriggerCreateSchema = z.object({
  type: z.enum(['cron', 'api', 'github', 'watcher']),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const TriggerUpdateSchema = z.object({
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export const RunTriggerSchema = z.object({
  text: z.string().default(''),
});

export const SettingCreateSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  is_secret: z.boolean().default(false),
});

export type RoutineCreate = z.infer<typeof RoutineCreateSchema>;
export type RoutineUpdate = z.infer<typeof RoutineUpdateSchema>;
export type TriggerCreate = z.infer<typeof TriggerCreateSchema>;
export type TriggerUpdate = z.infer<typeof TriggerUpdateSchema>;
export type SettingCreate = z.infer<typeof SettingCreateSchema>;

import * as dotenv from 'dotenv';
dotenv.config();

function dbPath(url: string): string {
  if (url.startsWith('sqlite:///')) return url.slice('sqlite:///'.length);
  return url;
}

export const config = {
  dbPath: dbPath(process.env.DATABASE_URL ?? 'sqlite:////data/routines.db'),
  workspacesDir: process.env.WORKSPACES_DIR ?? '/workspaces',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  maxConcurrentRuns: parseInt(process.env.MAX_CONCURRENT_RUNS ?? '5', 10),
  opencodePath: process.env.OPENCODE_PATH ?? 'opencode',
  opencodeModel: process.env.OPENCODE_MODEL ?? '',
  port: parseInt(process.env.PORT ?? '8080', 10),
};

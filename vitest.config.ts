import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['backend/src/**/*.test.ts', 'frontend/src/**/*.test.ts'],
  },
});

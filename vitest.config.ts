import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    // The e2e suite drives a stateful fake device per test; keep them isolated.
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

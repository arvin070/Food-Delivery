import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // The API talks to a real Postgres, so suites must not interleave writes.
    fileParallelism: false,
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
hookTimeout: 30_000,
  },
});

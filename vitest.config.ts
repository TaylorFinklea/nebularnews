import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure unit tests against the helper code. We deliberately avoid pulling
    // in @cloudflare/vitest-pool-workers (which spins up Miniflare per-test)
    // because the helpers we care about right now are pure functions; the
    // setup tax outweighs the benefit at current coverage size.
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});

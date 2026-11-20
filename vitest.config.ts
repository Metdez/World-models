import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Worker modules import the workerd-only 'cloudflare:workers'; node tests get a minimal shim.
    alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/fixtures/01-01-cloudflare-workers.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    pool: 'forks',
    // --expose-gc: the sim-core no-allocation test measures the heap delta (ARCHITECTURE §7.6).
    execArgv: ['--expose-gc'],
  },
});

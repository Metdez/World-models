import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Browsers are pre-installed (PLAYWRIGHT_BROWSERS_PATH); never run `playwright install`.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  // Production runs (PLAYWRIGHT_BASE_URL set) need no local server. `npm run e2e` builds first.
  ...(process.env.PLAYWRIGHT_BASE_URL
    ? {}
    : { webServer: { command: `npx vite preview --port ${PORT} --strictPort`, url: baseURL, reuseExistingServer: true, timeout: 120_000 } }),
});

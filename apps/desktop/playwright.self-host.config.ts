import { defineConfig, devices } from '@playwright/test';
import { serverUrl } from './e2e/environment';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'self-host-smoke.spec.ts',
  globalSetup: './e2e/self-host-global-setup.ts',
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: serverUrl,
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
  },
});

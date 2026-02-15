import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8788';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    headless: true
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx wrangler dev --local --port 8788',
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
});

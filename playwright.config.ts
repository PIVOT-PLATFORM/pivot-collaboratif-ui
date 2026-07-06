import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  // CI runner ubuntu-latest = 4 vCPU. 2 workers parallélisent les specs sans saturer
  // le backend pivot-core (conteneur unique). Local : Playwright auto-détecte (undefined).
  workers: process.env['CI'] ? 2 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

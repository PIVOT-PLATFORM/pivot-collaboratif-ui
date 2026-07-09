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
    // This repo has no Angular-side auth mechanism yet (CLAUDE.md, "Auth (différée)" — no
    // AuthService/AuthInterceptor; deferred to @pivot-platform/ui-core, not yet published).
    // Specs that call real pivot-collaboratif-core endpoints (EN08.3 requires a bearer token)
    // need the browser context itself to attach one — e2e.yml seeds a matching public.users/
    // access_tokens row and passes the raw token here. Undefined locally (no auth needed
    // against a dev backend without EN08.3 enforcement), set only in CI.
    extraHTTPHeaders: process.env['E2E_BEARER_TOKEN']
      ? { Authorization: `Bearer ${process.env['E2E_BEARER_TOKEN']}` }
      : undefined,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

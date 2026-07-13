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
    // --- Éphémère (mocké / stack jetable) — joué par e2e.yml sur chaque PR/push ---------------
    // Scopé explicitement à ./e2e pour qu'il ne ramasse JAMAIS les specs de ./e2e-recette
    // (qui visent l'infra réelle et ne doivent tourner que via le projet `recette`).
    {
      name: 'chromium',
      testDir: './e2e',
      use: { ...devices['Desktop Chrome'] },
    },

    // --- Recette (infra RÉELLE) — joué par e2e-recette.yml après déploiement ------------------
    // Se connecte une fois avec le compte de recette dédié, sauvegarde la session, puis les
    // specs recette la réutilisent. baseURL = site déployé (shell pivot-ui), jamais localhost.
    {
      name: 'recette-setup',
      testDir: './e2e-recette',
      testMatch: /recette\.setup\.ts/,
      use: {
        baseURL: process.env['RECETTE_BASE_URL'] ?? 'https://recette.pivot-platform.fr',
      },
    },
    {
      name: 'recette',
      testDir: './e2e-recette',
      testIgnore: /recette\.setup\.ts/,
      dependencies: ['recette-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env['RECETTE_BASE_URL'] ?? 'https://recette.pivot-platform.fr',
        storageState: 'e2e-recette/.auth/recette.json',
      },
    },
  ],
});

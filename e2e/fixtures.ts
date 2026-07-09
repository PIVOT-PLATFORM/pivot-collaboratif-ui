import { test as base, expect } from '@playwright/test';

/**
 * Shared Playwright fixture — every spec imports `test`/`expect` from here instead of
 * `@playwright/test` directly.
 *
 * <p>This repo has no Angular-side auth mechanism yet (no `AuthService`/`AuthInterceptor` —
 * deferred to `@pivot-platform/ui-core`, not yet published). REST calls get their bearer token
 * from `playwright.config.ts`'s `extraHTTPHeaders` (a real HTTP header, browser-level), but
 * WebSocket STOMP frames aren't plain HTTP headers — `WhiteboardSyncService` reads the token
 * from `window.__PIVOT_E2E_BEARER_TOKEN__` instead (see that service's `buildConnectHeaders`
 * JSDoc), which this fixture injects before every page navigation via `page.addInitScript`.
 * Undefined locally (no `E2E_BEARER_TOKEN` env var) — a no-op, matching `extraHTTPHeaders`'s own
 * fallback in `playwright.config.ts`.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    const token = process.env['E2E_BEARER_TOKEN'];
    if (token) {
      await page.addInitScript(t => {
        (window as unknown as { __PIVOT_E2E_BEARER_TOKEN__?: string }).__PIVOT_E2E_BEARER_TOKEN__ = t;
      }, token);
    }
    await use(page);
  },
});

export { expect };

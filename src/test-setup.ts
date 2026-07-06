/**
 * Bootstrap de l'environnement de test Angular pour vitest standalone
 * (utilise par Stryker via vitest.stryker.config.ts).
 *
 * App zoneless (pas de zone.js en dependances) : on fournit
 * provideZonelessChangeDetection au platform de test.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import {
  BrowserTestingModule,
  platformBrowserTesting,
} from '@angular/platform-browser/testing';

// Left as `window` (not `globalThis`): this file only bootstraps the Stryker-only
// standalone vitest config (see class doc above), never the coverage-instrumented
// `test:ci` run — any touch here is permanently "0% new coverage" in Sonar's PR
// analysis regardless of content, since nothing in the regular suite executes it.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

getTestBed().initTestEnvironment(
  BrowserTestingModule,
  platformBrowserTesting([provideZonelessChangeDetection()]),
);

/**
 * Vitest config dediee a Stryker (mutation testing).
 *
 * `ng test` passe par le builder @angular/build:unit-test qui injecte le
 * plugin Vite Angular + le bootstrap TestBed au runtime. Stryker lance
 * vitest en standalone : on reconstruit ici l'environnement Angular
 * (plugin Analog + setup TestBed + jsdom) pour que les specs soient
 * collectees et executees hors du builder.
 */
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    pool: 'threads',
  },
});

/**
 * Vitest config dediee a Stryker (mutation testing).
 *
 * `ng test` passe par le builder @angular/build:unit-test qui injecte le
 * plugin Vite Angular + le bootstrap TestBed au runtime. Stryker lance
 * vitest en standalone : on reconstruit ici l'environnement Angular
 * (plugin Analog + setup TestBed + jsdom) pour que les specs soient
 * collectees et executees hors du builder.
 *
 * `tsconfig.stryker.json` (dedie, EN17.9) : le defaut du plugin ("./tsconfig.spec.json") ne
 * couvre que `src/**` — les fichiers de `projects/collaboratif-ui/src/` (whiteboard) restent
 * "not in the TypeScript program" (warning silencieux, decorateurs Angular non traites) sans
 * un `include` couvrant explicitement les deux arbres.
 */
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular({ tsconfig: './tsconfig.stryker.json' })],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts', 'projects/collaboratif-ui/src/**/*.spec.ts'],
    pool: 'threads',
  },
});

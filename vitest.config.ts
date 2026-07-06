import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});

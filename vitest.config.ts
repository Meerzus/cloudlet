import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** The site's `@/` imports (apps/site/tsconfig.json), for tests that render its components. */
const site = fileURLToPath(new URL('./apps/site/src', import.meta.url));
/** Site components import the package by name; tests take its source, so a fresh clone needs no build. */
const toast = fileURLToPath(new URL('./packages/toast/src/index.ts', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] } },
      { resolve: { alias: [{ find: /^@cloudlet\/toast$/, replacement: toast }, { find: '@', replacement: site }] }, test: {
        name: 'react', environment: 'jsdom', include: ['tests/react/**/*.test.tsx'],
        setupFiles: ['tests/setup/react.ts'],
      } },
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});

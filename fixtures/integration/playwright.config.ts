import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'consumer.spec.ts', fullyParallel: false, workers: 1,
  timeout: 90_000, expect: { timeout: 10_000 }, forbidOnly: Boolean(process.env['CI']),
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('../../artifacts/integration/consumer-browser-results.json', import.meta.url)) }]],
  outputDir: fileURLToPath(new URL('../../artifacts/integration/browser-results', import.meta.url)),
  use: { trace: 'retain-on-failure', viewport: { width: 1100, height: 820 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: { command: 'node scripts/integration-serve.mjs', cwd: fileURLToPath(new URL('../../', import.meta.url)), url: 'http://127.0.0.1:4282', reuseExistingServer: false, timeout: 120_000 },
});

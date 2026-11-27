import { defineConfig, devices } from '@playwright/test';

const WEBMCP = 'webmcp.spec.ts';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: WEBMCP },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: WEBMCP },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: WEBMCP },
    // WebMCP is behind a flag in Chromium: only this project turns it on, and runs only its own file.
    { name: 'chromium-webmcp', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--enable-features=WebMCP'] } }, testMatch: WEBMCP },
  ],
  webServer: {
    command: 'npm run build && npm run build:lab && node scripts/serve-csp.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

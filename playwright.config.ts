import { defineConfig } from 'playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1720, height: 960 }
  },
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixels: 200,
      maxDiffPixelRatio: 0.01,
      threshold: 0.2,
      animations: 'disabled'
    }
  }
})

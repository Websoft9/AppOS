import { fileURLToPath } from 'url'
import path from 'path'
import { defineConfig, devices } from '@playwright/test'

const testsRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: path.resolve(testsRoot, './e2e'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.APPOS_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})

import { defineConfig, devices } from '@playwright/test'

/**
 * §5b authed-staff render harness (go-live-checklist §5b — the standing
 * decision's re-trigger, stood up 2026-07-21 as Step 6 of the internal work
 * sequence).
 *
 * Runs against the LOCAL dev server on :3000, which — since the
 * environment-separation flip — targets the STAGING project and its
 * synthetic seed (scripts/seed-staging.mjs). Credentials come from the
 * .env.local STAGING_DEV_LOGIN_* block the seed writes; nothing here can
 * reach production.
 *
 * Run:  npm run test:e2e        (expects the :3000 dev server; will start
 *                                one via `npm run dev` if none is running)
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'staff',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/staff.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})

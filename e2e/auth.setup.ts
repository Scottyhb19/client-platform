import { test as setup, expect } from '@playwright/test'
import { loadEnv } from './helpers'

/**
 * Logs the seeded staff owner in through the REAL /login form (so the run
 * also exercises the login action end-to-end, including its G-6 emitter)
 * and saves the storage state every staff spec reuses.
 */
setup('authenticate as the seeded staff owner', async ({ page }) => {
  const env = loadEnv()

  await page.goto('/login')
  await page.getByLabel('Email').fill(env.STAGING_DEV_LOGIN_EMAIL)
  await page.getByLabel('Password').fill(env.STAGING_DEV_LOGIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await page.waitForURL('**/dashboard', { timeout: 20_000 })
  await expect(page).toHaveURL(/\/dashboard/)

  await page.context().storageState({ path: 'e2e/.auth/staff.json' })
})

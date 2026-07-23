import { test, expect } from '@playwright/test'
import {
  loadEnv,
  stagingAdmin,
  createClaimlessUser,
  deleteAuthUser,
  ensureArchivedPortalUser,
} from './helpers'

/**
 * 2026-07-23 parity-pass render coverage — the logged-out flows:
 *
 *   - G-15 closure test: a logged-out deep link to a staff route OUTSIDE
 *     /dashboard survives login (the middleware's widened isProtected list
 *     sets ?next=; the login action honours it via safeNext).
 *   - G-15 negative control: a claimless user still lands on
 *     /onboarding/org — the deep link must NOT override role routing.
 *   - P2-3: an ARCHIVED client's portal login renders the designed closed
 *     door, not the onboarding funnel.
 *
 * Every test here runs with a CLEAN storage state (no inherited staff
 * session) — that is the whole point.
 */
test.use({ storageState: { cookies: [], origins: [] } })

test('G-15: logged-out deep link to /clients/<id> survives login', async ({
  page,
}) => {
  const env = loadEnv()
  const admin = stagingAdmin()
  const { data: jordan } = await admin
    .from('clients')
    .select('id')
    .eq('email', 'delivered+dev-client@resend.dev')
    .single()

  await page.goto(`/clients/${jordan!.id}`)
  // The widened middleware list fires pre-render: bounced to /login with next=.
  await page.waitForURL(/\/login\?next=/)
  expect(page.url()).toContain(encodeURIComponent(`/clients/${jordan!.id}`))

  await page.getByLabel('Email').fill(env.STAGING_DEV_LOGIN_EMAIL)
  await page.getByLabel('Password').fill(env.STAGING_DEV_LOGIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // The deep link survives: we land on the client profile, not /dashboard.
  await page.waitForURL(`**/clients/${jordan!.id}`, { timeout: 20_000 })
  await expect(page.getByText('Jordan Sample').first()).toBeVisible()
})

test('G-15 negative control: role routing beats the deep link for a claimless user', async ({
  page,
}) => {
  const u = await createClaimlessUser()
  try {
    const admin = stagingAdmin()
    const { data: jordan } = await admin
      .from('clients')
      .select('id')
      .eq('email', 'delivered+dev-client@resend.dev')
      .single()

    await page.goto(`/clients/${jordan!.id}`)
    await page.waitForURL(/\/login\?next=/)

    await page.getByLabel('Email').fill(u.email)
    await page.getByLabel('Password').fill(u.password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    // C-4's DESIGNED claimless landing: null role → /portal (so a stale-JWT
    // client can self-correct) → the portal layout routes a still-claimless
    // session on to /unauthorized (the R-5 recovery dead-end). The deep link
    // must NOT override that — the first run of this control asserted
    // /onboarding/org and the trace corrected the expectation to the real
    // C-4 chain.
    await page.waitForURL('**/unauthorized', { timeout: 20_000 })
    expect(page.url()).not.toContain(`/clients/${jordan!.id}`)

    // The /onboarding/org claimless branch fires on direct STAFF-ROUTE
    // navigation (requireRole), not on login landing — assert it where it
    // actually lives.
    await page.goto(`/clients/${jordan!.id}`)
    await page.waitForURL('**/onboarding/org', { timeout: 20_000 })
  } finally {
    await deleteAuthUser(u.id)
  }
})

test('P2-3: an archived client sees the closed door, not the onboarding funnel', async ({
  page,
}) => {
  const fixture = await ensureArchivedPortalUser()

  await page.goto('/login')
  await page.getByLabel('Email').fill(fixture.email)
  await page.getByLabel('Password').fill(fixture.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // The portal layout's archived branch renders AccessEnded (no /welcome).
  await expect(
    page.getByText('Your portal access has ended'),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('button', { name: 'Sign out' }),
  ).toBeVisible()
  expect(page.url()).not.toContain('/welcome')
})

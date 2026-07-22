import { test, expect } from '@playwright/test'
import { loadEnv, stagingAdmin } from './helpers'

/**
 * §5b render-tier assertions over the seeded staging data — the browser
 * coverage the go-live checklist accepted-by-decision until this harness
 * existed. Each test asserts that a staff surface actually PAINTS the
 * computed state (the tier below is already machine-gated by pgTAP/tsc).
 *
 * Coverage maps to the 2026-07-21 sequence steps:
 *   - dashboard + client list render the seeded trigger states (baseline)
 *   - archived profile renders read-only with Restore (CN-7 / Step 2 UI)
 *   - completed-day builder page renders its lock state (Step 2 UI)
 *   - Comms tab renders the logged communication (Step 5)
 *   - the setup login left a G-6 auth.login.success row (Step 3)
 */

let jordanId: string
let averyId: string
let lockedDayId: string
let ownerUserId: string

test.beforeAll(async () => {
  const admin = stagingAdmin()

  const { data: jordan } = await admin
    .from('clients')
    .select('id')
    .eq('email', 'delivered+dev-client@resend.dev')
    .single()
  jordanId = jordan!.id

  const { data: avery } = await admin
    .from('clients')
    .select('id')
    .eq('email', 'delivered+avery-archived@resend.dev')
    .single()
  averyId = avery!.id

  // A completed, still-assigned day (the builder lock state) for Jordan.
  const { data: sess } = await admin
    .from('sessions')
    .select('program_day_id')
    .eq('client_id', jordanId)
    .not('completed_at', 'is', null)
    .not('program_day_id', 'is', null)
    .limit(1)
    .single()
  lockedDayId = sess!.program_day_id as string

  const env = loadEnv()
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  ownerUserId = users.users.find((u) => u.email === env.STAGING_DEV_LOGIN_EMAIL)!.id
})

test('dashboard renders the seeded needs-attention states', async ({ page }) => {
  await page.goto('/dashboard')
  // Seeded triggers that must paint in the needs-attention panel:
  // Morgan (Overdue — last session 13 days ago) and Casey (Ending + Flag).
  await expect(
    page.getByRole('link', { name: 'Morgan Overdue' }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Casey Demo' }).first(),
  ).toBeVisible()
  await expect(page.getByText('Needs attention').first()).toBeVisible()
})

test('client list renders seeded clients', async ({ page }) => {
  await page.goto('/clients')
  await expect(page.getByText('Jordan Sample').first()).toBeVisible()
  await expect(page.getByText('Casey Demo').first()).toBeVisible()
})

test('archived client profile renders read-only with Restore (CN-7)', async ({
  page,
}) => {
  await page.goto(`/clients/${averyId}`)
  await expect(page.getByText(/archived/i).first()).toBeVisible()
  await expect(
    page.getByRole('button', { name: /restore/i }).first(),
  ).toBeVisible()
})

test('completed-and-assigned day renders the builder LOCK state', async ({
  page,
}) => {
  await page.goto(`/clients/${jordanId}/program/days/${lockedDayId}`)
  // The LockedBanner (SessionLockContext): a completed, still-assigned day
  // is read-only until unassigned. This is Step 2's UI half painting.
  await expect(
    page.getByText('This session is locked', { exact: false }),
  ).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/unassign it above/i)).toBeVisible()
})

test('Comms tab renders the logged communication (§12 Part B)', async ({
  page,
}) => {
  await page.goto(`/clients/${jordanId}?tab=comms`)
  const row = page.getByRole('button', { name: /Welcome to the portal/ })
  await expect(row).toBeVisible()
  await row.click()
  await expect(
    page.getByText('Synthetic welcome email (seed data).'),
  ).toBeVisible()
})

test('Comms tab labels a reminder summary and surfaces a failed send (§12 Part B)', async ({
  page,
}) => {
  await page.goto(`/clients/${jordanId}?tab=comms`)

  // A delivered reminder is a SYSTEM send whose stored body is a factual
  // summary line, not the verbatim email — the tab must say so, or an EP
  // reads it back as the message that actually went out.
  const sentReminder = page
    .getByRole('button')
    .filter({ hasText: 'Appointment reminder' })
    .filter({ hasText: 'Sent' })
    .first()
  await expect(sentReminder).toBeVisible()
  await sentReminder.click()
  await expect(
    page.getByText(/the exact message sent isn.t stored/i),
  ).toBeVisible()

  // A FAILED reminder is the EP-facing surfacing of a failed send (FM-5):
  // the row reads Failed and expands to its failure reason.
  const failedReminder = page
    .getByRole('button')
    .filter({ hasText: 'Appointment reminder' })
    .filter({ hasText: 'Failed' })
    .first()
  await expect(failedReminder).toBeVisible()
  await failedReminder.click()
  await expect(
    page.getByText('resend 550 mailbox unavailable (seed)'),
  ).toBeVisible()
})

test('Comms tab renders for an ARCHIVED client — the record outlives the archive (FM-8)', async ({
  page,
}) => {
  await page.goto(`/clients/${averyId}?tab=comms`)
  // The intersection the build doc claims (Comms tab renders for archived
  // clients): the archived read-only chrome AND the comms record on one page.
  await expect(page.getByText(/archived/i).first()).toBeVisible()
  const row = page.getByRole('button', {
    name: /Your records — copy on close-out/,
  })
  await expect(row).toBeVisible()
  await row.click()
  await expect(
    page.getByText('Synthetic archived-client comms (seed data).'),
  ).toBeVisible()
})

test('the harness login left a G-6 auth.login.success row', async () => {
  const admin = stagingAdmin()
  const { data } = await admin
    .from('auth_events')
    .select('id, occurred_at')
    .eq('event', 'auth.login.success')
    .eq('user_id', ownerUserId)
    .gte('occurred_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
  expect((data ?? []).length).toBeGreaterThan(0)
})

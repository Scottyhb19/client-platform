/**
 * Env vars the Next.js app requires at runtime in every deployed
 * environment. Checked by /api/health so a missing var is caught by the
 * first post-deploy probe instead of by a user mid-flow.
 *
 * 2026-06-10 incident: NEXT_PUBLIC_SITE_URL was set in .env.local but never
 * in the Vercel production environment. getPublicOrigin() fails loud by
 * design, so owner/staff sign-in, /auth/callback, forgot-password, signup,
 * and invite sends all 500'd on production while localhost worked. A
 * health-endpoint config check turns that class of failure into a
 * one-curl diagnosis.
 *
 * Scope notes:
 * - Names only ever leave this module — never values.
 * - PUBLIC_SIGNUP_ENABLED is deliberately absent: unset means "disabled",
 *   which is a valid configuration, not a fault.
 * - CRON_SHARED_SECRET and VERIFY_EMAIL_DOMAIN are consumed by the
 *   Supabase Edge Function and operator scripts respectively, not by the
 *   Next.js runtime, so they are not asserted here.
 * - NEXT_PUBLIC_APP_URL was RETIRED from this list 2026-07-23 (Flag E
 *   resolved): the origin-idiom consolidation made NEXT_PUBLIC_SITE_URL
 *   canonical and removed every app-side reader; the operator then removed
 *   the Vercel copy. The only surviving reader is the reminder Edge
 *   Function's own secret-store copy, which this Next.js check cannot and
 *   should not assert.
 */
const REQUIRED_ENV_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'NEXT_PUBLIC_SITE_URL',
] as const

/** Names of required env vars that are unset or blank. Empty = healthy. */
export function missingRequiredEnv(): string[] {
  return REQUIRED_ENV_VARS.filter((name) => {
    const value = process.env[name]
    return !value || value.trim() === ''
  })
}

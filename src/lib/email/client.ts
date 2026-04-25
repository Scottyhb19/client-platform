import { Resend } from 'resend'

/**
 * Lazily-initialised Resend client. Reads RESEND_API_KEY at call time so
 * importing this file in a build phase that doesn't have the env var
 * (e.g. during a `next build` without secrets) doesn't crash.
 *
 * Use ONLY from server code (server actions, route handlers, cron). The
 * Resend SDK should never end up in a client bundle.
 */
let cachedClient: Resend | null = null

export function getResendClient(): Resend {
  if (cachedClient) return cachedClient
  const key = process.env.RESEND_API_KEY
  if (!key) {
    throw new Error(
      'RESEND_API_KEY is not set. Add it to .env.local (see README) before sending email.',
    )
  }
  cachedClient = new Resend(key)
  return cachedClient
}

/**
 * The address Resend's onboarding domain accepts. Use this until a custom
 * sending domain is verified in the Resend dashboard. Switch by setting the
 * EMAIL_FROM env var, e.g. EMAIL_FROM="Odyssey <invites@yourpractice.com.au>"
 */
export function defaultFromAddress(): string {
  return process.env.EMAIL_FROM ?? 'Odyssey <onboarding@resend.dev>'
}

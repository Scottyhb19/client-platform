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
 * Configuration error thrown when a required email env var is missing.
 * Mirrors the fail-loud, first-use throw pattern in getResendClient().
 */
export class EmailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigError'
  }
}

/**
 * The verified-domain sender address, read from EMAIL_FROM at call time.
 * Throws EmailConfigError if unset — we refuse to fall back to the Resend
 * sandbox sender, which only delivers to the Resend-account-verified
 * address and silently blocks every other recipient.
 */
export function defaultFromAddress(): string {
  const from = process.env.EMAIL_FROM
  if (!from) {
    throw new EmailConfigError(
      'EMAIL_FROM environment variable is not set. Refusing to send email from the Resend sandbox sender. Set EMAIL_FROM to a verified-domain address in your environment configuration.',
    )
  }
  return from
}

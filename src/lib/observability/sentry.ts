// TODO — wire up @sentry/nextjs SDK when ready to enable Sentry properly.
// Until then, this module logs to console with the [observability] prefix as
// a no-op stub. The function signatures match @sentry/nextjs so the eventual
// swap is mechanical.

const PREFIX = '[observability]'

// SENTRY_DSN is the deliberately-non-gating integration seam: when the real
// SDK is wired in, this is the value passed to Sentry.init(). Read at module
// scope on purpose so it is visible at code-review time. The stub behaves
// identically whether it is set or unset — behaviour never branches on it.
const SENTRY_DSN = process.env.SENTRY_DSN
void SENTRY_DSN

/**
 * Capture an exception. Signature matches @sentry/nextjs captureException so
 * the eventual SDK swap is mechanical. Logs the error value itself (not just
 * err.message) so Error instances surface their stack via the default console
 * serialiser, and non-Error values are serialised as-is.
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): void {
  if (context) {
    console.error(PREFIX, err, context)
  } else {
    console.error(PREFIX, err)
  }
}

/**
 * Capture a message. Signature matches @sentry/nextjs captureMessage so the
 * eventual SDK swap is mechanical.
 */
export function captureMessage(
  msg: string,
  context?: Record<string, unknown>,
): void {
  if (context) {
    console.warn(PREFIX, msg, context)
  } else {
    console.warn(PREFIX, msg)
  }
}

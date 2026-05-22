/**
 * Configuration error thrown when a required site-URL env var is missing.
 * A deliberate parallel to EmailConfigError in src/lib/email/client.ts —
 * minted locally rather than reused because an unset site origin is not an
 * email-configuration error, and the class name should tell the truth about
 * what failed.
 */
export class EnvConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvConfigError'
  }
}

/**
 * The canonical public origin, read from NEXT_PUBLIC_SITE_URL at call time.
 * Throws EnvConfigError if unset — we refuse to construct a redirect URL from
 * a non-canonical fallback (VERCEL_URL is deployment-specific; localhost is
 * dev-only), which would emit confirmation and recovery links pointing at the
 * wrong origin. The throw is unconditional in every environment — dev, preview,
 * and production alike — matching the fail-loud posture of defaultFromAddress()
 * in src/lib/email/client.ts.
 *
 * The returned origin is always scheme-prefixed: a value that already starts
 * with `http` is returned unchanged; otherwise `https://` is prefixed. This
 * mirrors the inline normalisation the call sites previously did themselves and
 * is retained as a defensive measure.
 */
export function getPublicOrigin(): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!siteUrl) {
    throw new EnvConfigError(
      'NEXT_PUBLIC_SITE_URL environment variable is not set. Refusing to construct a redirect URL from a non-canonical fallback. Set NEXT_PUBLIC_SITE_URL to the canonical site origin in your environment configuration.',
    )
  }
  return siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`
}

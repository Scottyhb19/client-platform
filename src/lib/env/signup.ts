/**
 * Public-signup gate, read from PUBLIC_SIGNUP_ENABLED at call time — not cached
 * at module load, mirroring the call-time read in getPublicOrigin()
 * (src/lib/env/site-url.ts).
 *
 * This helper deliberately FAILS CLOSED. Signup is enabled only when the value
 * is exactly the string 'true'; anything else — unset, empty, 'false', or any
 * other text — returns false and keeps signup disabled.
 *
 * This is an intentional departure from the fail-loud pattern in site-url.ts,
 * where getPublicOrigin() throws EnvConfigError on a missing value. Here the
 * env var guards a security door: a missing or malformed value should keep the
 * door shut, not crash the route. A crash on a publicly reachable page is a
 * worse outcome than a closed signup form, so this helper never throws and
 * never uses EnvConfigError.
 */
export function isPublicSignupEnabled(): boolean {
  return process.env.PUBLIC_SIGNUP_ENABLED === 'true'
}

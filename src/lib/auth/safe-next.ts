import { getPublicOrigin } from '@/lib/env/site-url'

/**
 * Validate a `next` redirect target as a local same-origin path.
 *
 * Returns the input unchanged when every check passes; otherwise returns
 * the fallback (default '/dashboard'). NEVER returns an absolute URL, an
 * off-origin URL, a protocol-relative URL, a backslash-prefixed URL that
 * some browsers normalise to a host, or any value containing CR/LF.
 *
 * Defence is layered, cheapest-first:
 *  1. Type check — non-strings return the fallback.
 *  2. Prefix check — must start with '/' and the second character must NOT
 *     be '/' or '\' (blocks '//evil.com' and '/\evil.com' which the WHATWG
 *     URL parser normalises into hosts on http(s) URLs).
 *  3. CR/LF rejection — header-injection paranoia.
 *  4. URL round-trip — `new URL(next, trustedOrigin).origin` must strictly
 *     equal the canonical origin. The WHATWG URL parser normalises forms
 *     the string checks may miss (encoded host separators, IDN tricks,
 *     embedded backslashes deeper in the path); the round trip catches
 *     anything that resolves off-origin despite passing the prefix checks.
 *
 * Notes on the trusted origin:
 *  - The origin comes from getPublicOrigin(), which reads NEXT_PUBLIC_SITE_URL
 *    at call time and throws EnvConfigError if unset. That throw propagates
 *    here intentionally — matches the fail-loud posture established in G-11.
 *    A safeNext() call cannot silently degrade to a permissive check.
 *  - getPublicOrigin() may return a value with a trailing slash; we
 *    canonicalise via `new URL(...).origin` for the comparison so the check
 *    is robust to env-var formatting.
 */
export function safeNext(
  next: unknown,
  fallback: string = '/dashboard',
): string {
  if (typeof next !== 'string') return fallback
  if (next.length === 0 || next[0] !== '/') return fallback
  if (next[1] === '/' || next[1] === '\\') return fallback
  if (/[\r\n]/.test(next)) return fallback

  const trustedOrigin = new URL(getPublicOrigin()).origin
  let parsed: URL
  try {
    parsed = new URL(next, trustedOrigin)
  } catch {
    return fallback
  }
  if (parsed.origin !== trustedOrigin) return fallback

  return next
}

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
 *  4. URL round-trip — `new URL(next, VALIDATION_ORIGIN).origin` must
 *     strictly equal VALIDATION_ORIGIN. The WHATWG URL parser normalises
 *     forms the string checks may miss (encoded host separators, IDN
 *     tricks, embedded backslashes deeper in the path); the round trip
 *     catches anything that resolves off-origin despite passing the
 *     prefix checks.
 *
 * Why a fixed sentinel base, not getPublicOrigin() (2026-06-10 incident):
 * deciding whether a RELATIVE path smuggles a host does not depend on the
 * base's actual value — any syntactically valid origin yields the same
 * verdict, so this check needs no environment configuration. The previous
 * implementation resolved against getPublicOrigin(), inheriting its
 * fail-loud throw when NEXT_PUBLIC_SITE_URL was unset; with the var absent
 * in production, every owner/staff sign-in, /auth/callback hit, and
 * forgot-password submit 500'd. That coupled LOGIN availability to an env
 * var that only email-link minting genuinely consumes. The check's
 * strength is unchanged by the sentinel — this is not a degrade-to-
 * permissive change; the G-11 fail-loud posture continues to apply at the
 * true origin consumers (signup, forgot-password, resend-confirmation,
 * invite, set-session), which still call getPublicOrigin() directly.
 *
 * `.invalid` is an RFC 2606 reserved TLD — the sentinel can never collide
 * with a real deployable origin.
 */
const VALIDATION_ORIGIN = 'https://safe-next-validation.invalid'

export function safeNext(
  next: unknown,
  fallback: string = '/dashboard',
): string {
  if (typeof next !== 'string') return fallback
  if (next.length === 0 || next[0] !== '/') return fallback
  if (next[1] === '/' || next[1] === '\\') return fallback
  if (/[\r\n]/.test(next)) return fallback

  let parsed: URL
  try {
    parsed = new URL(next, VALIDATION_ORIGIN)
  } catch {
    return fallback
  }
  if (parsed.origin !== VALIDATION_ORIGIN) return fallback

  return next
}

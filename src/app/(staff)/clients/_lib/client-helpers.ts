/**
 * Deterministic avatar + initials helpers, shared across the clientele
 * list and the client profile.
 */

export type AvatarTone =
  | 'g'
  | 'r'
  | 'a'
  | 'n'
  | 'b'
  | 'p'
  | 't'
  | 'v'
  | 'br'

export function initialsFor(firstName: string, lastName: string): string {
  const f = (firstName ?? '').trim()
  const l = (lastName ?? '').trim()
  if (f && l) return (f[0] + l[0]).toUpperCase()
  if (f) return f.slice(0, 2).toUpperCase()
  return '—'
}

/**
 * Client-category avatar palette (operator rule, 2026-07-03): a client's
 * bubble colour encodes their clientele category, one hue per category in
 * the org's sort_order — never the practitioner green ('g') and never the
 * clinical-flag red ('r'). Wraps past six categories; uncategorised clients
 * and unknown category ids stay neutral grey.
 */
export const CATEGORY_TONES: AvatarTone[] = ['b', 'p', 't', 'v', 'a', 'br']

export function categoryToneFor(
  categoryId: string | null | undefined,
  orderedCategoryIds: string[],
): AvatarTone {
  if (!categoryId) return 'n'
  const i = orderedCategoryIds.indexOf(categoryId)
  if (i === -1) return 'n'
  return CATEGORY_TONES[i % CATEGORY_TONES.length]
}

export type ClientStatus = 'invited' | 'active' | 'archived'

export function statusFor(client: {
  user_id: string | null
  invited_at: string | null
  onboarded_at: string | null
  archived_at: string | null
}): ClientStatus {
  if (client.archived_at) return 'archived'
  if (client.onboarded_at && client.user_id) return 'active'
  return 'invited'
}

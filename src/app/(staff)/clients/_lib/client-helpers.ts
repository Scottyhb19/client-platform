/**
 * Deterministic avatar + initials helpers, shared across the clientele
 * list and the client profile.
 */

export type AvatarTone = 'g' | 'r' | 'a' | 'n'

export function initialsFor(firstName: string, lastName: string): string {
  const f = (firstName ?? '').trim()
  const l = (lastName ?? '').trim()
  if (f && l) return (f[0] + l[0]).toUpperCase()
  if (f) return f.slice(0, 2).toUpperCase()
  return '—'
}

/**
 * Stable avatar tone derived from the client id (UUID). Keeps the row
 * colour consistent across renders without needing a tone column.
 */
export function toneFor(id: string): AvatarTone {
  const tones: AvatarTone[] = ['g', 'r', 'a', 'n']
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return tones[sum % tones.length]
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

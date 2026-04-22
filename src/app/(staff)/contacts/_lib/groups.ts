/**
 * Contact-group metadata shared by the list page and the create/edit form.
 * Keep in sync with the CHECK constraint on contacts.contact_group.
 */

export type ContactGroup =
  | 'gps'
  | 'surgeons'
  | 'sports-doc'
  | 'physios'
  | 'chiros'
  | 'eps'
  | 'other'

export const CONTACT_GROUPS: Array<{
  key: ContactGroup
  label: string
  short: string
}> = [
  { key: 'gps', label: 'General Practitioners', short: 'GPs' },
  { key: 'surgeons', label: 'Surgeons', short: 'Surgeons' },
  { key: 'sports-doc', label: 'Sports Doctors', short: 'Sports Doctors' },
  { key: 'physios', label: 'Physiotherapists', short: 'Physios' },
  { key: 'chiros', label: 'Chiropractors', short: 'Chiros' },
  { key: 'eps', label: 'Exercise Physiologists', short: 'EPs' },
  { key: 'other', label: 'Other', short: 'Other' },
]

export function groupLabel(key: string | null | undefined): string {
  if (!key) return 'Other'
  return CONTACT_GROUPS.find((g) => g.key === key)?.label ?? 'Other'
}

export function isContactGroup(key: string): key is ContactGroup {
  return CONTACT_GROUPS.some((g) => g.key === key)
}

/** Strip "Dr. / Mr. / Ms. / Mrs." prefixes then take the first two initials. */
export function contactInitials(name: string): string {
  const stripped = name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s*/i, '').trim()
  const parts = stripped.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

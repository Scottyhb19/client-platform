import { formatShortDate } from './short-date'

/** Relative-time-ago — "9 days ago", "3 weeks ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  try {
    const ms = now - new Date(iso).getTime()
    if (ms < 0) return formatShortDate(iso)
    const days = Math.floor(ms / (1000 * 60 * 60 * 24))
    if (days === 0) return 'today'
    if (days === 1) return 'yesterday'
    if (days < 14) return `${days} days ago`
    const weeks = Math.floor(days / 7)
    if (weeks < 8) return `${weeks} weeks ago`
    const months = Math.floor(days / 30)
    if (months < 18) return `${months} months ago`
    const years = Math.floor(days / 365)
    return `${years} years ago`
  } catch {
    return iso
  }
}

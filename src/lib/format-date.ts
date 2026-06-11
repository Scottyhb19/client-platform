/**
 * Shared date formatters (CN-15, docs/polish/client-profile-clinical-notes.md).
 *
 * Design-system date conventions (Odyssey_Design_System.pdf §02 / CLAUDE.md
 * voice rules): Australian English, dates as `12 Jan 2026` or
 * `Sat 11 Apr 2026` — weekday form carries NO comma. Time-ago is explicit
 * (`9 days ago`), never vague.
 *
 * Before this util the `12 Jan 2026` formatter existed eight times across
 * the platform under five names. The section-3 clinical components import
 * from here; out-of-section duplicates (TestCaptureModal, ReportsPanel,
 * BatterySessionsView, FilesTab) migrate when their own polish sections
 * touch them. Date+time shapes (e.g. NotesTab's formatSessionDate) are
 * deliberately not here — they are distinct shapes, not duplicates.
 *
 * Accepts either a date-only string ('2026-01-12') or a full ISO
 * timestamp; falls back to the raw input if parsing fails.
 */

export function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

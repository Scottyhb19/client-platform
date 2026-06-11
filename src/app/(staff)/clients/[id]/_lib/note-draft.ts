/**
 * CN-9 — sessionStorage draft preservation for in-progress clinical notes
 * (docs/polish/client-profile-clinical-notes.md).
 *
 * Why sessionStorage, not DB-backed drafts (decided at gap-list approval):
 * no migration, no draft rows in a clinical table, no sync questions. It
 * covers the real loss paths at friends-and-family scope — profile tab
 * switches (NotesTab unmounts on every tab change), accidental
 * navigation, reloads, and crash-with-session-restore. It deliberately
 * does NOT survive closing the browser; a draft is a safety net, not a
 * second storage tier for clinical content.
 *
 * Key shape follows the ReportsPanel `odyssey:` convention:
 *   odyssey:note-draft:{clientId}:create
 *   odyssey:note-draft:{clientId}:edit:{noteId}
 *
 * All functions are SSR-safe and fail silent — a storage error must never
 * break the note form itself.
 *
 * testSessionId note: a captured test session creates its DB rows at
 * capture time (create_test_session RPC), not at note save. A draft
 * carrying testSessionId therefore references real, durable data — and
 * clearing a draft must never delete the session.
 */

const DRAFT_KEY_PREFIX = 'odyssey:note-draft:'

export type NoteDraft = {
  templateId: string | null
  values: Record<string, string>
  appointmentId: string | null
  testSessionId: string | null
  testCaptureSummary: string | null
  savedAt: string
}

export function noteDraftKey(
  clientId: string,
  mode: 'create' | 'edit',
  noteId: string | null,
): string {
  return mode === 'edit' && noteId
    ? `${DRAFT_KEY_PREFIX}${clientId}:edit:${noteId}`
    : `${DRAFT_KEY_PREFIX}${clientId}:create`
}

export function loadNoteDraft(key: string): NoteDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NoteDraft> | null
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.values !== 'object' || parsed.values === null) {
      return null
    }
    return {
      templateId: typeof parsed.templateId === 'string' ? parsed.templateId : null,
      values: parsed.values as Record<string, string>,
      appointmentId:
        typeof parsed.appointmentId === 'string' ? parsed.appointmentId : null,
      testSessionId:
        typeof parsed.testSessionId === 'string' ? parsed.testSessionId : null,
      testCaptureSummary:
        typeof parsed.testCaptureSummary === 'string'
          ? parsed.testCaptureSummary
          : null,
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
    }
  } catch {
    return null
  }
}

export function saveNoteDraft(key: string, draft: NoteDraft): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft))
  } catch {
    /* storage unavailable or full; fail silently */
  }
}

export function clearNoteDraft(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    /* fail silently */
  }
}

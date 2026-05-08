/**
 * Clinical notes panel — shared between the program calendar and the
 * session builder right rail.
 *
 * Read-only summary list. Pinned notes float to the top with the red-flag
 * banner treatment (left-border accent, the only place that pattern is
 * permitted per the design system). Non-pinned notes render as plain
 * cream cards. The full editor lives on the client profile.
 *
 * Body content is denormalised on the loader — the panel takes a flat
 * `fields` array per note (label + value pairs from content_json) plus a
 * `legacy_body` fallback for pre-template notes that still carry text in
 * body_rich/subjective. The loader extraction mirrors NotesTab's read-view
 * (clinical_notes content_json fields → drop empty values → fall back to
 * legacy SOAP columns when fields is empty).
 */

const INK = '#1E1A18'
const MUTED = '#78746F'
const FAINT = '#9C9690'
const BORDER = '#E2DDD7'
const ALERT = '#D64045'

export type ClinicalNoteField = {
  label: string
  value: string
}

export type ClinicalNoteSummary = {
  id: string
  note_date: string
  is_pinned: boolean
  flag_body_region: string | null
  fields: ClinicalNoteField[]
  legacy_body: string
}

export function NotesPanel({ notes }: { notes: ClinicalNoteSummary[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Clinical notes
      </div>
      {notes.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No notes for this client yet. Add one from the profile and it
          will appear here while you build the session.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteRow({ note }: { note: ClinicalNoteSummary }) {
  const isPinned = note.is_pinned
  const fields = note.fields.filter((f) => f.value.trim().length > 0)
  const hasLegacyBody = fields.length === 0 && note.legacy_body.length > 0

  return (
    <div
      style={
        isPinned
          ? {
              background: 'rgba(214,64,69,.05)',
              borderLeft: `3px solid ${ALERT}`,
              padding: '10px 12px',
              borderRadius: '0 6px 6px 0',
            }
          : {
              background: '#fff',
              border: `1px solid ${BORDER}`,
              padding: '10px 12px',
              borderRadius: 6,
            }
      }
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          fontSize: '.66rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          color: isPinned ? ALERT : FAINT,
        }}
      >
        <span>{formatNoteDate(note.note_date)}</span>
        {isPinned && note.flag_body_region && (
          <>
            <span aria-hidden style={{ opacity: 0.5 }}>·</span>
            <span>{note.flag_body_region}</span>
          </>
        )}
        {isPinned && !note.flag_body_region && (
          <>
            <span aria-hidden style={{ opacity: 0.5 }}>·</span>
            <span>Pinned</span>
          </>
        )}
      </div>

      {fields.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fields.map((f, i) => (
            <div key={`${f.label}-${i}`}>
              <div
                style={{
                  fontSize: '.6rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  color: MUTED,
                  marginBottom: 2,
                }}
              >
                {f.label}
              </div>
              <div
                style={{
                  fontSize: '.78rem',
                  lineHeight: 1.45,
                  color: INK,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {f.value}
              </div>
            </div>
          ))}
        </div>
      ) : hasLegacyBody ? (
        <div
          style={{
            fontSize: '.78rem',
            lineHeight: 1.45,
            color: INK,
            whiteSpace: 'pre-wrap',
          }}
        >
          {note.legacy_body}
        </div>
      ) : null}
    </div>
  )
}

function formatNoteDate(iso: string): string {
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

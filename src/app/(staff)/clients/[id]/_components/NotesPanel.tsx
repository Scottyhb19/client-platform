/**
 * Pinned clinical notes panel.
 *
 * Extracted from SessionBuilder.tsx in Phase E so the program calendar can
 * mount the same component in its toggle-able side panel. Read-only.
 * Pinned-flag filtering happens at the loader (see day page + calendar page);
 * this component just renders the list it's given.
 */

const MUTED = '#78746F'
const ALERT = '#D64045'

export type PinnedNote = {
  id: string
  body: string
  flag_body_region: string | null
}

export function NotesPanel({ notes }: { notes: PinnedNote[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Pinned clinical notes
      </div>
      {notes.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No pinned notes for this client. Pin a note from the profile to
          have it visible here while you build the session.
        </div>
      ) : (
        notes.map((n) => (
          <div
            key={n.id}
            style={{
              background: 'rgba(214,64,69,.05)',
              borderLeft: `3px solid ${ALERT}`,
              padding: '8px 12px',
              borderRadius: '0 6px 6px 0',
              fontSize: '.78rem',
              lineHeight: 1.45,
              marginBottom: 6,
            }}
          >
            {n.flag_body_region && (
              <div
                style={{
                  fontSize: '.62rem',
                  fontWeight: 700,
                  color: ALERT,
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  marginBottom: 2,
                }}
              >
                {n.flag_body_region}
              </div>
            )}
            {n.body}
          </div>
        ))
      )}
    </div>
  )
}

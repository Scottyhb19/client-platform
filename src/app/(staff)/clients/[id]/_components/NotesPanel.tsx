'use client'

/**
 * Clinical notes panel — shared between the program calendar and the
 * session builder right rail.
 *
 * List ⇆ reader pattern, mirrored from the client profile's NotesTab so
 * the two surfaces feel identical: a compact list of clickable rows, with
 * the pinned notes grouped at the top under a "Pinned" header. Click a
 * row to open the reader (full content). The reader's back arrow returns
 * to the list. State is local — closing the rail and reopening resets to
 * list view, which is the right default ("focus on the session, glance at
 * notes").
 *
 * Body content is denormalised by the loader: each note carries a
 * `fields` array (label + value pairs from content_json) plus a
 * `legacy_body` fallback for pre-template notes that still hold text in
 * body_rich/subjective. The extraction mirrors NotesTab's read-view:
 * content_json fields → drop empty values → legacy SOAP fallback when
 * fields is empty.
 *
 * Read-only by design. Pin / archive / edit / print live on the client
 * profile; the rail is for context while building a session.
 */

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'

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
  template_name: string | null
  fields: ClinicalNoteField[]
  legacy_body: string
}

export function NotesPanel({ notes }: { notes: ClinicalNoteSummary[] }) {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)

  if (notes.length === 0) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
          Clinical notes
        </div>
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No notes for this client yet. Add one from the profile and it
          will appear here while you build the session.
        </div>
      </div>
    )
  }

  const openNote =
    openNoteId === null ? null : notes.find((n) => n.id === openNoteId) ?? null

  // Reader view — replaces the list when a note is open.
  if (openNote) {
    return (
      <div
        className="card"
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <NoteReader note={openNote} onBack={() => setOpenNoteId(null)} />
      </div>
    )
  }

  const pinned = notes.filter((n) => n.is_pinned)
  const recent = notes.filter((n) => !n.is_pinned)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="eyebrow"
        style={{
          fontSize: '.66rem',
          padding: '14px 14px 10px',
        }}
      >
        Clinical notes
      </div>

      {pinned.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          <SidebarHeader>Pinned</SidebarHeader>
          {pinned.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              onOpen={() => setOpenNoteId(n.id)}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDER}` }}>
          {pinned.length > 0 && <SidebarHeader>Recent</SidebarHeader>}
          {recent.map((n) => (
            <NoteRow
              key={n.id}
              note={n}
              onOpen={() => setOpenNoteId(n.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteRow({
  note,
  onOpen,
}: {
  note: ClinicalNoteSummary
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'block',
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${BORDER}`,
        padding: '10px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          rowGap: 4,
          fontSize: '.8rem',
          fontWeight: 600,
          color: INK,
        }}
      >
        <span style={{ whiteSpace: 'nowrap' }}>
          {formatNoteDate(note.note_date)}
        </span>
        {note.is_pinned && note.flag_body_region && (
          <span
            style={{
              fontSize: '.6rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
              color: ALERT,
              background: 'rgba(214,64,69,.08)',
              padding: '1px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            {note.flag_body_region}
          </span>
        )}
        {note.template_name && (
          <span
            style={{
              fontSize: '.66rem',
              fontWeight: 600,
              color: MUTED,
              background: '#EDE8E2',
              padding: '1px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            {note.template_name}
          </span>
        )}
      </div>
    </button>
  )
}

function NoteReader({
  note,
  onBack,
}: {
  note: ClinicalNoteSummary
  onBack: () => void
}) {
  const fields = note.fields.filter((f) => f.value.trim().length > 0)
  const legacy = note.legacy_body
  const hasContent = fields.length > 0 || legacy.length > 0

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: `1px solid ${BORDER}`,
          background: 'var(--color-surface, #fff)',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to notes list"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: FAINT,
            display: 'grid',
            placeItems: 'center',
            borderRadius: 4,
          }}
        >
          <ArrowLeft size={14} aria-hidden />
        </button>
        <div
          style={{
            flex: 1,
            fontFamily: 'var(--font-display, inherit)',
            fontWeight: 700,
            fontSize: '.8rem',
            color: INK,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {formatNoteDate(note.note_date)}
        </div>
      </div>

      <div style={{ padding: 14, maxHeight: 480, overflowY: 'auto' }}>
        {(note.template_name || (note.is_pinned && note.flag_body_region)) && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {note.is_pinned && note.flag_body_region && (
              <span
                style={{
                  fontSize: '.6rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  color: ALERT,
                  background: 'rgba(214,64,69,.08)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {note.flag_body_region}
              </span>
            )}
            {note.template_name && (
              <span
                style={{
                  fontSize: '.66rem',
                  fontWeight: 600,
                  color: MUTED,
                  background: '#EDE8E2',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {note.template_name}
              </span>
            )}
          </div>
        )}

        {fields.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map((f, i) => (
              <div key={`${f.label}-${i}`}>
                <div
                  style={{
                    fontFamily: 'var(--font-display, inherit)',
                    fontWeight: 700,
                    fontSize: '.62rem',
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: FAINT,
                    marginBottom: 2,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{
                    fontSize: '.84rem',
                    color: INK,
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                  }}
                >
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        ) : legacy.length > 0 ? (
          <div
            style={{
              fontSize: '.84rem',
              color: INK,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {legacy}
          </div>
        ) : !hasContent ? (
          <div style={{ fontSize: '.82rem', color: MUTED }}>(empty note)</div>
        ) : null}
      </div>
    </div>
  )
}

function SidebarHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-display, inherit)',
        fontWeight: 700,
        fontSize: '.62rem',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: FAINT,
        padding: '8px 14px 4px',
      }}
    >
      {children}
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

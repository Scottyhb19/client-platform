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
import { formatShortDate } from '@/lib/format-date'
import type { Database } from '@/types/database'

type NoteType = Database['public']['Enums']['note_type']

export type ClinicalNoteField = {
  label: string
  value: string
}

export type ClinicalNoteSummary = {
  id: string
  note_date: string
  note_type: NoteType
  is_pinned: boolean
  flag_body_region: string | null
  flag_severity: number | null
  flag_resolved_at: string | null
  template_name: string | null
  fields: ClinicalNoteField[]
  legacy_body: string
}

/**
 * CN-1: an active flag is an unresolved injury_flag / contraindication
 * note. Active flags render in their own banner section at the top of the
 * panel — independent of is_pinned — so they are visible at the moment of
 * programming. Resolved flags drop back into the chronological list.
 */
function isActiveFlag(n: ClinicalNoteSummary): boolean {
  return (
    (n.note_type === 'injury_flag' || n.note_type === 'contraindication') &&
    n.flag_resolved_at === null &&
    n.flag_body_region !== null
  )
}

export function NotesPanel({ notes }: { notes: ClinicalNoteSummary[] }) {
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)

  if (notes.length === 0) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
          Clinical notes
        </div>
        <div style={{ fontSize: '.82rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>
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

  const activeFlags = notes.filter(isActiveFlag)
  const rest = notes.filter((n) => !isActiveFlag(n))
  const pinned = rest.filter((n) => n.is_pinned)
  const recent = rest.filter((n) => !n.is_pinned)

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

      {activeFlags.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border-hairline)' }}>
          <SidebarHeader>Active flags</SidebarHeader>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '2px 10px 10px',
            }}
          >
            {activeFlags.map((n) => (
              <FlagBannerRow
                key={n.id}
                note={n}
                onOpen={() => setOpenNoteId(n.id)}
              />
            ))}
          </div>
        </div>
      )}

      {pinned.length > 0 && (
        <div style={{ borderTop: '1px solid var(--color-border-hairline)' }}>
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
        <div style={{ borderTop: '1px solid var(--color-border-hairline)' }}>
          {(pinned.length > 0 || activeFlags.length > 0) && (
            <SidebarHeader>Recent</SidebarHeader>
          )}
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

/**
 * Compact design-system flag banner — the restricted left-border accent
 * pattern (3px solid alert + 5% alert wash). Clicking opens the note in
 * the reader, same as any other row.
 */
function FlagBannerRow({
  note,
  onOpen,
}: {
  note: ClinicalNoteSummary
  onOpen: () => void
}) {
  const typeLabel =
    note.note_type === 'contraindication' ? 'Contraindication' : 'Injury flag'
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        border: 'none',
        borderLeft: '3px solid var(--color-alert)',
        background: 'rgba(214,64,69,0.05)',
        borderRadius: '0 8px 8px 0',
        padding: '8px 10px',
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display, inherit)',
          fontWeight: 700,
          fontSize: '.58rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--color-alert)',
        }}
      >
        {typeLabel}
        {note.flag_severity ? ` — severity ${note.flag_severity}` : ''}
      </div>
      <div
        style={{
          fontSize: '.8rem',
          fontWeight: 600,
          color: 'var(--color-text)',
          marginTop: 1,
        }}
      >
        {note.flag_body_region}
        <span
          style={{
            fontWeight: 400,
            fontSize: '.72rem',
            color: 'var(--color-text-light)',
          }}
        >
          {' '}
          — {formatShortDate(note.note_date)}
        </span>
      </div>
    </button>
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
        borderBottom: '1px solid var(--color-border-hairline)',
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
          color: 'var(--color-text)',
        }}
      >
        <span style={{ whiteSpace: 'nowrap' }}>
          {formatShortDate(note.note_date)}
        </span>
        {note.flag_body_region && (
          <span
            style={{
              fontSize: '.6rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
              color: 'var(--color-alert)',
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
              color: 'var(--color-muted)',
              background: 'var(--color-surface-2)',
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
          borderBottom: '1px solid var(--color-border-hairline)',
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
            color: 'var(--color-text-faint)',
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
            color: 'var(--color-text)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {formatShortDate(note.note_date)}
        </div>
      </div>

      <div style={{ padding: 14, maxHeight: 480, overflowY: 'auto' }}>
        {(note.template_name || note.flag_body_region) && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {note.flag_body_region && (
              <span
                style={{
                  fontSize: '.6rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  color: 'var(--color-alert)',
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
                  color: 'var(--color-muted)',
                  background: 'var(--color-surface-2)',
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
                    color: 'var(--color-text-faint)',
                    marginBottom: 2,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{
                    fontSize: '.84rem',
                    color: 'var(--color-text)',
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
              color: 'var(--color-text)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {legacy}
          </div>
        ) : !hasContent ? (
          <div style={{ fontSize: '.82rem', color: 'var(--color-muted)' }}>(empty note)</div>
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
        color: 'var(--color-text-faint)',
        padding: '8px 14px 4px',
      }}
    >
      {children}
    </div>
  )
}


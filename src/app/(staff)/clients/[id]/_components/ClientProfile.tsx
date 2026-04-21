'use client'

import { useState } from 'react'
import {
  Calendar,
  Edit3,
  MessageSquare,
  Pin,
} from 'lucide-react'
import type { Database } from '@/types/database'

type NoteType = Database['public']['Enums']['note_type']

export type ProfileClient = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  dob: string | null
  gender: string | null
  address: string | null
  referral_source: string | null
  goals: string | null
  created_at: string
  category_name: string | null
}

export type ProfileCondition = {
  id: string
  condition: string
  severity: number | null
  notes: string | null
  is_active: boolean
  diagnosis_date: string | null
}

export type ProfileNote = {
  id: string
  note_date: string
  note_type: NoteType
  title: string | null
  body_rich: string | null
  subjective: string | null
  is_pinned: boolean
  flag_body_region: string | null
}

type Tab = 'profile' | 'program' | 'reports' | 'bookings' | 'comms'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'profile', label: 'Profile' },
  { key: 'program', label: 'Program' },
  { key: 'reports', label: 'Reports' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'comms', label: 'Comms' },
]

interface ClientProfileProps {
  client: ProfileClient
  conditions: ProfileCondition[]
  notes: ProfileNote[]
  statusLabel: 'Active' | 'New' | 'Archived'
  statusKind: 'active' | 'new' | 'archived'
}

export function ClientProfile({
  client,
  conditions,
  notes,
  statusLabel,
  statusKind,
}: ClientProfileProps) {
  const [tab, setTab] = useState<Tab>('profile')

  return (
    <>
      <HeaderActions />

      {/* Tabs bar */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--color-border-subtle)',
          margin: '22px 0 24px',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${
                tab === t.key ? 'var(--color-primary)' : 'transparent'
              }`,
              marginBottom: -1,
              color:
                tab === t.key
                  ? 'var(--color-primary)'
                  : 'var(--color-text-light)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: '.86rem',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <ProfileTabContent
          client={client}
          conditions={conditions}
          notes={notes}
          statusLabel={statusLabel}
          statusKind={statusKind}
        />
      )}
      {tab === 'program' && (
        <EmptyTab
          title="No active program"
          description="The program engine + session builder land in a later commit. Active mesocycles, weeks, and day splits will show here."
        />
      )}
      {tab === 'reports' && (
        <EmptyTab
          title="No reports yet"
          description="Reports aggregate from assessments, sessions, and third-party integrations (e.g. VALD ForceFrame). Nothing to show until a report is generated."
        />
      )}
      {tab === 'bookings' && (
        <EmptyTab
          title="No bookings yet"
          description="Appointments will show here once the Schedule module lands."
        />
      )}
      {tab === 'comms' && (
        <EmptyTab
          title="No messages yet"
          description="Email + SMS sent to this client will be logged here. Wiring lands with scheduling reminders."
        />
      )}
    </>
  )
}

function HeaderActions() {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        justifyContent: 'flex-end',
        marginTop: -42,
      }}
    >
      <button type="button" className="btn outline" disabled>
        <MessageSquare size={14} aria-hidden />
        Message
      </button>
      <button type="button" className="btn outline" disabled>
        <Calendar size={14} aria-hidden />
        Book
      </button>
      <button type="button" className="btn primary" disabled>
        <Edit3 size={14} aria-hidden />
        Edit profile
      </button>
    </div>
  )
}

function ProfileTabContent({
  client,
  conditions,
  notes,
  statusLabel,
  statusKind,
}: Omit<ClientProfileProps, never>) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 18,
      }}
    >
      <PersonalDetailsCard client={client} />
      <ClinicalDetailsCard
        client={client}
        conditions={conditions}
      />
      <ClinicalNotesCard notes={notes} />

      {/* Status strip — subtle, matches the design's header flags */}
      <div
        style={{
          gridColumn: '1 / -1',
          fontSize: '.78rem',
          color: 'var(--color-text-light)',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <span className={`tag ${statusKind}`}>{statusLabel}</span>
        <span>Client since {formatMonthYear(client.created_at)}</span>
      </div>
    </div>
  )
}

function PersonalDetailsCard({ client }: { client: ProfileClient }) {
  const rows: Array<[string, string]> = [
    ['Email', client.email],
    ['Phone', client.phone ?? '—'],
    ['DOB', client.dob ? formatDate(client.dob) : '—'],
    ['Gender', client.gender ?? '—'],
    ['Address', client.address ?? '—'],
    ['Referral', client.referral_source ?? '—'],
  ]

  return (
    <div className="card" style={{ padding: 22 }}>
      <div className="eyebrow">Personal details</div>
      {rows.map(([k, v], i) => (
        <div
          key={k}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            padding: '9px 0',
            borderBottom: i === rows.length - 1 ? 'none' : '1px solid #F0EBE5',
            fontSize: '.84rem',
          }}
        >
          <span style={{ color: 'var(--color-text-light)' }}>{k}</span>
          <span
            style={{
              fontWeight: 500,
              color:
                v === '—' ? 'var(--color-muted)' : 'var(--color-text)',
              textAlign: 'right',
            }}
          >
            {v}
          </span>
        </div>
      ))}
    </div>
  )
}

function ClinicalDetailsCard({
  client,
  conditions,
}: {
  client: ProfileClient
  conditions: ProfileCondition[]
}) {
  return (
    <div className="card" style={{ padding: 22 }}>
      <div className="eyebrow">Clinical details</div>

      <ClinicalSection title="Conditions">
        {conditions.length === 0 ? (
          <span style={{ color: 'var(--color-muted)' }}>None recorded.</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.6 }}>
            {conditions.map((c) => (
              <li key={c.id}>
                <strong>{c.condition}</strong>
                {c.severity && ` · severity ${c.severity}`}
                {c.notes && <span> — {c.notes}</span>}
                {!c.is_active && (
                  <span
                    style={{
                      marginLeft: 6,
                      fontSize: '.72rem',
                      color: 'var(--color-muted)',
                    }}
                  >
                    (resolved)
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </ClinicalSection>

      <ClinicalSection title="Goals">
        {client.goals?.trim() ? (
          <span>{client.goals}</span>
        ) : (
          <span style={{ color: 'var(--color-muted)' }}>None recorded.</span>
        )}
      </ClinicalSection>
    </div>
  )
}

function ClinicalSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: '.7rem',
          fontWeight: 600,
          color: 'var(--color-text-light)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '.86rem',
          marginTop: 4,
          lineHeight: 1.5,
          color: 'var(--color-text)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function ClinicalNotesCard({ notes }: { notes: ProfileNote[] }) {
  const pinned = notes.filter((n) => n.is_pinned)
  const rest = notes.filter((n) => !n.is_pinned)

  return (
    <div className="card" style={{ gridColumn: '1 / -1', padding: 22 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div className="eyebrow" style={{ margin: 0 }}>
          Clinical notes
        </div>
        <button type="button" className="btn outline" disabled>
          Add note
        </button>
      </div>

      {pinned.map((n) => (
        <PinnedNoteRow key={n.id} note={n} />
      ))}

      {rest.length === 0 && pinned.length === 0 && (
        <div
          style={{
            fontSize: '.88rem',
            color: 'var(--color-muted)',
            padding: '14px 0',
          }}
        >
          No notes yet. SOAP-style notes, flags, and reassessments will live
          here.
        </div>
      )}

      {rest.map((n) => (
        <NoteRow key={n.id} note={n} />
      ))}
    </div>
  )
}

function PinnedNoteRow({ note }: { note: ProfileNote }) {
  return (
    <div
      style={{
        background: 'rgba(214,64,69,.05)',
        borderLeft: '3px solid var(--color-alert)',
        padding: '10px 14px',
        borderRadius: '0 6px 6px 0',
        fontSize: '.84rem',
        lineHeight: 1.5,
        marginBottom: 14,
      }}
    >
      <div
        style={{
          fontSize: '.66rem',
          fontWeight: 700,
          color: 'var(--color-alert)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          marginBottom: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Pin size={10} aria-hidden />
        Pinned · {noteTypeLabel(note.note_type)}
        {note.flag_body_region && ` · ${note.flag_body_region}`}
      </div>
      <NoteBody note={note} />
    </div>
  )
}

function NoteRow({ note }: { note: ProfileNote }) {
  return (
    <div style={{ padding: '14px 0', borderTop: '1px solid #F0EBE5' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: '.72rem', color: 'var(--color-muted)' }}>
          {formatDate(note.note_date)}
        </span>
        <NoteTypeBadge kind={note.note_type} />
        {note.title && (
          <span style={{ fontSize: '.86rem', fontWeight: 600 }}>
            {note.title}
          </span>
        )}
      </div>
      <NoteBody note={note} />
    </div>
  )
}

function NoteBody({ note }: { note: ProfileNote }) {
  const body = note.body_rich ?? note.subjective ?? ''
  if (!body.trim()) {
    return (
      <div style={{ fontSize: '.84rem', color: 'var(--color-muted)' }}>
        (empty note)
      </div>
    )
  }
  return (
    <div style={{ fontSize: '.86rem', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
      {body}
    </div>
  )
}

function NoteTypeBadge({ kind }: { kind: NoteType }) {
  const label = noteTypeLabel(kind)
  const palette: Record<NoteType, { bg: string; fg: string }> = {
    initial_assessment: {
      bg: 'rgba(45,178,76,.1)',
      fg: 'var(--color-primary)',
    },
    progress_note: { bg: 'rgba(232,163,23,.1)', fg: '#9A7A0E' },
    injury_flag: {
      bg: 'rgba(214,64,69,.1)',
      fg: 'var(--color-alert)',
    },
    contraindication: {
      bg: 'rgba(214,64,69,.1)',
      fg: 'var(--color-alert)',
    },
    discharge: { bg: 'rgba(30,26,24,.06)', fg: 'var(--color-charcoal)' },
    general: { bg: 'rgba(30,26,24,.06)', fg: 'var(--color-charcoal)' },
  }
  const c = palette[kind]
  return (
    <span
      style={{
        fontSize: '.62rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '.04em',
        padding: '2px 7px',
        borderRadius: 4,
        background: c.bg,
        color: c.fg,
      }}
    >
      {label}
    </span>
  )
}

function EmptyTab({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div
      className="card"
      style={{
        padding: '32px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: '.88rem',
          lineHeight: 1.55,
          margin: '0 auto',
          maxWidth: 460,
        }}
      >
        {description}
      </p>
    </div>
  )
}

function noteTypeLabel(kind: NoteType): string {
  return {
    initial_assessment: 'Initial assessment',
    progress_note: 'Progress note',
    injury_flag: 'Injury flag',
    contraindication: 'Contraindication',
    discharge: 'Discharge',
    general: 'Note',
  }[kind]
}

function formatDate(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateIso))
  } catch {
    return dateIso
  }
}

function formatMonthYear(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateIso))
  } catch {
    return dateIso
  }
}

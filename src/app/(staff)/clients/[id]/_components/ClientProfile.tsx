'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { getOrCreateThreadAction } from '../../../messages/actions'
import { archiveClientAction } from '../actions'
import {
  ChevronRight,
  CreditCard,
  Edit3,
  FileText,
  Filter,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pin,
  Plus,
  Search,
  Upload,
} from 'lucide-react'
import type { Database } from '@/types/database'
import { initialsFor, toneFor } from '../../_lib/client-helpers'

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

export type ProfileProgramSummary = {
  id: string
  name: string
  duration_weeks: number | null
  start_date: string | null
  current_week: number | null
  days_per_week: number
}

type Tab = 'details' | 'notes' | 'program' | 'reports' | 'files' | 'invoices'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'details', label: 'Client details' },
  { key: 'notes', label: 'Session notes' },
  { key: 'program', label: 'Programs' },
  { key: 'reports', label: 'Reports' },
  { key: 'files', label: 'Files' },
  { key: 'invoices', label: 'Invoices' },
]

interface ClientProfileProps {
  client: ProfileClient
  conditions: ProfileCondition[]
  notes: ProfileNote[]
  program: ProfileProgramSummary | null
  statusLabel: 'Active' | 'New' | 'Archived'
  statusKind: 'active' | 'new' | 'archived'
}

export function ClientProfile({
  client,
  conditions,
  notes,
  program,
  statusLabel,
  statusKind,
}: ClientProfileProps) {
  const [tab, setTab] = useState<Tab>('details')

  return (
    <div style={{ background: 'var(--color-surface)', minHeight: '100%' }}>
      <ClientHeader
        client={client}
        conditions={conditions}
        statusLabel={statusLabel}
        statusKind={statusKind}
        tab={tab}
        onTab={setTab}
      />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 32px 60px' }}>
        {tab === 'details' && (
          <DetailsTab client={client} conditions={conditions} />
        )}
        {tab === 'notes' && <NotesTab notes={notes} />}
        {tab === 'program' && (
          <ProgramTab clientId={client.id} program={program} />
        )}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'files' && <FilesTab />}
        {tab === 'invoices' && <InvoicesTab />}
      </div>
    </div>
  )
}

/* =========================================================================
 * HEADER  — sticky white bar with breadcrumb, identity, tags, and tab strip
 * ========================================================================= */

function ClientHeader({
  client,
  conditions,
  statusLabel,
  statusKind,
  tab,
  onTab,
}: {
  client: ProfileClient
  conditions: ProfileCondition[]
  statusLabel: 'Active' | 'New' | 'Archived'
  statusKind: 'active' | 'new' | 'archived'
  tab: Tab
  onTab: (t: Tab) => void
}) {
  const fullName = `${client.first_name} ${client.last_name}`
  const activeFlags = conditions.filter((c) => c.is_active).slice(0, 2)
  const router = useRouter()
  const [isOpening, startOpenThread] = useTransition()
  const [openError, setOpenError] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [isArchiving, startArchive] = useTransition()
  const [archiveError, setArchiveError] = useState<string | null>(null)

  function handleOpenThread() {
    if (isOpening) return
    setOpenError(null)
    startOpenThread(async () => {
      const res = await getOrCreateThreadAction(client.id)
      if (res.error || !res.data) {
        setOpenError(res.error ?? 'Could not open thread.')
        return
      }
      router.push(`/messages?thread=${res.data.threadId}`)
    })
  }

  function handleArchive() {
    if (isArchiving) return
    setArchiveError(null)
    startArchive(async () => {
      const res = await archiveClientAction(client.id)
      // archiveClientAction redirects on success — if we get here, it errored.
      if (res?.error) {
        setArchiveError(res.error)
      }
    })
  }

  return (
    <div
      style={{
        background: '#fff',
        borderBottom: '1px solid var(--color-border-subtle)',
        position: 'sticky',
        top: 52,
        zIndex: 30,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '20px 32px 0',
        }}
      >
        {/* Breadcrumb */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '.74rem',
            color: 'var(--color-muted)',
            marginBottom: 14,
          }}
        >
          <Link
            href="/clients"
            style={{
              color: 'var(--color-text-light)',
              textDecoration: 'none',
            }}
          >
            Clients
          </Link>
          <ChevronRight size={12} aria-hidden />
          <span>{fullName}</span>
        </div>

        {/* Identity row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 18,
            marginBottom: 12,
          }}
        >
          <span
            className={`avatar ${toneFor(client.id)}`}
            style={{ width: 64, height: 64, fontSize: 22 }}
          >
            {initialsFor(client.first_name, client.last_name)}
          </span>

          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <h1
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: '1.9rem',
                  color: 'var(--color-charcoal)',
                  margin: 0,
                  letterSpacing: '-.005em',
                }}
              >
                {fullName}
              </h1>
              <IconGhost
                label={isOpening ? 'Opening thread…' : `Message ${fullName}`}
                onClick={handleOpenThread}
                disabled={isOpening}
              >
                <MessageCircle size={16} aria-hidden />
              </IconGhost>
              <IconGhost
                label={`Email ${fullName}`}
                href={`mailto:${client.email}`}
              >
                <Mail size={16} aria-hidden />
              </IconGhost>
              <IconGhost
                label="Archive client"
                onClick={() => setArchiveOpen(true)}
              >
                <MoreHorizontal size={16} aria-hidden />
              </IconGhost>
            </div>

            <div
              style={{
                fontSize: '.84rem',
                color: 'var(--color-text-light)',
                marginTop: 8,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              {client.category_name && (
                <span className="tag muted">{client.category_name}</span>
              )}
              {activeFlags.map((c) => (
                <span key={c.id} className="tag flag">
                  {c.condition}
                  {c.severity ? ` — severity ${c.severity}` : ''}
                </span>
              ))}
              <span className={`tag ${statusKind}`}>{statusLabel}</span>
            </div>
            {openError && (
              <div
                role="alert"
                style={{
                  marginTop: 8,
                  fontSize: '.78rem',
                  color: 'var(--color-alert)',
                }}
              >
                {openError}
              </div>
            )}
          </div>
        </div>

        {/* Tab strip */}
        <div
          role="tablist"
          aria-label="Client profile sections"
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '1px solid var(--color-border-subtle)',
            marginBottom: -1,
          }}
        >
          {TABS.map((t) => {
            const on = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTab(t.key)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: '12px 18px',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: on ? 600 : 500,
                  fontSize: '.85rem',
                  color: on ? 'var(--color-primary)' : 'var(--color-text-light)',
                  borderBottom: `2px solid ${
                    on ? 'var(--color-primary)' : 'transparent'
                  }`,
                  marginBottom: -1,
                  cursor: 'pointer',
                  transition: 'color 150ms cubic-bezier(0.4,0,0.2,1)',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>
      {archiveOpen && (
        <ArchiveConfirm
          fullName={fullName}
          onCancel={() => {
            if (!isArchiving) {
              setArchiveOpen(false)
              setArchiveError(null)
            }
          }}
          onConfirm={handleArchive}
          isArchiving={isArchiving}
          error={archiveError}
        />
      )}
    </div>
  )
}

function ArchiveConfirm({
  fullName,
  onCancel,
  onConfirm,
  isArchiving,
  error,
}: {
  fullName: string
  onCancel: () => void
  onConfirm: () => void
  isArchiving: boolean
  error: string | null
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-heading"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="archive-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 8px',
            color: 'var(--color-charcoal)',
          }}
        >
          Archive {fullName}?
        </h2>
        <p
          style={{
            fontSize: '.9rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.55,
            margin: '0 0 8px',
          }}
        >
          They&rsquo;ll be removed from your active client list and their email
          will be freed up so it can be re-invited later.
        </p>
        <p
          style={{
            fontSize: '.84rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.5,
            margin: '0 0 18px',
          }}
        >
          Their clinical record (notes, programs, sessions) stays in the
          database for compliance — this is not a permanent delete.
        </p>
        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              background: 'rgba(214,64,69,.08)',
              border: '1px solid rgba(214,64,69,.25)',
              borderRadius: 8,
              color: 'var(--color-alert)',
              fontSize: '.84rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            className="btn outline"
            onClick={onCancel}
            disabled={isArchiving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isArchiving}
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: '.84rem',
              padding: '8px 16px',
              borderRadius: 7,
              border: '1px solid var(--color-alert)',
              background: 'var(--color-alert)',
              color: '#fff',
              cursor: isArchiving ? 'not-allowed' : 'pointer',
              opacity: isArchiving ? 0.7 : 1,
            }}
          >
            {isArchiving ? 'Archiving…' : 'Archive client'}
          </button>
        </div>
      </div>
    </div>
  )
}

function IconGhost({
  children,
  label,
  href,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  href?: string
  onClick?: () => void
  disabled?: boolean
}) {
  const style: React.CSSProperties = {
    width: 30,
    height: 30,
    display: 'inline-grid',
    placeItems: 'center',
    borderRadius: 6,
    color: disabled ? 'var(--color-muted)' : 'var(--color-text-light)',
    background: 'transparent',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
  }
  if (href && !disabled) {
    return (
      <a href={href} aria-label={label} title={label} style={style}>
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  )
}

/* =========================================================================
 * TAB 1 — CLIENT DETAILS
 * ========================================================================= */

function DetailsTab({
  client,
  conditions,
}: {
  client: ProfileClient
  conditions: ProfileCondition[]
}) {
  const contactRows: Array<[string, string | null]> = [
    ['Email', client.email],
    ['Phone', client.phone],
    ['DOB', client.dob ? formatDob(client.dob) : null],
    ['Gender', client.gender],
    ['Address', client.address],
    ['Referrer', client.referral_source],
  ]

  const inactive = conditions.filter((c) => !c.is_active)

  return (
    <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Panel title="Contact" action={<GhostBtn icon={<Edit3 size={14} />} disabled />}>
        <div style={{ padding: '14px 18px' }}>
          {contactRows.map(([k, v]) => (
            <DetailRow key={k} label={k} value={v ?? '—'} muted={!v} />
          ))}
        </div>
      </Panel>

      <Panel title="Goals">
        <div
          style={{
            padding: '14px 18px',
            fontSize: '.86rem',
            color: client.goals?.trim()
              ? 'var(--color-text)'
              : 'var(--color-muted)',
            lineHeight: 1.6,
          }}
        >
          {client.goals?.trim() || 'None recorded.'}
        </div>
      </Panel>

      {inactive.length > 0 && (
        <Panel title="Resolved / historical">
          <div style={{ padding: '14px 18px' }}>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: '.86rem',
                color: 'var(--color-text)',
                lineHeight: 1.7,
              }}
            >
              {inactive.map((c) => (
                <li key={c.id}>
                  {c.condition}
                  {c.severity ? ` · severity ${c.severity}` : ''}
                  {c.diagnosis_date && (
                    <span
                      style={{
                        color: 'var(--color-muted)',
                        fontSize: '.78rem',
                        marginLeft: 6,
                      }}
                    >
                      ({formatDate(c.diagnosis_date)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      )}
    </div>
  )
}

function DetailRow({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '82px 1fr',
        gap: 12,
        padding: '5px 0',
        fontSize: '.82rem',
      }}
    >
      <span
        style={{
          color: 'var(--color-muted)',
          fontSize: '.7rem',
          letterSpacing: '.04em',
          textTransform: 'uppercase',
          fontWeight: 500,
          paddingTop: 3,
        }}
      >
        {label}
      </span>
      <span style={{ color: muted ? 'var(--color-muted)' : 'var(--color-text)' }}>
        {value}
      </span>
    </div>
  )
}

/* =========================================================================
 * TAB 2 — SESSION NOTES
 * ========================================================================= */

function NotesTab({ notes }: { notes: ProfileNote[] }) {
  const counts = {
    all: notes.length,
    soap: notes.filter(
      (n) => n.note_type === 'progress_note' || n.note_type === 'initial_assessment',
    ).length,
    flagged: notes.filter(
      (n) =>
        n.is_pinned ||
        n.note_type === 'injury_flag' ||
        n.note_type === 'contraindication',
    ).length,
    discharge: notes.filter((n) => n.note_type === 'discharge').length,
    general: notes.filter((n) => n.note_type === 'general').length,
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 22,
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <SoapComposer />

        {notes.length === 0 ? (
          <div
            className="card"
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              color: 'var(--color-text-light)',
              fontSize: '.88rem',
            }}
          >
            No notes yet — SOAP entries, re-assessments, and flags will land here.
          </div>
        ) : (
          notes.map((n) => <NoteCard key={n.id} note={n} />)
        )}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          position: 'sticky',
          top: 230,
        }}
      >
        <Panel title="Filter">
          <div
            style={{
              padding: '12px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            <FilterRow label="All notes" count={counts.all} active />
            <FilterRow label="SOAP" count={counts.soap} />
            <FilterRow label="Flagged" count={counts.flagged} />
            <FilterRow label="Discharge" count={counts.discharge} />
            <FilterRow label="General" count={counts.general} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

function FilterRow({
  label,
  count,
  active,
}: {
  label: string
  count: number
  active?: boolean
}) {
  return (
    <button
      type="button"
      style={{
        background: active ? 'var(--color-surface)' : 'transparent',
        border: 'none',
        padding: '6px 10px',
        borderRadius: 6,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '.84rem',
        color: 'var(--color-text)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span>{label}</span>
      <span style={{ color: 'var(--color-muted)' }}>{count}</span>
    </button>
  )
}

function SoapComposer() {
  return (
    <Panel
      title="Add clinical note"
      action={
        <div style={{ display: 'flex', gap: 6 }}>
          {['SOAP', 'Free text', 'Re-assessment', 'Phone call'].map((t, i) => (
            <span
              key={t}
              className={`chip ${i === 0 ? 'on' : ''}`}
              style={{
                fontSize: '.7rem',
                padding: '4px 10px',
                cursor: 'not-allowed',
                opacity: 0.85,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      }
    >
      <div style={{ padding: 18, display: 'grid', gap: 12 }}>
        {(['Subjective', 'Objective', 'Assessment', 'Plan'] as const).map((s) => (
          <div key={s}>
            <label
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.7rem',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                display: 'block',
                marginBottom: 4,
              }}
            >
              {s}
            </label>
            <textarea
              disabled
              placeholder={`${s.toLowerCase()}…`}
              style={{
                width: '100%',
                minHeight: 56,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 7,
                padding: '9px 12px',
                fontSize: '.85rem',
                fontFamily: 'inherit',
                lineHeight: 1.5,
                resize: 'vertical',
                color: 'var(--color-text)',
                opacity: 0.7,
              }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn ghost" disabled>
            <Paperclip size={14} aria-hidden />
            Attach
          </button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn outline" disabled>
            Save draft
          </button>
          <button type="button" className="btn primary" disabled>
            Save note
          </button>
        </div>
      </div>
    </Panel>
  )
}

function NoteCard({ note }: { note: ProfileNote }) {
  const flagged =
    note.is_pinned ||
    note.note_type === 'injury_flag' ||
    note.note_type === 'contraindication'
  const body = note.body_rich ?? note.subjective ?? ''

  return (
    <div
      className="card"
      style={{
        padding: '16px 20px',
        borderLeft: flagged ? '3px solid var(--color-alert)' : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.88rem',
              color: 'var(--color-charcoal)',
            }}
          >
            {formatDate(note.note_date)}
          </span>
          {note.is_pinned && (
            <span
              style={{
                fontSize: '.62rem',
                fontWeight: 700,
                color: 'var(--color-alert)',
                textTransform: 'uppercase',
                letterSpacing: '.04em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Pin size={10} aria-hidden /> Pinned
            </span>
          )}
          <span className={`tag ${flagged ? 'flag' : 'muted'}`}>
            {noteTypeLabel(note.note_type)}
          </span>
          {note.flag_body_region && (
            <span style={{ fontSize: '.74rem', color: 'var(--color-muted)' }}>
              {note.flag_body_region}
            </span>
          )}
          {note.title && (
            <span style={{ fontSize: '.86rem', fontWeight: 600 }}>
              {note.title}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="btn ghost"
            disabled
            aria-label="Edit note"
            style={{ padding: 6 }}
          >
            <Edit3 size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled
            aria-label="More actions"
            style={{ padding: 6 }}
          >
            <MoreHorizontal size={14} aria-hidden />
          </button>
        </div>
      </div>
      <div
        style={{
          fontSize: '.86rem',
          color: 'var(--color-text)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.6,
        }}
      >
        {body.trim() || (
          <span style={{ color: 'var(--color-muted)' }}>(empty note)</span>
        )}
      </div>
    </div>
  )
}

/* =========================================================================
 * TAB 3 — PROGRAMS
 * ========================================================================= */

function ProgramTab({
  clientId,
  program,
}: {
  clientId: string
  program: ProfileProgramSummary | null
}) {
  if (!program) {
    return (
      <div
        className="card"
        style={{
          padding: '40px 28px',
          textAlign: 'center',
          color: 'var(--color-text-light)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1.2rem',
            color: 'var(--color-charcoal)',
            marginBottom: 6,
          }}
        >
          No active mesocycle
        </div>
        <p
          style={{
            fontSize: '.9rem',
            lineHeight: 1.6,
            margin: '0 auto 20px',
            maxWidth: 440,
          }}
        >
          Start a mesocycle — pick the duration, day split, and a start date.
          Weeks and days scaffold out ready for the Session Builder.
        </p>
        <Link href={`/clients/${clientId}/program/new`} className="btn primary">
          <Plus size={14} aria-hidden />
          Start first mesocycle
        </Link>
      </div>
    )
  }

  const weeksLabel = program.duration_weeks
    ? `${program.duration_weeks}-week block`
    : 'Open-ended'
  const currentLabel =
    program.current_week !== null && program.duration_weeks
      ? `Wk ${program.current_week} of ${program.duration_weeks}`
      : program.current_week
        ? `Wk ${program.current_week}`
        : null

  return (
    <Panel
      title={`${program.name} · ${weeksLabel}${
        currentLabel ? ` · ${currentLabel}` : ''
      }`}
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href={`/clients/${clientId}/program/new`}
            className="btn outline"
            style={{ fontSize: '.78rem', padding: '6px 12px' }}
          >
            <Plus size={13} aria-hidden />
            New mesocycle
          </Link>
          <Link
            href={`/clients/${clientId}/program`}
            className="btn primary"
            style={{ fontSize: '.78rem', padding: '6px 12px' }}
          >
            Open calendar
          </Link>
        </div>
      }
    >
      <div
        style={{
          padding: '16px 20px',
          color: 'var(--color-text-light)',
          fontSize: '.86rem',
          lineHeight: 1.55,
        }}
      >
        {program.days_per_week} day split
        {program.start_date && ` · started ${formatDate(program.start_date)}`}
        . Open the calendar for the full week grid plus the day-by-day Session
        Builder.
      </div>
    </Panel>
  )
}

/* =========================================================================
 * TAB 4 — REPORTS
 * ========================================================================= */

function ReportsTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <Panel
        title="Force-plate assessment · Latest"
        action={
          <button type="button" className="btn outline" disabled style={{ fontSize: '.78rem' }}>
            <Plus size={13} aria-hidden />
            Log assessment
          </button>
        }
      >
        <EmptyBlock
          line1="No assessments logged yet"
          line2="Force-plate, isokinetic, and movement-screen results will populate this panel once the assessment module is wired up."
        />
      </Panel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 22,
        }}
      >
        <Panel title="Body composition">
          <EmptyBlock
            line1="No measurements yet"
            line2="Weight, body fat, and lean mass over time will track here."
          />
        </Panel>
        <Panel title="Strength benchmarks (1RM est.)">
          <EmptyBlock
            line1="No benchmarks yet"
            line2="Estimated 1RMs roll up from logged sessions once enough data is in."
          />
        </Panel>
      </div>
    </div>
  )
}

/* =========================================================================
 * TAB 5 — FILES
 * ========================================================================= */

function FilesTab() {
  return (
    <Panel
      title="Files · 0"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Search
              size={13}
              aria-hidden
              style={{
                position: 'absolute',
                left: 10,
                color: 'var(--color-muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="search"
              disabled
              placeholder="Search files…"
              style={{
                width: 220,
                padding: '6px 12px 6px 30px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 7,
                background: 'var(--color-surface)',
                fontSize: '.78rem',
                color: 'var(--color-text)',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <button type="button" className="btn outline" disabled style={{ fontSize: '.78rem' }}>
            <Filter size={13} aria-hidden />
            All types
          </button>
          <button type="button" className="btn primary" disabled style={{ fontSize: '.78rem' }}>
            <Upload size={13} aria-hidden />
            Upload
          </button>
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 110px 130px 120px 60px',
          padding: '10px 20px',
          background: 'var(--color-surface)',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.66rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div>Name</div>
        <div>Type</div>
        <div>Uploaded</div>
        <div>Size</div>
        <div />
      </div>
      <EmptyBlock
        line1="No files yet"
        line2="Referrals, imaging, consent forms, assessment exports, and demo videos will live here. Drag-and-drop or use Upload."
        accent={
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'var(--color-surface)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--color-muted)',
              margin: '0 auto 14px',
            }}
          >
            <FileText size={20} aria-hidden />
          </div>
        }
      />
    </Panel>
  )
}

/* =========================================================================
 * TAB 6 — INVOICES
 * ========================================================================= */

function InvoicesTab() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 22,
        alignItems: 'start',
      }}
    >
      <Panel
        title="Invoices"
        action={
          <button type="button" className="btn outline" disabled style={{ fontSize: '.78rem' }}>
            <Plus size={13} aria-hidden />
            New invoice
          </button>
        }
      >
        <EmptyBlock
          line1="No invoices yet"
          line2="Issued and paid invoices will appear here once billing is wired up."
          accent={
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'var(--color-surface)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--color-muted)',
                margin: '0 auto 14px',
              }}
            >
              <CreditCard size={20} aria-hidden />
            </div>
          }
        />
      </Panel>

      <Panel title="Funding">
        <div style={{ padding: '14px 18px' }}>
          <DetailRow label="Scheme" value="—" muted />
          <DetailRow label="Member #" value="—" muted />
          <DetailRow label="Sessions YTD" value="0" muted />
          <DetailRow label="Paid YTD" value="—" muted />
          <DetailRow label="Outstanding" value="—" muted />
        </div>
      </Panel>
    </div>
  )
}

/* =========================================================================
 * Shared building blocks
 * ========================================================================= */

function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function GhostBtn({
  icon,
  disabled,
  label,
}: {
  icon: React.ReactNode
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={disabled}
      aria-label={label ?? 'Action'}
      style={{ padding: 6 }}
    >
      {icon}
    </button>
  )
}

function EmptyBlock({
  line1,
  line2,
  accent,
}: {
  line1: string
  line2: string
  accent?: React.ReactNode
}) {
  return (
    <div
      style={{
        padding: '32px 24px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      {accent}
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        {line1}
      </div>
      <p
        style={{
          fontSize: '.84rem',
          lineHeight: 1.6,
          margin: '0 auto',
          maxWidth: 440,
        }}
      >
        {line2}
      </p>
    </div>
  )
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

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

function formatDob(dateIso: string): string {
  try {
    const dt = new Date(dateIso)
    const formatted = new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(dt)
    const age = Math.floor(
      (Date.now() - dt.getTime()) / (365.25 * 24 * 3600 * 1000),
    )
    return `${formatted} (${age})`
  } catch {
    return dateIso
  }
}


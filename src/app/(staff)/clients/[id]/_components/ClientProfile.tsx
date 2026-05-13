'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { getOrCreateThreadAction } from '../../../messages/actions'
import { archiveClientAction } from '../actions'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Edit3,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import type { Database } from '@/types/database'
import { initialsFor, toneFor } from '../../_lib/client-helpers'
import { SessionExerciseSummary } from '../../../_components/SessionExerciseSummary'
import { NotesTab } from './NotesTab'
import { FilesTab as FilesTabComponent, type ClientFile } from './FilesTab'
import { ReportsTab } from './ReportsTab'
import type {
  BatteryRow,
  CatalogCategory,
  ClientTestHistory,
  LastUsedBatteryHint,
  PublicationRow,
} from '@/lib/testing/loader-types'

type NoteType = Database['public']['Enums']['note_type']
type NoteFieldType = Database['public']['Enums']['note_template_field_type']
type AppointmentStatus = Database['public']['Enums']['appointment_status']

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

export type ProfileNoteContentField = {
  label: string
  type: NoteFieldType
  value: string
}

export type ProfileNoteContentJson = {
  fields: ProfileNoteContentField[]
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
  template_id: string | null
  appointment_id: string | null
  content_json: ProfileNoteContentJson | null
  version: number
  created_at: string
}

export type ProfileNoteTemplateField = {
  id: string
  label: string
  field_type: NoteFieldType
  default_value: string | null
  sort_order: number
}

export type ProfileNoteTemplate = {
  id: string
  name: string
  sort_order: number
  fields: ProfileNoteTemplateField[]
}

export type ProfileAppointment = {
  id: string
  start_at: string
  end_at: string
  appointment_type: string
  status: AppointmentStatus
}

export type ProfileReport = {
  id: string
  title: string
  report_type: string
  test_date: string
  is_published: boolean
  storage_bucket: string | null
  storage_path: string | null
}

export type ProfileProgramSummary = {
  id: string
  name: string
  duration_weeks: number | null
  start_date: string | null
  current_week: number | null
  days_per_week: number
}

// Phase D — completed-session feed for the Program tab's right panel.
// Newest-first, capped at 10 by the loader. `scheduled_date` is null
// only when the parent program_day was soft-deleted (sessions.program_day_id
// is ON DELETE SET NULL); the row keeps the completion data but loses the
// "what was this for" context.
//
// Phase L (2026-05-14) — extended with per-exercise + per-set detail to
// feed the SessionExerciseSummary expander. Aggregates (set_count, avg_rpe)
// are unchanged.
export type ProfileCompletionSet = {
  set_number: number
  reps: number | null
  // numeric coerced through Number() in the loader (PostgREST can return
  // numeric as string depending on driver settings).
  weight_value: number | null
  weight_metric: string | null
  optional_metric: string | null
  optional_value: string | null
  rpe: number | null
}

export type ProfileCompletionExercise = {
  exercise_log_id: string
  // program_exercise_id is null when the underlying program_exercise was
  // soft-deleted between completion and now (FK is ON DELETE SET NULL).
  program_exercise_id: string | null
  sort_order: number
  section_title: string | null
  superset_group_id: string | null
  exercise_name: string
  sets: ProfileCompletionSet[]
}

export type ProfileCompletion = {
  id: string
  day_label: string
  scheduled_date: string | null
  started_at: string
  completed_at: string
  duration_minutes: number | null
  session_rpe: number | null     // 1-10 or NULL (client skipped)
  feedback: string | null
  set_count: number
  // Phase L — ordered by sort_order. Empty array on skip-to-complete
  // sessions (no exercise_logs written).
  exercises: ProfileCompletionExercise[]
}

export type Tab =
  | 'details'
  | 'notes'
  | 'program'
  | 'reports'
  | 'files'
  | 'invoices'

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
  // Phase D — most recent 10 completed sessions for this client. Feeds
  // the Program tab's right-side CompletionsPanel.
  completions: ProfileCompletion[]
  statusLabel: 'Active' | 'New' | 'Archived'
  statusKind: 'active' | 'new' | 'archived'
  noteTemplates: ProfileNoteTemplate[]
  appointments: ProfileAppointment[]
  reports: ProfileReport[]
  files: ClientFile[]
  lastTemplateId: string | null
  initialTab: Tab
  initialOpenCreate: boolean
  initialAppointmentId: string | null
  // Testing module
  testCatalog: CatalogCategory[]
  testBatteries: BatteryRow[]
  lastUsedBattery: LastUsedBatteryHint | null
  testHistory: ClientTestHistory
  publications: PublicationRow[]
}

const VALID_TABS: Tab[] = [
  'details',
  'notes',
  'program',
  'reports',
  'files',
  'invoices',
]

/**
 * URL-driven tab state. Reading the `tab` search param keeps the active
 * tab consistent across deep-links (e.g. the schedule popover's "Add note"
 * lands on `?tab=notes&new=1`). Updating `setTab` rewrites the URL via a
 * shallow replace so the back button still works.
 */
function useTab(initial: Tab): [Tab, (next: Tab) => void] {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlTab = searchParams.get('tab')
  const tab: Tab =
    urlTab && (VALID_TABS as string[]).includes(urlTab)
      ? (urlTab as Tab)
      : initial

  function setTab(next: Tab) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'details') {
      params.delete('tab')
    } else {
      params.set('tab', next)
    }
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?')
  }

  return [tab, setTab]
}

export function ClientProfile({
  client,
  conditions,
  notes,
  program,
  completions,
  statusLabel,
  statusKind,
  noteTemplates,
  appointments,
  reports,
  files,
  lastTemplateId,
  initialTab,
  initialOpenCreate,
  initialAppointmentId,
  testCatalog,
  testBatteries,
  lastUsedBattery,
  testHistory,
  publications,
}: ClientProfileProps) {
  const [tab, setTab] = useTab(initialTab)

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
        {tab === 'notes' && (
          <NotesTab
            clientId={client.id}
            notes={notes}
            templates={noteTemplates}
            appointments={appointments}
            reports={reports}
            lastTemplateId={lastTemplateId}
            initialOpenCreate={initialOpenCreate}
            initialAppointmentId={initialAppointmentId}
            testCatalog={testCatalog}
            testBatteries={testBatteries}
            lastUsedBattery={lastUsedBattery}
          />
        )}
        {tab === 'program' && (
          <ProgramTab
            clientId={client.id}
            program={program}
            completions={completions}
          />
        )}
        {tab === 'reports' && (
          <ReportsTab
            clientId={client.id}
            clientName={`${client.first_name} ${client.last_name}`}
            catalog={testCatalog}
            batteries={testBatteries}
            lastUsedBattery={lastUsedBattery}
            testHistory={testHistory}
            publications={publications}
          />
        )}
        {tab === 'files' && (
          <FilesTabComponent clientId={client.id} files={files} />
        )}
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
 * TAB 2 — SESSION NOTES (rendered by ./NotesTab.tsx — see import above)
 * ========================================================================= */

/* =========================================================================
 * TAB 3 — PROGRAMS
 * ========================================================================= */

function ProgramTab({
  clientId,
  program,
  completions,
}: {
  clientId: string
  program: ProfileProgramSummary | null
  completions: ProfileCompletion[]
}) {
  // No active program — keep the existing empty-state full-width.
  // The Recent completions panel would feel orphaned without a
  // program above it, so collapse to single column.
  if (!program) {
    return (
      <Panel
        title="Program"
        action={
          <Link
            href={`/clients/${clientId}/program`}
            className="btn primary"
            style={{ fontSize: '.78rem', padding: '6px 12px' }}
          >
            Open calendar
          </Link>
        }
      >
        <div
          style={{
            padding: '44px 28px',
            textAlign: 'center',
            color: 'var(--color-text-light)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: '1.25rem',
              color: 'var(--color-charcoal)',
              marginBottom: 6,
            }}
          >
            No active program
          </div>
          <p
            style={{
              fontSize: '.92rem',
              margin: '0 auto 20px',
              lineHeight: 1.6,
              maxWidth: 460,
            }}
          >
            Start a training block for this client — pick a duration and a
            day-of-week split. The Session Builder then lets you fill in
            exercises day by day.
          </p>
          <Link
            href={`/clients/${clientId}/program/new`}
            className="btn primary"
          >
            <Plus size={14} aria-hidden />
            Start first training block
          </Link>
        </div>
      </Panel>
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
    <div
      style={{
        display: 'grid',
        // Mirrors the Invoices tab's 2:1 split. Empty right column when
        // there are zero completions still renders a panel with an empty
        // state — keeps the layout stable as the client logs sessions.
        gridTemplateColumns: '2fr 1fr',
        gap: 22,
        alignItems: 'start',
      }}
    >
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
              New training block
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

      <CompletionsPanel completions={completions} />
    </div>
  )
}

/* =========================================================================
 * Phase D — Recent completions panel.
 *
 * Right-column companion to the Program panel. Shows up to 10 most recent
 * completed sessions for this client, newest first. Each row carries the
 * day_label, the scheduled date, an inline metric line (Duration · Sets ·
 * Avg per-set RPE · Session RPE), and the client's feedback truncated to
 * two lines (full text on hover via `title`).
 *
 * The panel renders even when there are zero completions — an empty-state
 * line "No sessions completed yet" keeps the layout stable, and the right
 * column doesn't collapse the moment the client logs their first session.
 * ========================================================================= */

function CompletionsPanel({
  completions,
}: {
  completions: ProfileCompletion[]
}) {
  // Phase L — single-row-expanded state per Q-L10 (a). Lifted to the panel
  // so opening one row collapses any previously-open row in the same list.
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <Panel title="Recent completions">
      {completions.length === 0 ? (
        <div
          style={{
            padding: '28px 18px',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.86rem',
            lineHeight: 1.5,
          }}
        >
          No sessions completed yet.
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            // Cap height to ~10 rows; vertical scroll kicks in beyond.
            // The loader limits to 10 so scrolling is rare; the cap is
            // defensive for taller-than-expected feedback text + the
            // Phase L expander's per-exercise rows.
            maxHeight: 480,
            overflowY: 'auto',
          }}
        >
          {completions.map((c) => (
            <CompletionRow
              key={c.id}
              completion={c}
              isExpanded={expandedId === c.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === c.id ? null : c.id))
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

function CompletionRow({
  completion,
  isExpanded,
  onToggle,
}: {
  completion: ProfileCompletion
  isExpanded: boolean
  onToggle: () => void
}) {
  // Compose the inline metric line from whichever fields have data.
  // "—" placeholders would be noisy in a horizontal list; we drop the
  // missing ones instead and rely on order to convey what's present.
  const parts: string[] = []
  parts.push(formatCompletionDuration(completion.duration_minutes))
  parts.push(
    `${completion.set_count} ${completion.set_count === 1 ? 'set' : 'sets'}`,
  )
  if (completion.session_rpe !== null) {
    parts.push(`RPE ${completion.session_rpe}`)
  }

  // Date header. Prefer scheduled_date — that's the "what day was this
  // for" date the EP recognises from the calendar. Fall back to
  // completed_at when the parent program_day was soft-deleted (orphan).
  const headerDate =
    completion.scheduled_date ?? completion.completed_at.slice(0, 10)

  // Phase L — Q-L11 (b): hide the chevron entirely when no sets were
  // logged. The row stays in the list but isn't expandable; expanding an
  // empty body would be misleading.
  const canExpand = completion.set_count > 0

  return (
    <li
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-input)',
        border: '1px solid var(--color-border-hairline)',
        background: 'var(--color-card)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="eyebrow"
            style={{ marginBottom: 4, fontSize: '.64rem' }}
          >
            {completion.day_label} · {formatCompletionDate(headerDate)}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.9rem',
              color: 'var(--color-charcoal)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.3,
            }}
          >
            {parts.join(' · ')}
          </div>
          {completion.feedback && (
            <div
              // `title` surfaces the full text on hover when the
              // line-clamp truncates. Italics differentiate the client's
              // voice from system labels.
              title={completion.feedback}
              style={{
                marginTop: 6,
                fontSize: '.8rem',
                color: 'var(--color-text)',
                fontStyle: 'italic',
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'break-word',
              }}
            >
              {completion.feedback}
            </div>
          )}
        </div>
        {canExpand && (
          <button
            type="button"
            aria-label={isExpanded ? 'Hide exercise detail' : 'Show exercise detail'}
            aria-expanded={isExpanded}
            onClick={onToggle}
            style={{
              flexShrink: 0,
              width: 28,
              height: 28,
              display: 'inline-grid',
              placeItems: 'center',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-light)',
              cursor: 'pointer',
              transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {isExpanded ? (
              <ChevronUp size={16} aria-hidden />
            ) : (
              <ChevronDown size={16} aria-hidden />
            )}
          </button>
        )}
      </div>
      {canExpand && isExpanded && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--color-border-hairline)',
          }}
        >
          <SessionExerciseSummary exercises={completion.exercises} />
        </div>
      )}
    </li>
  )
}

/**
 * "Sat 10 May" — Australian English short. Mirrors the program
 * calendar's formatLongDate so a session's date renders the same way
 * regardless of which surface you read it from.
 */
function formatCompletionDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(y!, (m ?? 1) - 1, d ?? 1)
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(dt)
  } catch {
    return iso
  }
}

/**
 * "42m", "1h 7m", "1h", "<1m" (very short test runs), or "—" when the
 * generated column came back NULL.
 */
function formatCompletionDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes <= 0) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/* =========================================================================
 * TAB 4 — REPORTS (rendered by ./ReportsTab.tsx — see import above)
 * ========================================================================= */

/* =========================================================================
 * TAB 5 — FILES (rendered by ./FilesTab.tsx — see import above)
 * ========================================================================= */

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


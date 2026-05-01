'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { getOrCreateThreadAction } from '../../../messages/actions'
import { archiveClientAction } from '../actions'
import {
  ChevronRight,
  CreditCard,
  Edit3,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import type { Database } from '@/types/database'
import { initialsFor, toneFor } from '../../_lib/client-helpers'
import { NotesTab } from './NotesTab'
import { FilesTab as FilesTabComponent, type ClientFile } from './FilesTab'
import { ReportsTab } from './ReportsTab'
import { PublishTab } from './PublishTab'
import type {
  BatteryRow,
  CatalogCategory,
  ClientTestHistory,
  LastUsedBatteryHint,
  PublicationRow,
} from '@/lib/testing/loader-types'
import { buildPublishView, hasPublishWorkflow } from './reports/helpers'

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

export type Tab =
  | 'details'
  | 'notes'
  | 'program'
  | 'reports'
  | 'publish'
  | 'files'
  | 'invoices'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'details', label: 'Client details' },
  { key: 'notes', label: 'Session notes' },
  { key: 'program', label: 'Programs' },
  { key: 'reports', label: 'Reports' },
  { key: 'publish', label: 'Publish' },
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
  'publish',
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
  // Publish tab is only meaningful when there are on_publish sessions
  // for this client. Hide it otherwise to keep the tab strip tight.
  const publishView = buildPublishView(testHistory, publications)
  const showPublishTab = hasPublishWorkflow(publishView)

  return (
    <div style={{ background: 'var(--color-surface)', minHeight: '100%' }}>
      <ClientHeader
        client={client}
        conditions={conditions}
        statusLabel={statusLabel}
        statusKind={statusKind}
        tab={tab}
        onTab={setTab}
        showPublishTab={showPublishTab}
        pendingPublishCount={publishView.pending.length}
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
          <ProgramTab clientId={client.id} program={program} />
        )}
        {tab === 'reports' && (
          <ReportsTab
            clientId={client.id}
            clientName={`${client.first_name} ${client.last_name}`}
            catalog={testCatalog}
            batteries={testBatteries}
            lastUsedBattery={lastUsedBattery}
            testHistory={testHistory}
          />
        )}
        {tab === 'publish' && showPublishTab && (
          <PublishTab
            clientId={client.id}
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
  showPublishTab,
  pendingPublishCount,
}: {
  client: ProfileClient
  conditions: ProfileCondition[]
  statusLabel: 'Active' | 'New' | 'Archived'
  statusKind: 'active' | 'new' | 'archived'
  tab: Tab
  onTab: (t: Tab) => void
  showPublishTab: boolean
  pendingPublishCount: number
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
            if (t.key === 'publish' && !showPublishTab) return null
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {t.label}
                {t.key === 'publish' && pendingPublishCount > 0 && (
                  <span
                    aria-label={`${pendingPublishCount} pending`}
                    style={{
                      display: 'inline-grid',
                      placeItems: 'center',
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      borderRadius: 999,
                      background: 'var(--color-warning)',
                      color: '#fff',
                      fontSize: '.62rem',
                      fontWeight: 700,
                      lineHeight: 1,
                    }}
                  >
                    {pendingPublishCount}
                  </span>
                )}
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


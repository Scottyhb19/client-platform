import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { todayIsoInPracticeTz } from '@/lib/dates'
import { loadCatalog, loadTestHistoryForClient } from '@/lib/testing/loaders'
import type { ClientTestHistory } from '@/lib/testing/loader-types'
import {
  initialsFor,
  toneFor,
} from '../../_lib/client-helpers'
import { MonthCalendar } from './_components/MonthCalendar'
import type {
  ProgramSummary,
  ProgramDayWithExercises,
  ProgramExerciseWithMeta,
} from './_components/MonthCalendar'
import { ProgramToolbar } from './_components/ProgramToolbar'
import { CalendarPanelToggle } from './_components/CalendarPanelToggle'
import { CalendarSidePanel } from './_components/CalendarSidePanel'
import { type ClinicalNoteSummary } from '../_components/NotesPanel'
import {
  NOTE_SUMMARY_COLUMNS,
  mergeNoteRows,
  toClinicalNoteSummaries,
  type NoteSummaryRow,
} from '../_lib/note-summaries'
import { type SessionReport } from '../_components/ReportsPanel'

export const dynamic = 'force-dynamic'

/**
 * 08 Program Calendar — per client.
 *
 * Phase B (D-PROG-001..003): the loader now fetches ALL active programs
 * for the client (D-PROG-002 — multiple back-to-back blocks coexist),
 * plus every program_day across them keyed by scheduled_date (D-PROG-001),
 * plus every program_exercise in bulk so the inline day summary renders
 * without an extra round-trip.
 *
 * The MonthCalendar component computes the visible month range from
 * the programs' date ranges and renders one collapsible section per
 * month, current month at top.
 */
export default async function ClientProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ panel?: string }>
}) {
  const { id } = await params
  const { panel } = await searchParams
  const panelOpen = panel === 'notes'
  const supabase = await createSupabaseServerClient()

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select(
      `id, first_name, last_name,
       category:client_categories(name)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (clientErr) throw new Error(`Load client: ${clientErr.message}`)
  if (!client) notFound()

  // All active programs for this client. D-PROG-002 lifted the
  // single-active-per-client rule; back-to-back blocks coexist as long
  // as their date ranges don't overlap.
  const { data: programsRaw, error: progErr } = await supabase
    .from('programs')
    .select(
      `id, name, status, duration_weeks, start_date, notes, created_at`,
    )
    .eq('client_id', id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('start_date', { ascending: true, nullsFirst: false })

  if (progErr) throw new Error(`Load programs: ${progErr.message}`)

  const programs: ProgramSummary[] = (programsRaw ?? [])
    .filter(
      (p): p is typeof p & { start_date: string; duration_weeks: number } =>
        p.start_date !== null && p.duration_weeks !== null,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      duration_weeks: p.duration_weeks,
    }))

  let days: ProgramDayWithExercises[] = []

  if (programs.length > 0) {
    const programIds = programs.map((p) => p.id)

    // Days across every active program. Each carries scheduled_date
    // directly post-D-PROG-001; no week walk required.
    const { data: daysRaw, error: daysErr } = await supabase
      .from('program_days')
      .select(
        `id, program_id, scheduled_date, day_label, sort_order`,
      )
      .in('program_id', programIds)
      .is('deleted_at', null)
      .order('scheduled_date', { ascending: true })

    if (daysErr) throw new Error(`Load days: ${daysErr.message}`)

    // Bulk-fetch all exercises for those days. Single round-trip; the
    // calendar renders each day's summary inline without lazy-loading.
    let exercisesByDayId = new Map<string, ProgramExerciseWithMeta[]>()
    if ((daysRaw ?? []).length > 0) {
      const dayIds = (daysRaw ?? []).map((d) => d.id)

      const { data: exRaw, error: exErr } = await supabase
        .from('program_exercises')
        .select(
          `id, program_day_id, sort_order, sets, reps, optional_value,
           optional_metric, rpe, rest_seconds, tempo, instructions,
           section_title, superset_group_id,
           exercise:exercises(name, video_url)`,
        )
        .in('program_day_id', dayIds)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })

      if (exErr) throw new Error(`Load exercises: ${exErr.message}`)

      for (const e of exRaw ?? []) {
        const list = exercisesByDayId.get(e.program_day_id) ?? []
        list.push({
          id: e.id,
          sort_order: e.sort_order,
          sets: e.sets,
          reps: e.reps,
          optional_value: e.optional_value,
          optional_metric: e.optional_metric,
          rpe: e.rpe,
          rest_seconds: e.rest_seconds,
          tempo: e.tempo,
          instructions: e.instructions,
          section_title: e.section_title,
          superset_group_id: e.superset_group_id,
          exercise: e.exercise,
        })
        exercisesByDayId.set(e.program_day_id, list)
      }
    }

    days = (daysRaw ?? []).map((d) => ({
      id: d.id,
      program_id: d.program_id,
      scheduled_date: d.scheduled_date,
      day_label: d.day_label,
      sort_order: d.sort_order,
      exercises: exercisesByDayId.get(d.id) ?? [],
    }))
  }

  // P0-2 / FM-1 (docs/polish/program-calendar.md): practice-timezone today,
  // never UTC — the server clock is UTC, which is yesterday until ~10–11am
  // in Australia. Every downstream consumer (today ring, Today snap-back,
  // copy-pick past-dimming, resolveCurrentBlock) keys off this value.
  const todayIso = todayIsoInPracticeTz()
  const currentBlock = resolveCurrentBlock(programs, todayIso)

  // Side panel content (Phase E, refreshed Phase J.2 2026-05-08). Only
  // fetched when the panel is open — closed-state path stays cheap (the
  // common case). Notes are sourced via content_json (per migration
  // 20260427100000); reports come from client_publications joined to
  // test_sessions, with the catalog providing test names. Mirrors the
  // session-builder day page loader.
  let clinicalNotes: ClinicalNoteSummary[] = []
  let reports: SessionReport[] = []
  let testHistory: ClientTestHistory = { tests: [], categories: [], sessions: [] }
  if (panelOpen) {
    const { organizationId } = await requireRole(['owner', 'staff'])
    const [
      { data: notesRaw, error: notesErr },
      { data: flagsRaw, error: flagsErr },
      { data: noteTemplatesRaw },
      publicationsResult,
      catalog,
      historyLoaded,
      { data: batteriesRaw },
    ] = await Promise.all([
      supabase
        .from('clinical_notes')
        .select(NOTE_SUMMARY_COLUMNS)
        .eq('client_id', id)
        .is('deleted_at', null)
        .order('is_pinned', { ascending: false })
        .order('note_date', { ascending: false })
        .limit(30),
      // CN-1: active flags, unbounded by the 30-note window — an old but
      // unresolved flag must still surface while programming. Merged with
      // the recent window below (dedup by id).
      supabase
        .from('clinical_notes')
        .select(NOTE_SUMMARY_COLUMNS)
        .eq('client_id', id)
        .is('deleted_at', null)
        .in('note_type', ['injury_flag', 'contraindication'])
        .is('flag_resolved_at', null)
        .order('note_date', { ascending: false }),
      supabase
        .from('note_templates')
        .select('id, name')
        .is('deleted_at', null),
      // Phase J.4 (2026-05-09): also pulls applied_battery_id from the
      // joined session so the rail's reader can show the battery chip.
      supabase
        .from('client_publications')
        .select(
          `id, test_session_id, test_id, framing_text, published_at,
           session:test_sessions!inner(
             client_id, conducted_at, deleted_at, applied_battery_id
           )`,
        )
        .eq('session.client_id', id)
        .is('session.deleted_at', null)
        .is('deleted_at', null)
        .order('published_at', { ascending: false })
        .limit(20),
      loadCatalog(supabase, organizationId, { includeCustom: true }),
      // Phase J.4: per-test trajectories — feeds the Reports reader's
      // baseline / previous / current calculations. Bounded per client.
      loadTestHistoryForClient(supabase, organizationId, id),
      // Phase J.4: applied_battery_id → battery_name lookup for the chip.
      supabase
        .from('test_batteries')
        .select('id, name')
        .is('deleted_at', null),
    ])
    testHistory = historyLoaded

    if (notesErr) throw new Error(`Load clinical notes: ${notesErr.message}`)
    if (flagsErr) throw new Error(`Load active flags: ${flagsErr.message}`)
    if (publicationsResult.error)
      throw new Error(`Load publications: ${publicationsResult.error.message}`)

    const templateNameById = new Map<string, string>()
    for (const t of noteTemplatesRaw ?? []) {
      templateNameById.set(t.id, t.name)
    }
    clinicalNotes = toClinicalNoteSummaries(
      mergeNoteRows(
        (notesRaw ?? []) as NoteSummaryRow[],
        (flagsRaw ?? []) as NoteSummaryRow[],
      ),
      templateNameById,
    )

    const testNameById = new Map<string, string>()
    for (const cat of catalog) {
      for (const sub of cat.subcategories) {
        for (const t of sub.tests) {
          testNameById.set(t.id, t.name)
        }
      }
    }
    type PublicationJoinRow = {
      id: string
      test_session_id: string
      test_id: string
      framing_text: string | null
      published_at: string
      session: {
        client_id: string
        conducted_at: string
        deleted_at: string | null
        applied_battery_id: string | null
      } | null
    }
    const batteryNameById = new Map<string, string>()
    for (const b of batteriesRaw ?? []) {
      batteryNameById.set(b.id, b.name)
    }
    const publicationsRaw =
      (publicationsResult.data ?? []) as unknown as PublicationJoinRow[]
    reports = publicationsRaw.map((p) => {
      const appliedBatteryId = p.session?.applied_battery_id ?? null
      return {
        id: p.id,
        test_session_id: p.test_session_id,
        test_id: p.test_id,
        test_name: testNameById.get(p.test_id) ?? p.test_id,
        conducted_at: p.session?.conducted_at ?? p.published_at,
        framing_text: p.framing_text,
        applied_battery_id: appliedBatteryId,
        battery_name: appliedBatteryId
          ? batteryNameById.get(appliedBatteryId) ?? null
          : null,
      }
    })
  }

  // When the side panel is open the calendar needs more horizontal room
  // so the day popover (which sizes to cell width) stays comfortable.
  // Closed state keeps the standard .page width — default looks unchanged.
  const widePageStyle = panelOpen
    ? {
        maxWidth: 'min(2000px, 98vw)',
        paddingLeft: 8,
        paddingRight: 8,
      }
    : undefined

  return (
    <div className="page" style={widePageStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <Link
          href={`/clients/${client.id}`}
          aria-label="Back to client profile"
          style={{
            color: 'var(--color-text-light)',
            padding: 6,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <span
          className={`avatar ${toneFor(client.id)}`}
          style={{ width: 44, height: 44, fontSize: 44 * 0.38 }}
        >
          {initialsFor(client.first_name, client.last_name)}
        </span>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            {client.first_name} {client.last_name}
            {client.category?.name && ` · ${client.category.name}`}
            {currentBlock && ` · ${currentBlock.name}`}
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.9rem',
              margin: 0,
              letterSpacing: '-.01em',
            }}
          >
            Program Calendar
          </h1>
          {currentBlock && (
            <div
              style={{
                fontSize: '.86rem',
                color: 'var(--color-text-light)',
                marginTop: 4,
              }}
            >
              {currentBlock.duration_weeks} week block · starts{' '}
              {formatDate(currentBlock.start_date)}
              {programs.length > 1 && ` · ${programs.length} blocks total`}
            </div>
          )}
        </div>
        <ProgramToolbar
          clientId={client.id}
          currentBlock={
            currentBlock
              ? {
                  id: currentBlock.id,
                  name: currentBlock.name,
                  start_date: currentBlock.start_date,
                  duration_weeks: currentBlock.duration_weeks,
                }
              : null
          }
          todayIso={todayIso}
        />
        <CalendarPanelToggle />
      </div>

      <div
        style={{
          display: panelOpen ? 'grid' : 'block',
          gridTemplateColumns: panelOpen ? '1fr 260px' : undefined,
          gap: panelOpen ? 16 : undefined,
          alignItems: panelOpen ? 'start' : undefined,
        }}
      >
        {programs.length === 0 ? (
          <EmptyProgram clientId={client.id} />
        ) : (
          <MonthCalendar
            clientId={client.id}
            programs={programs}
            days={days}
            todayIso={todayIso}
            compactPopover={panelOpen}
          />
        )}
        {panelOpen && (
          <CalendarSidePanel
            notes={clinicalNotes}
            reports={reports}
            history={testHistory}
          />
        )}
      </div>
    </div>
  )
}

/**
 * "Current block" determination per gap doc P1-8 / §4 Q3:
 *   1. The program containing today.
 *   2. Else the most recent past program.
 *   3. Else null.
 */
function resolveCurrentBlock(
  programs: ProgramSummary[],
  todayIso: string,
): ProgramSummary | null {
  if (programs.length === 0) return null
  const today = todayIso

  for (const p of programs) {
    const end = addDaysIso(p.start_date, p.duration_weeks * 7)
    if (today >= p.start_date && today < end) return p
  }

  // Most recent past (sorted ascending in the loader; iterate from end).
  for (let i = programs.length - 1; i >= 0; i--) {
    const p = programs[i]!
    if (p.start_date <= today) return p
  }

  return null
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function EmptyProgram({ clientId }: { clientId: string }) {
  return (
    <div
      className="card"
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
        Start a training block for this client — 4–8 weeks with a
        repeating day split (A/B, A/B/C, etc). The Session Builder then lets
        you fill in exercises day by day.
      </p>
      <Link
        href={`/clients/${clientId}/program/new`}
        className="btn primary"
      >
        <Plus size={14} aria-hidden />
        Start first training block
      </Link>
    </div>
  )
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

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Info } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { todayIsoInPracticeTz } from '@/lib/dates'
import { summarisePrescription } from '@/lib/prescription/summarise'
import { resolveCurrentBlock } from '@/lib/programs/current-block'
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
      `id, name, status, duration_weeks, start_date, notes, created_at, is_loose`,
    )
    .eq('client_id', id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('start_date', { ascending: true, nullsFirst: false })

  if (progErr) throw new Error(`Load programs: ${progErr.message}`)

  // Dated blocks only — these drive the calendar's block surfaces
  // (covering-program lookup, current-block resolution, the "Active" tag).
  // The loose one-off container (is_loose, null dates — item 3) is excluded
  // here so it never reads as a block.
  const programs: ProgramSummary[] = (programsRaw ?? [])
    .filter(
      (p): p is typeof p & { start_date: string; duration_weeks: number } =>
        !p.is_loose && p.start_date !== null && p.duration_weeks !== null,
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      start_date: p.start_date,
      duration_weeks: p.duration_weeks,
    }))

  // Days load for ALL active programs — dated blocks AND the loose container
  // — so one-off sessions render on the grid even on dates no block covers.
  const allActiveProgramIds = (programsRaw ?? []).map((p) => p.id)

  let days: ProgramDayWithExercises[] = []

  if (allActiveProgramIds.length > 0) {
    const programIds = allActiveProgramIds

    // Days across every active program. Each carries scheduled_date
    // directly post-D-PROG-001; no week walk required.
    const { data: daysRaw, error: daysErr } = await supabase
      .from('program_days')
      .select(
        `id, program_id, scheduled_date, day_label, sort_order, published_at`,
      )
      .in('program_id', programIds)
      .is('deleted_at', null)
      .order('scheduled_date', { ascending: true })

    if (daysErr) throw new Error(`Load days: ${daysErr.message}`)

    // Bulk-fetch all exercises for those days, plus their per-set
    // prescription rows. The live prescription lives in
    // program_exercise_sets (reps + volume unit, and load value + load
    // unit) since the per-set fan-out; the flat sets/reps/rpe/optional_*
    // columns on program_exercises are dead — reading them was why the day
    // popover showed "—" for every exercise. The metric-label lookup
    // resolves the LOAD unit code → display label for the summary line.
    // Single round-trip; the calendar renders each day's summary inline
    // without lazy-loading.
    const exercisesByDayId = new Map<string, ProgramExerciseWithMeta[]>()
    if ((daysRaw ?? []).length > 0) {
      const dayIds = (daysRaw ?? []).map((d) => d.id)

      const [{ data: exRaw, error: exErr }, { data: metricUnitsRaw }] =
        await Promise.all([
          supabase
            .from('program_exercises')
            .select(
              `id, program_day_id, sort_order, superset_group_id, rest_seconds,
               exercise:exercises(name, video_url),
               prescription_sets:program_exercise_sets(
                 set_number, reps, rep_metric, optional_metric, optional_value, deleted_at
               )`,
            )
            .in('program_day_id', dayIds)
            .is('deleted_at', null)
            .order('sort_order', { ascending: true }),
          // Tenant-configurable LOAD-unit labels (code → display_label).
          // Not is_active-filtered: a deactivated unit still needs its
          // label so an existing prescription renders, not a raw code.
          supabase
            .from('exercise_metric_units')
            .select('code, display_label')
            .is('deleted_at', null),
        ])

      if (exErr) throw new Error(`Load exercises: ${exErr.message}`)

      const metricLabelByCode: Record<string, string> = {}
      for (const u of metricUnitsRaw ?? []) {
        metricLabelByCode[u.code] = u.display_label
      }

      for (const e of exRaw ?? []) {
        const list = exercisesByDayId.get(e.program_day_id) ?? []
        // Live sets only, in set order — mirrors the builder loader. The
        // supabase-js select can't express the per-relation deleted_at
        // filter + set_number order cleanly, so do it in TS (tiny arrays).
        const liveSets = (e.prescription_sets ?? [])
          .filter((s) => s.deleted_at === null)
          .sort((a, b) => a.set_number - b.set_number)
        list.push({
          id: e.id,
          sort_order: e.sort_order,
          superset_group_id: e.superset_group_id,
          exercise: e.exercise,
          prescription: summarisePrescription(liveSets, {
            metricLabelByCode,
            restSeconds: e.rest_seconds,
          }),
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
      published_at: d.published_at,
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

  // P2-4 / FM-9 (Q3 = a): §6.2 — the calendar "fills full screen width by
  // default." The wide container now applies in BOTH panel states. The
  // closed-state 1200px cap was inherited from the standard .page container
  // (Phase E.0a only ever decided the panel-open width), never weighed
  // against the brief. The day popover sizes to cell width, so wider cells
  // just give it more room; the week-row buttons sit cleanly at any width.
  // paddingLeft/Right override only the horizontal .page padding; top/bottom
  // (32px) stay from the stylesheet.
  const widePageStyle = {
    maxWidth: 'min(2000px, 98vw)',
    paddingLeft: 8,
    paddingRight: 8,
  }

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
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                fontSize: '.86rem',
                color: 'var(--color-text-light)',
                marginTop: 4,
              }}
            >
              {/* P2-5 (§6.2 — "an Active tag"): quiet status chip beside the
                  current-block descriptor. Archived blocks are excluded from
                  this surface, so this is confirmation, not disambiguation;
                  the accent-green .tag.active is a sanctioned success-state
                  use of the green. */}
              <span className="tag active">Active</span>
              <span>
                {currentBlock.duration_weeks} week block · starts{' '}
                {formatDate(currentBlock.start_date)}
                {programs.length > 1 && ` · ${programs.length} blocks total`}
              </span>
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
          blocks={programs.map((p) => ({
            id: p.id,
            name: p.name,
            start_date: p.start_date,
            duration_weeks: p.duration_weeks,
          }))}
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
        <div>
          {/* Item 3: the calendar is always reachable — no block required.
              A quiet hint (not the old full-screen wall) when there's no
              dated block yet, pointing at both paths: click a date to add a
              session, or start a structured block from the toolbar. */}
          {programs.length === 0 && <NoBlockHint />}
          <MonthCalendar
            clientId={client.id}
            clientFirstName={client.first_name}
            programs={programs}
            days={days}
            todayIso={todayIso}
            compactPopover={panelOpen}
          />
        </div>
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

// "Current block" determination (P1-8 / §4 Q3) now lives in
// src/lib/programs/current-block.ts — shared with the client-profile
// Program tab since the P1-5 maybeSingle fix (program-calendar pass).

// Item 3 — replaces the old full-screen "No active program" wall. The
// calendar now renders even with no block, so this is a slim, quiet hint
// (not a gate) pointing at both ways forward.
function NoBlockHint() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        marginBottom: 12,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        fontSize: '.86rem',
        color: 'var(--color-text-light)',
        lineHeight: 1.5,
      }}
    >
      <Info
        size={16}
        aria-hidden
        style={{ flexShrink: 0, color: 'var(--color-muted)' }}
      />
      <span>
        No training block yet. Click any date to add a session, or start a
        structured block with{' '}
        <strong style={{ color: 'var(--color-charcoal)', fontWeight: 600 }}>
          New training block
        </strong>{' '}
        above.
      </span>
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

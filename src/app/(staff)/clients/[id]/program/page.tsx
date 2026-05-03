import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Plus } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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
import { type PinnedNote } from '../_components/NotesPanel'
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

  const todayIso = new Date().toISOString().slice(0, 10)
  const currentBlock = resolveCurrentBlock(programs, todayIso)

  // Side panel content (Phase E). Only fetched when the panel is open
  // — closed-state path stays cheap (the common case).
  let pinnedNotes: PinnedNote[] = []
  let reports: SessionReport[] = []
  if (panelOpen) {
    const [{ data: notesRaw }, { data: reportsRaw }] = await Promise.all([
      supabase
        .from('clinical_notes')
        .select(`id, body_rich, subjective, flag_body_region`)
        .eq('client_id', id)
        .eq('is_pinned', true)
        .is('deleted_at', null)
        .order('note_date', { ascending: false }),
      supabase
        .from('reports')
        .select('id, title, report_type, test_date, is_published')
        .eq('client_id', id)
        .is('deleted_at', null)
        .order('test_date', { ascending: false })
        .limit(20),
    ])

    // Skip empty pinned notes — a note with is_pinned=true but blank
    // body_rich AND subjective renders as a red strip with no content.
    // Filtered here so the panel stays meaningful (Phase F.6).
    pinnedNotes = (notesRaw ?? [])
      .map((n) => ({
        id: n.id,
        body: (n.body_rich ?? n.subjective ?? '').trim(),
        flag_body_region: n.flag_body_region,
      }))
      .filter((n) => n.body.length > 0)

    reports = (reportsRaw ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      report_type: r.report_type,
      test_date: r.test_date,
      is_published: r.is_published,
    }))
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
          <CalendarSidePanel notes={pinnedNotes} reports={reports} />
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

import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  TodayScreen,
  type TodaySession,
  type TodaySessionExercise,
} from './_components/TodayScreen'
import {
  addDays,
  buildWeekDots,
  greetingFor,
  isoFromDate,
  mondayFromIso,
  mondayOfCurrentWeek,
  type WeekDot,
} from './_lib/portal-helpers'

export const dynamic = 'force-dynamic'

export default async function PortalTodayPage({
  searchParams,
}: {
  // ?w=YYYY-MM-DD navigates the week strip to a different week. Missing or
  // invalid → snaps to mondayOfCurrentWeek().
  searchParams: Promise<{ w?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { w: weekParam } = await searchParams

  // Get this client's row (RLS allows self-SELECT via user_id = auth.uid()).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!client) notFound()

  // Active program (lightweight — for header / week-number context).
  const { data: program } = await supabase
    .from('programs')
    .select(`id, name, duration_weeks, start_date`)
    .eq('client_id', client.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  const weekStart = weekParam ? mondayFromIso(weekParam) : mondayOfCurrentWeek()
  const weekStartIso = isoFromDate(weekStart)
  const prevWeekIso = isoFromDate(addDays(weekStart, -7))
  const nextWeekIso = isoFromDate(addDays(weekStart, 7))
  const monthLabel = formatMonth(weekStart)
  const now = new Date()
  const todayIso = isoFromDate(now)
  const isCurrentWeek =
    weekStart.getTime() === mondayOfCurrentWeek(now).getTime()

  // Days for THIS calendar week — load via client_get_week_overview RPC.
  // The PostgREST embed exercise:exercises(name) we used previously
  // returned NULL because the exercises table is staff-only at the RLS
  // layer (see 20260420102600_rls_enable_and_policies.sql:445-465). The
  // RPC is SECURITY DEFINER pinned to auth.uid() and returns the exercise
  // summary as a jsonb array per day in a single round trip.
  type WeekDayRow = {
    program_day_id: string
    day_label: string
    scheduled_date: string
    sort_order: number
    exercises: RawExercise[]
  }
  let weekDays: WeekDayRow[] = []

  if (program) {
    const { data: overview } = await supabase.rpc(
      'client_get_week_overview',
      { p_week_start_date: weekStartIso },
    )

    weekDays = (overview ?? []).map((d) => ({
      program_day_id: d.program_day_id,
      day_label: d.day_label,
      scheduled_date: d.scheduled_date,
      sort_order: d.sort_order,
      exercises: Array.isArray(d.exercises)
        ? (d.exercises as RawExercise[])
        : [],
    }))
  }

  // Map weekday → programmed day for the week strip. Derive the
  // weekday locally from scheduled_date.
  const programmedByWeekday = new Map<
    number,
    { dayLabel: string | null; done: boolean }
  >()
  for (const d of weekDays) {
    const dow = parseIso(d.scheduled_date).getDay()
    programmedByWeekday.set(dow, {
      dayLabel: d.day_label,
      done: false, // "done" wires in once sessions table is populated
    })
  }

  const weekDots: WeekDot[] = buildWeekDots(weekStart, programmedByWeekday)

  // Today's session, if any.
  const todayDay = weekDays.find((d) => d.scheduled_date === todayIso)
  const session: TodaySession | null = todayDay
    ? {
        dayId: todayDay.program_day_id,
        dayLabel: `Today · ${todayDay.day_label}`,
        dayTitle: formatDayTitle(todayDay.day_label, program?.name ?? ''),
        metaLine: composeMetaLine(
          todayDay.exercises.length,
          program?.name ?? '',
          weekNumberFor(program, todayIso),
          program?.duration_weeks ?? null,
        ),
        exercises: buildExerciseList(todayDay.exercises),
      }
    : null

  const weekNumber = weekNumberFor(program, todayIso)

  return (
    <TodayScreen
      greeting={greetingFor(now)}
      name={client.first_name}
      weekHeading={
        program
          ? weekNumber
            ? `${formatShort(now)} · Week ${weekNumber}`
            : formatShort(now)
          : formatShort(now)
      }
      weekDots={weekDots}
      session={session}
      weekStats={{
        completed: 0, // wires to sessions table
        remaining: weekDays.length - 0,
        avgRpe: null,
      }}
      monthLabel={monthLabel}
      prevWeekHref={`/portal?w=${prevWeekIso}`}
      nextWeekHref={`/portal?w=${nextWeekIso}`}
      isCurrentWeek={isCurrentWeek}
      backToTodayHref="/portal"
    />
  )
}

function formatShort(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(d)
}

function formatMonth(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
  }).format(d)
}

function formatDayTitle(
  dayLabel: string,
  _programName: string,
): string {
  return dayLabel
}

function composeMetaLine(
  count: number,
  programName: string,
  week: number | undefined,
  duration: number | null,
): string {
  const bits: string[] = []
  bits.push(`${count} ${count === 1 ? 'exercise' : 'exercises'}`)
  if (programName) {
    bits.push(
      duration && week
        ? `${programName} · Wk ${week}/${duration}`
        : programName,
    )
  }
  return bits.join(' · ')
}

// Shape of one exercise object inside the client_get_week_overview RPC's
// per-day jsonb array (see 20260510140000_client_get_week_overview.sql).
// The RPC pre-resolves exercises.name through the SECURITY DEFINER barrier
// so it lands here as a top-level field rather than via a nested join.
type RawExercise = {
  program_exercise_id: string
  sort_order: number
  section_title: string | null
  superset_group_id: string | null
  name: string
  sets: number | null
  reps: string | null
  optional_value: string | null
  rpe: number | null
}

function buildExerciseList(
  raw: RawExercise[],
): TodaySessionExercise[] {
  const sorted = [...raw].sort((a, b) => a.sort_order - b.sort_order)

  // Determine superset group membership to generate A / A1 / A2 letters.
  const groupCounts = new Map<string, number>()
  for (const e of sorted) {
    if (e.superset_group_id) {
      groupCounts.set(
        e.superset_group_id,
        (groupCounts.get(e.superset_group_id) ?? 0) + 1,
      )
    }
  }

  // Tone names match the .portal-seq[data-tone] selectors. Renamed in
  // Phase B from charcoal/primary/accent/amber — the new names describe
  // what the bubble actually looks like rather than what it was meant to.
  const tones: TodaySessionExercise['tone'][] = [
    'default',
    'muted',
    'parchment',
    'outline',
  ]
  let groupLetterIndex = -1
  let currentGroupId: string | null = null
  let subIndex = 0

  return sorted.map((e, i) => {
    const groupId = e.superset_group_id
    const inSuperset =
      groupId !== null && (groupCounts.get(groupId) ?? 1) > 1

    let letter: string
    if (!groupId || groupId !== currentGroupId) {
      groupLetterIndex += 1
      currentGroupId = groupId
      subIndex = 1
      const base = String.fromCharCode(65 + groupLetterIndex)
      letter = inSuperset ? `${base}1` : base
    } else {
      subIndex += 1
      letter = `${String.fromCharCode(65 + groupLetterIndex)}${subIndex}`
    }

    return {
      id: e.program_exercise_id,
      letter,
      name: e.name,
      rx: buildRx(e),
      tone: tones[i % tones.length],
    }
  })
}

function buildRx(e: RawExercise): string {
  const bits: string[] = []
  if (e.sets && e.reps) bits.push(`${e.sets} × ${e.reps}`)
  else if (e.sets) bits.push(`${e.sets} sets`)
  else if (e.reps) bits.push(e.reps)
  if (e.optional_value) bits.push(e.optional_value)
  if (e.rpe) bits.push(`RPE ${e.rpe}`)
  return bits.join(' · ') || '—'
}

// Date helper — local-time interpretation to dodge UTC shift on date-only
// ISO strings. Local because used only here; isoFromDate is shared and
// lives in portal-helpers.ts.
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

// Compute which week-of-program contains the given ISO date. Returns
// undefined for clients with no active program or with a program that
// hasn't started yet. Post D-PROG-001 weeks are derived from dates on
// the fly; week_number is no longer the addressing field, so we compute
// from start_date.
function weekNumberFor(
  program: { start_date: string | null; duration_weeks: number | null } | null | undefined,
  todayIso: string,
): number | undefined {
  if (!program?.start_date) return undefined
  const start = parseIso(program.start_date)
  const today = parseIso(todayIso)
  const diffMs = today.getTime() - start.getTime()
  if (diffMs < 0) return undefined
  const dayDiff = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const weekIdx = Math.floor(dayDiff / 7) + 1
  if (program.duration_weeks && weekIdx > program.duration_weeks) {
    return undefined
  }
  return weekIdx
}

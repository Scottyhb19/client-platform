import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  TodayScreen,
  type TodaySession,
  type TodaySessionExercise,
} from './_components/TodayScreen'
import {
  buildWeekDots,
  greetingFor,
  mondayOfCurrentWeek,
  weekdayIndex,
  type WeekDot,
} from './_lib/portal-helpers'

export const dynamic = 'force-dynamic'

export default async function PortalTodayPage() {
  const supabase = await createSupabaseServerClient()

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

  const weekStart = mondayOfCurrentWeek()
  const weekStartIso = isoFromDate(weekStart)
  const weekEndIso = isoFromDate(addDaysTo(weekStart, 7)) // exclusive end
  const now = new Date()
  const todayIso = isoFromDate(now)
  const todayDow = weekdayIndex(now)

  // Days for THIS calendar week, post D-PROG-001 — query by date range
  // directly. Only published days surface to the client (RLS + the
  // explicit published_at filter below).
  let weekDays: Array<{
    id: string
    day_label: string
    scheduled_date: string
    sort_order: number
    published_at: string | null
    program_exercises: Array<{
      id: string
      sort_order: number
      section_title: string | null
      superset_group_id: string | null
      sets: number | null
      reps: string | null
      optional_value: string | null
      rpe: number | null
      exercise: { name: string } | null
    }>
  }> = []

  if (program) {
    const { data: daysRaw } = await supabase
      .from('program_days')
      .select(
        `id, day_label, scheduled_date, sort_order, published_at,
         program_exercises(
           id, sort_order, section_title, superset_group_id,
           sets, reps, optional_value, rpe,
           exercise:exercises(name)
         )`,
      )
      .eq('program_id', program.id)
      .gte('scheduled_date', weekStartIso)
      .lt('scheduled_date', weekEndIso)
      .not('published_at', 'is', null)
      .is('deleted_at', null)
      .order('scheduled_date', { ascending: true })

    weekDays = daysRaw ?? []
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
        dayId: todayDay.id,
        dayLabel: `Today · Day ${todayDay.day_label}`,
        dayTitle: formatDayTitle(todayDay.day_label, program?.name ?? ''),
        metaLine: composeMetaLine(
          todayDay.program_exercises?.length ?? 0,
          program?.name ?? '',
          weekNumberFor(program, todayIso),
          program?.duration_weeks ?? null,
        ),
        exercises: buildExerciseList(todayDay.program_exercises ?? []),
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

function formatDayTitle(
  dayLabel: string,
  _programName: string,
): string {
  return `Day ${dayLabel}`
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

type RawExercise = {
  id: string
  sort_order: number
  superset_group_id: string | null
  sets: number | null
  reps: string | null
  optional_value: string | null
  rpe: number | null
  exercise: { name: string } | null
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

  const tones: TodaySessionExercise['tone'][] = [
    'charcoal',
    'primary',
    'accent',
    'amber',
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
      id: e.id,
      letter,
      name: e.exercise?.name ?? 'Exercise',
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

// Date helpers — local-time interpretation to dodge UTC shift on
// date-only ISO strings.
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function addDaysTo(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
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

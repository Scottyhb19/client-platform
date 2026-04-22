import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  buildWeekDots,
  TodayScreen,
  type TodaySession,
  type TodaySessionExercise,
  type WeekDot,
} from './_components/TodayScreen'
import {
  greetingFor,
  mondayOfCurrentWeek,
  weekdayIndex,
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

  // Active program + weeks + days + exercises.
  const { data: program } = await supabase
    .from('programs')
    .select(
      `id, name, duration_weeks, start_date,
       program_weeks(
         id, week_number,
         program_days(
           id, day_label, day_of_week, sort_order,
           program_exercises(
             id, sort_order, section_title, superset_group_id,
             sets, reps, optional_value, rpe,
             exercise:exercises(name)
           )
         )
       )`,
    )
    .eq('client_id', client.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  const weekStart = mondayOfCurrentWeek()
  const now = new Date()
  const todayDow = weekdayIndex(now)

  // Which program_week falls on THIS calendar week?
  const currentWeekRow = program?.program_weeks?.find((w) => {
    if (!program.start_date) return false
    const pStart = new Date(program.start_date)
    const diff = Math.floor(
      (weekStart.getTime() - pStart.getTime()) / (7 * 24 * 60 * 60 * 1000),
    )
    return w.week_number === diff + 1
  })

  // Map weekday → programmed day for the week strip.
  const programmedByWeekday = new Map<
    number,
    { dayLabel: string | null; done: boolean }
  >()
  for (const d of currentWeekRow?.program_days ?? []) {
    if (d.day_of_week === null) continue
    programmedByWeekday.set(d.day_of_week, {
      dayLabel: d.day_label,
      done: false, // "done" wires in once sessions table is populated
    })
  }

  const weekDots: WeekDot[] = buildWeekDots(weekStart, programmedByWeekday)

  // Today's session, if any.
  const todayDay = currentWeekRow?.program_days?.find(
    (d) => d.day_of_week === todayDow,
  )
  const session: TodaySession | null = todayDay
    ? {
        dayId: todayDay.id,
        dayLabel: `Today · Day ${todayDay.day_label}`,
        dayTitle: formatDayTitle(todayDay.day_label, program?.name ?? ''),
        metaLine: composeMetaLine(
          todayDay.program_exercises?.length ?? 0,
          program?.name ?? '',
          currentWeekRow?.week_number,
          program?.duration_weeks ?? null,
        ),
        exercises: buildExerciseList(todayDay.program_exercises ?? []),
      }
    : null

  const weekNumber = currentWeekRow?.week_number ?? null

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
        remaining:
          (currentWeekRow?.program_days?.length ?? 0) - 0,
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

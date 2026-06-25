import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  DayScreen,
  type DaySession,
  type DaySessionExercise,
} from './_components/DayScreen'
import {
  addDays,
  buildWeekDots,
  deriveDayState,
  greetingFromHour,
  isoFromDate,
  mondayFromIso,
  mondayOfCurrentWeek,
  weekdayIndex,
  type DayCompletionEntry,
  type WeekDot,
} from './_lib/portal-helpers'
import { hourInTimeZone } from '@/lib/dates'
import { resolvePortalToday } from './_lib/timezone'
import { formatVolume } from '@/lib/prescription/volume-units'

export const dynamic = 'force-dynamic'

export default async function PortalTodayPage({
  searchParams,
}: {
  // ?w=YYYY-MM-DD navigates the week strip to a different week.
  // ?d=YYYY-MM-DD selects which day's card the screen renders (Phase K).
  // Both missing or invalid → snap to current week + today.
  searchParams: Promise<{ w?: string; d?: string }>
}) {
  const supabase = await createSupabaseServerClient()
  const { w: weekParam, d: dayParam } = await searchParams

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

  // Resolve "today" in the device/org timezone (section 7 / P0-1) — never
  // from a UTC `new Date()`. Feeds the today-highlight, the card CTA state
  // machine, the greeting, the week anchor, and the week-number.
  const { tz, todayIso } = await resolvePortalToday(supabase)
  const todayDate = parseIso(todayIso)

  // Active programs (lightweight — for header / week-number context).
  // FM-1 fix (item 3): never .maybeSingle() here — it throws on ≥2 active
  // rows, and a loose one-off container can now coexist with a dated block
  // (back-to-back blocks already could, D-PROG-002). Fetch all, then resolve
  // the header program: the dated block covering today, else the first dated
  // block, else the loose container. The week's session data is independent
  // of this choice — it comes from the client-scoped week-overview RPC below.
  const { data: activePrograms } = await supabase
    .from('programs')
    .select(`id, name, duration_weeks, start_date, is_loose`)
    .eq('client_id', client.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('is_loose', { ascending: true })
    .order('start_date', { ascending: true, nullsFirst: false })

  const datedBlocks = (activePrograms ?? []).filter(
    (p) => !p.is_loose && p.start_date !== null && p.duration_weeks !== null,
  )
  const coveringBlock = datedBlocks.find((p) => {
    const endIso = isoFromDate(
      addDays(parseIso(p.start_date as string), (p.duration_weeks as number) * 7),
    )
    return todayIso >= (p.start_date as string) && todayIso < endIso
  })
  const program =
    coveringBlock ?? datedBlocks[0] ?? (activePrograms ?? [])[0] ?? null

  // Q-B: a loose-only client's header reads "Your sessions", not the
  // internal "One-off sessions" container name.
  const programDisplayName = program
    ? program.is_loose
      ? 'Your sessions'
      : program.name
    : ''

  // C-9: first-run detection. Only queried when there's no active
  // program — a programmed client can never see the welcome card, so the
  // happy path pays nothing. "First run" = no client-visible programs
  // row of ANY status (client RLS exposes active + archived; a draft the
  // EP is still building stays invisible, which keeps the card up and
  // its copy literally true) AND no sessions row ever. Both conditions
  // self-expire permanently: the first publish or first log flips one
  // forever, with no stored dismissal state. On query error, fail closed
  // to the rest-day card rather than risk welcoming a veteran client.
  let firstRun = false
  if (!program) {
    const [programsRes, sessionsRes] = await Promise.all([
      supabase
        .from('programs')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .is('deleted_at', null),
      supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', client.id)
        .is('deleted_at', null),
    ])
    firstRun =
      !programsRes.error &&
      !sessionsRes.error &&
      (programsRes.count ?? 0) === 0 &&
      (sessionsRes.count ?? 0) === 0
  }

  const weekStart = weekParam
    ? mondayFromIso(weekParam, todayDate)
    : mondayOfCurrentWeek(todayDate)
  const weekStartIso = isoFromDate(weekStart)
  const prevWeekIso = isoFromDate(addDays(weekStart, -7))
  const nextWeekIso = isoFromDate(addDays(weekStart, 7))
  const monthLabel = formatMonth(weekStart)
  const isCurrentWeek =
    weekStart.getTime() === mondayOfCurrentWeek(todayDate).getTime()

  // Phase K: selected-day ISO. Defaults to today on missing/invalid.
  // Invalid means: not parseable as YYYY-MM-DD or outside this week.
  // Outside-this-week falls back to today (rather than auto-navigating
  // weeks) so the URL parsing stays predictable.
  const selectedDayIso = resolveSelectedDayIso(dayParam, weekStart, todayIso)
  const selectedDate = parseIso(selectedDayIso)

  // Days for THIS calendar week — load via client_get_week_overview RPC.
  // SECURITY DEFINER + auth.uid()-pinned join; the PostgREST embed
  // exercise:exercises(name) silently drops under the staff-only
  // exercises RLS, so we use the RPC.
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

  // Phase K (Q-K6.1): single combined SELECT against sessions, derive
  // both completed and in-progress sets from one query. Pulls
  // started_at + completed_at so future state additions (abandoned /
  // paused) can be derived without re-querying. RLS scopes to the
  // caller's own rows; the .in() filter scopes to this week's
  // program_day_ids.
  const completedDayIds = new Set<string>()
  const inProgressDayIds = new Set<string>()
  if (weekDays.length > 0) {
    const { data: sessionRows } = await supabase
      .from('sessions')
      .select('program_day_id, started_at, completed_at')
      .in(
        'program_day_id',
        weekDays.map((d) => d.program_day_id),
      )
      .is('deleted_at', null)
    for (const s of sessionRows ?? []) {
      if (!s.program_day_id) continue
      if (s.completed_at !== null) {
        completedDayIds.add(s.program_day_id)
      } else if (s.started_at !== null) {
        inProgressDayIds.add(s.program_day_id)
      }
    }
  }

  // Map weekday → programmed day for the week strip. Derive the
  // weekday locally from scheduled_date. dayId carried so every strip
  // cell can render as a Link (rest days included, per Q-K7).
  const programmedByWeekday = new Map<number, DayCompletionEntry>()
  for (const d of weekDays) {
    const dow = weekdayIndex(parseIso(d.scheduled_date))
    programmedByWeekday.set(dow, {
      dayLabel: d.day_label,
      done: completedDayIds.has(d.program_day_id),
      inProgress: inProgressDayIds.has(d.program_day_id),
      dayId: d.program_day_id,
    })
  }

  const weekDots: WeekDot[] = buildWeekDots(
    weekStart,
    programmedByWeekday,
    todayIso,
  )

  // Phase K (Q-K7): every cell navigates. Per-cell hrefs keyed by index
  // — programmed and rest days alike land at /portal?d=<iso>&w=<weekIso>.
  // Week token preserved so cross-week navigation doesn't lose the user's
  // place on the strip.
  const cellHrefs = weekDots.map((d) => {
    const iso = isoFromDate(d.date)
    return `/portal?w=${weekStartIso}&d=${iso}`
  })

  // Selected day's session card data, if any. Find the matching
  // program_day for the selected ISO, then derive the card state.
  const selectedDay = weekDays.find((d) => d.scheduled_date === selectedDayIso)
  const session: DaySession | null = selectedDay
    ? {
        dayId: selectedDay.program_day_id,
        dayLabel: composeDayLabel(selectedDate, todayIso, selectedDay.day_label),
        dayTitle: formatDayTitle(selectedDay.day_label, programDisplayName),
        metaLine: composeMetaLine(
          selectedDay.exercises.length,
          programDisplayName,
          weekNumberFor(program, selectedDayIso),
          program?.duration_weeks ?? null,
        ),
        exercises: buildExerciseList(selectedDay.exercises),
        state: deriveDayState(
          selectedDate,
          todayIso,
          true,
          completedDayIds.has(selectedDay.program_day_id),
          inProgressDayIds.has(selectedDay.program_day_id),
        ),
      }
    : null

  const weekNumber = weekNumberFor(program, todayIso)

  return (
    <DayScreen
      greeting={greetingFromHour(hourInTimeZone(tz))}
      name={client.first_name}
      weekHeading={
        program
          ? weekNumber
            ? `${formatShort(todayDate)} · Week ${weekNumber}`
            : formatShort(todayDate)
          : formatShort(todayDate)
      }
      weekDots={weekDots}
      session={session}
      weekStats={{
        completed: completedDayIds.size,
        remaining: weekDays.length - completedDayIds.size,
      }}
      monthLabel={monthLabel}
      prevWeekHref={`/portal?w=${prevWeekIso}`}
      nextWeekHref={`/portal?w=${nextWeekIso}`}
      isCurrentWeek={isCurrentWeek}
      backToTodayHref="/portal"
      selectedDayIso={selectedDayIso}
      todayIso={todayIso}
      cellHrefs={cellHrefs}
      firstRun={firstRun}
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

/**
 * Phase K: day-label eyebrow varies by selected day.
 *   Today  → "Today · Day C"
 *   Other  → "Tue 14 May · Day C" (short weekday + date + day_label)
 *
 * The "Today · " prefix is load-bearing — it's the only signal on the
 * card that the user is looking at *today* vs another day in the week.
 */
function composeDayLabel(
  selectedDate: Date,
  todayIso: string,
  dayLabel: string,
): string {
  const isoSel = isoFromDate(selectedDate)
  if (isoSel === todayIso) return `Today · ${dayLabel}`
  const short = new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(selectedDate)
  return `${short} · ${dayLabel}`
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
// per-day jsonb array. The RPC pre-resolves exercises.name through the
// SECURITY DEFINER barrier so it lands here as a top-level field rather
// than via a nested join.
type RawExercise = {
  program_exercise_id: string
  sort_order: number
  section_title: string | null
  superset_group_id: string | null
  name: string
  sets: number | null
  reps: string | null
  rep_metric: string | null
  optional_value: string | null
  rpe: number | null
}

function buildExerciseList(
  raw: RawExercise[],
): DaySessionExercise[] {
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

  // Tone names match the .portal-seq[data-tone] selectors.
  const tones: DaySessionExercise['tone'][] = [
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
  // Render the volume in its unit (rep_metric) so a hold reads "3 × 30s" and
  // a carry "3 × 20m", not a bare count (FM-5).
  const vol = formatVolume(e.reps, e.rep_metric)
  if (e.sets && vol) bits.push(`${e.sets} × ${vol}`)
  else if (e.sets) bits.push(`${e.sets} sets`)
  else if (vol) bits.push(vol)
  if (e.optional_value) bits.push(e.optional_value)
  if (e.rpe) bits.push(`RPE ${e.rpe}`)
  return bits.join(' · ') || '—'
}

// Local-time interpretation to dodge UTC shift on date-only ISO strings.
function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

/**
 * Phase K: resolve ?d=YYYY-MM-DD to a valid ISO inside the current
 * week. Invalid / out-of-week falls back to todayIso so navigating to
 * a different week with a stale ?d= reads as "no selection." If today
 * itself isn't in the current week (e.g. user navigated to next week
 * via ?w=), fall back to the week's Monday.
 */
function resolveSelectedDayIso(
  raw: string | undefined,
  weekStart: Date,
  todayIso: string,
): string {
  const inWeek = (iso: string): boolean => {
    const d = parseIso(iso)
    const diffMs = d.getTime() - weekStart.getTime()
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
    return days >= 0 && days < 7
  }

  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && inWeek(raw)) {
    return raw
  }
  if (inWeek(todayIso)) return todayIso
  return isoFromDate(weekStart)
}

// Compute which week-of-program contains the given ISO date.
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

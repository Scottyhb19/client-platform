import Link from 'next/link'
import { Calendar as CalendarIcon, UserPlus as UserPlusIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import {
  todayIsoInTimeZone,
  startOfDayInstant,
  addDaysToIsoDate,
  hourInTimeZone,
} from '@/lib/dates'
import {
  categoryToneFor,
  initialsFor,
  type AvatarTone,
} from '../clients/_lib/client-helpers'
import {
  RecentlyCompletedPanel,
  type DashboardCompletion,
} from './_components/RecentlyCompletedPanel'
import {
  AttentionPanel,
  type AttentionItem,
  type AttentionTone,
} from './_components/AttentionPanel'
import type {
  ProfileCompletionExercise,
  ProfileCompletionSet,
} from '../clients/[id]/_components/ClientProfile'

export const dynamic = 'force-dynamic'

/**
 * 01 Dashboard — landing for owners + staff after sign-in.
 *
 * Renders four stat cards, a Needs-attention panel, Today's sessions,
 * and a Recently-completed feed. All computed from live data; everything
 * empty-states cleanly. Per the §11 owner decision, the dashboard is a
 * "what needs my attention?" briefing only — the §6.8.5 client list was
 * deliberately not built (the Clientele page serves that role).
 */
export default async function DashboardPage() {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Greeting name + org timezone, fetched together. The timezone is
  // load-bearing: every "today" boundary below is resolved in it (P0-1).
  const [{ data: profile }, { data: org }] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('first_name')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('timezone')
      .eq('id', organizationId)
      .maybeSingle(),
  ])

  // ── Practice-timezone "today" (P0-1) ───────────────────────────────────
  // The server clock (Vercel) is UTC. Deriving "today" from server-local
  // time put the greeting, the date header, and the today's-sessions window
  // up to 11h out for an AU practice — wrong for most of the working day.
  // Resolve the day boundaries in the org timezone instead, exactly as the
  // TopBar and the scheduling grid already do (see src/lib/dates.ts).
  const tz = org?.timezone ?? PRACTICE_TIMEZONE
  const now = new Date()
  const todayIso = todayIsoInTimeZone(tz)
  const todayStart = startOfDayInstant(todayIso, tz)
  const todayEnd = startOfDayInstant(addDaysToIsoDate(todayIso, 1), tz)
  const fourteenDaysAgo = startOfDayInstant(
    addDaysToIsoDate(todayIso, -14),
    tz,
  )
  const tenDaysAgoIso = addDaysToIsoDate(todayIso, -10)
  const tenDaysAgo = startOfDayInstant(tenDaysAgoIso, tz)
  // Onboarding funnel (§1 v2): a client invited 7+ days ago who still has no
  // first logged session is "hasn't got going". Start-of-day floor, consistent
  // with the other thresholds above.
  const sevenDaysAgo = startOfDayInstant(addDaysToIsoDate(todayIso, -7), tz)
  const todayPlus7Iso = addDaysToIsoDate(todayIso, 7)
  // Reconciliation (item 3): past appointments needing attendance set or a note,
  // bounded to a recent window so ancient never-reconciled bookings don't nag
  // forever (a months-old session won't get a fresh note anyway).
  const reconcileLookback = startOfDayInstant(
    addDaysToIsoDate(todayIso, -30),
    tz,
  )

  // Parallel fetches.
  const [
    { data: activeClients },
    { data: newClients },
    { data: todaysAppointments },
    { data: recentCompletionRows },
    { data: allProgramRows },
    { data: flaggedNotes },
    { data: lastCompletedRows },
    { data: assessmentNoteRows },
    { data: apptActivityRows },
    { data: upcomingProgramDayRows },
    { data: pastApptRows },
    { data: notedApptRows },
    { data: categoryRows },
  ] = await Promise.all([
    supabase
      .from('clients')
      .select(
        'id, first_name, last_name, invited_at, onboarded_at, created_at, overdue_followed_up_at, category_id',
      )
      .is('deleted_at', null)
      .is('archived_at', null),
    supabase
      .from('clients')
      .select('id, first_name, last_name, created_at')
      .is('deleted_at', null)
      .is('archived_at', null)
      .gte('created_at', fourteenDaysAgo.toISOString()),
    supabase
      .from('appointments')
      .select(
        `id, start_at, end_at, appointment_type, status,
         client:clients(id, first_name, last_name)`,
      )
      .gte('start_at', todayStart.toISOString())
      .lt('start_at', todayEnd.toISOString())
      .is('deleted_at', null)
      .order('start_at'),
    // 5 most recent completed sessions across this EP's clients (RLS scopes
    // to own org). Fetch 8 then drop archived-client / null rows and slice
    // to 5 (P2-2), so an archived client's session can't crowd the list.
    // Same embed shape as the profile completions loader plus client identity.
    supabase
      .from('sessions')
      .select(
        `id, completed_at, session_rpe,
         client:clients(id, first_name, last_name, archived_at, category_id),
         program_day:program_days(day_label, scheduled_date),
         exercise_logs(
           id, program_exercise_id,
           program_exercise:program_exercises(
             sort_order, section_title, superset_group_id,
             exercise:exercises(name)
           ),
           set_logs(
             set_number, reps_performed, rep_metric, weight_value, weight_metric,
             optional_metric, optional_value, rpe
           )
         )`,
      )
      .not('completed_at', 'is', null)
      .is('deleted_at', null)
      .order('completed_at', { ascending: false })
      .limit(8),
    // All non-deleted programs (any status). Drives the programs-ending
    // stat + the Ending/Overdue attention triggers (active rows) and the
    // "has a program at all" gate for the New trigger (any status).
    supabase
      .from('programs')
      .select(
        `id, status, start_date, duration_weeks, client_id,
         client:clients(id, first_name, last_name, archived_at)`,
      )
      .is('deleted_at', null),
    // CN-4 (brief §6.8.2): active flags not reviewed within 14 days.
    // "Mark reviewed" on the client profile clears a flag from here for the
    // next 14 days; resolving clears it for good.
    supabase
      .from('clinical_notes')
      .select(
        `id, note_type, title, flag_body_region, flag_reviewed_at,
         flag_resolved_at,
         client:clients(id, first_name, last_name, archived_at)`,
      )
      .in('note_type', ['injury_flag', 'contraindication'])
      .is('deleted_at', null)
      .is('flag_resolved_at', null)
      .or(
        `flag_reviewed_at.is.null,flag_reviewed_at.lt.${fourteenDaysAgo.toISOString()}`,
      )
      .limit(20),
    // Per-client most-recent completed session, for the Overdue trigger.
    // Narrow 2-column projection ordered desc; reduced to one row per client
    // below. Cheap at f&f scale; promote to a SECURITY DEFINER aggregate RPC
    // if telemetry later says otherwise (same watch-list as recent sessions).
    supabase
      .from('sessions')
      .select('client_id, completed_at')
      .not('completed_at', 'is', null)
      .is('deleted_at', null)
      .order('completed_at', { ascending: false }),
    // Clients with a recorded initial assessment, for the New trigger. The live
    // signal is an `initial_assessment` clinical note (the note-template path) —
    // NOT the dormant `assessments` table, which has no write path in the app
    // and never gains rows, so the previous query made the "assessment complete"
    // branch dead in real use (v2 fix).
    supabase
      .from('clinical_notes')
      .select('client_id')
      .eq('note_type', 'initial_assessment')
      .is('deleted_at', null),
    // Appointments (in-clinic / booked sessions), for the "no upcoming training"
    // gap detection — including single-session clients who have no program at
    // all and would otherwise be invisible here. Real client bookings only:
    // kind 'unavailable' (staff admin blocks, no client) and cancelled slots are
    // excluded. Split into upcoming vs past in code; the latest past one is the
    // client's "last seen".
    supabase
      .from('appointments')
      .select('client_id, start_at')
      .eq('kind', 'appointment')
      .neq('status', 'cancelled')
      .not('client_id', 'is', null)
      .is('deleted_at', null),
    // Upcoming program days (scheduled today or later), for "sessions remaining":
    // a client with a future day still has training queued, so they are not a
    // gap even once the program passes its nominal end date — and conversely a
    // program past its last scheduled day IS a gap. More precise than the end
    // date alone.
    supabase
      .from('program_days')
      .select('scheduled_date, program:programs(client_id, status, deleted_at)')
      .gte('scheduled_date', todayIso)
      .is('deleted_at', null),
    // Reconciliation (item 3): past client appointments (ended, within the last
    // ~30 days) that may need attention. pending/confirmed = attendance not set;
    // completed = a note may be owed. no_show + cancelled are already reconciled
    // (excluded). kind='appointment' = EP-conducted bookings (portal home/gym
    // training lives in `sessions`, not here, so it's excluded by construction).
    supabase
      .from('appointments')
      .select(
        `id, start_at, status,
         client:clients(id, first_name, last_name, archived_at)`,
      )
      .eq('kind', 'appointment')
      .in('status', ['pending', 'confirmed', 'completed'])
      .lt('end_at', now.toISOString())
      .gte('start_at', reconcileLookback.toISOString())
      .is('deleted_at', null)
      .order('start_at', { ascending: true }),
    // Appointment ids that already have a clinical note — for the "note owed"
    // distinction (a completed appointment with no linked note).
    supabase
      .from('clinical_notes')
      .select('appointment_id')
      .not('appointment_id', 'is', null)
      .is('deleted_at', null),
    // Category order drives the recently-completed avatar tones
    // (categoryToneFor) — same ordering as the Clientele list.
    supabase
      .from('client_categories')
      .select('id')
      .is('deleted_at', null)
      .order('sort_order'),
  ])

  const categoryIds = (categoryRows ?? []).map((c) => c.id)

  // Client-category avatar tones for the attention rows — identity colour,
  // consistent with every other client bubble. Every attention client is a
  // live non-archived client, so activeClients covers them all; misses fall
  // back to neutral inside buildAttentionList.
  const toneByClientId = new Map<string, AvatarTone>(
    (activeClients ?? []).map((c) => [
      c.id,
      categoryToneFor(c.category_id, categoryIds),
    ]),
  )

  // ── Derived lookups ────────────────────────────────────────────────────
  type ProgramRow = {
    id: string
    status: string
    start_date: string | null
    duration_weeks: number | null
    client_id: string
    client: {
      id: string
      first_name: string
      last_name: string
      archived_at: string | null
    } | null
  }
  const allPrograms = (allProgramRows ?? []) as unknown as ProgramRow[]
  const activePrograms = allPrograms.filter((p) => p.status === 'active')

  // client_id → latest completed session timestamp (rows are already DESC).
  const lastCompletedByClient = new Map<string, string>()
  for (const r of (lastCompletedRows ?? []) as Array<{
    client_id: string
    completed_at: string | null
  }>) {
    if (r.completed_at && !lastCompletedByClient.has(r.client_id)) {
      lastCompletedByClient.set(r.client_id, r.completed_at)
    }
  }

  // client_id → overdue follow-up acknowledgement (ms). Set by the dashboard
  // "Program checked & message sent" button; suppresses the Overdue trigger for
  // ~10 days, then lets it re-surface if the client is still silent. See
  // buildAttentionList + acknowledgeOverdueFollowupAction.
  const overdueFollowedUpByClient = new Map<string, number>()
  for (const c of (activeClients ?? []) as Array<{
    id: string
    overdue_followed_up_at: string | null
  }>) {
    if (c.overdue_followed_up_at) {
      overdueFollowedUpByClient.set(
        c.id,
        new Date(c.overdue_followed_up_at).getTime(),
      )
    }
  }

  const assessedClientIds = new Set(
    ((assessmentNoteRows ?? []) as Array<{ client_id: string }>).map(
      (a) => a.client_id,
    ),
  )
  const clientsWithAnyProgram = new Set(allPrograms.map((p) => p.client_id))
  const clientsWithDraftProgram = new Set(
    allPrograms.filter((p) => p.status === 'draft').map((p) => p.client_id),
  )

  // Appointment activity, split past vs upcoming. `upcomingApptClientIds` = a
  // booked session today or later (so a single-session client isn't a gap).
  // `lastApptMsByClient` = when last seen in-clinic, so a single-session client
  // who has stopped — and has no program — is caught (and dated).
  const todayStartMs = todayStart.getTime()
  const upcomingApptClientIds = new Set<string>()
  const lastApptMsByClient = new Map<string, number>()
  for (const a of (apptActivityRows ?? []) as Array<{
    client_id: string | null
    start_at: string
  }>) {
    if (!a.client_id) continue
    const t = new Date(a.start_at).getTime()
    if (t >= todayStartMs) {
      upcomingApptClientIds.add(a.client_id)
    } else {
      const prev = lastApptMsByClient.get(a.client_id)
      if (prev === undefined || t > prev) lastApptMsByClient.set(a.client_id, t)
    }
  }

  // Clients with at least one upcoming program day (the program live or queued,
  // not deleted): training is still scheduled, so they are not a gap — this is
  // the "sessions remaining" test (§2 v2), more precise than the program's
  // nominal end date.
  const upcomingProgramDayClientIds = new Set<string>()
  for (const d of (upcomingProgramDayRows ?? []) as unknown as Array<{
    program: {
      client_id: string
      status: string
      deleted_at: string | null
    } | null
  }>) {
    const prog = d.program
    if (
      prog &&
      !prog.deleted_at &&
      (prog.status === 'active' || prog.status === 'draft')
    ) {
      upcomingProgramDayClientIds.add(prog.client_id)
    }
  }

  // Appointment ids that already carry a clinical note — the "note owed"
  // reconciliation test (completed appointment, no note yet).
  const notedApptIds = new Set(
    ((notedApptRows ?? []) as Array<{ appointment_id: string | null }>)
      .map((n) => n.appointment_id)
      .filter((id): id is string => id !== null),
  )

  // Reconciliation candidates (item 3): one per past appointment that may need
  // attention, ordered oldest-first so the per-client dedupe keeps the oldest.
  // Dates are resolved in the practice tz here so buildAttentionList stays
  // tz-agnostic (dateIso → the `?d=` schedule deep-link; dateShort → the reason).
  type ReconcileApptRow = {
    id: string
    start_at: string
    status: string
    client: {
      id: string
      first_name: string
      last_name: string
      archived_at: string | null
    } | null
  }
  const reconcileAppts: ReconcileAppt[] = (
    (pastApptRows ?? []) as unknown as ReconcileApptRow[]
  )
    .filter((a) => a.client !== null && !a.client.archived_at)
    .map((a) => ({
      id: a.id,
      clientId: a.client!.id,
      firstName: a.client!.first_name,
      lastName: a.client!.last_name,
      status: a.status,
      hasNote: notedApptIds.has(a.id),
      dateIso: isoDateInTimeZone(a.start_at, tz),
      when: formatDateTimeShort(new Date(a.start_at), tz),
    }))

  // ── Stats ──────────────────────────────────────────────────────────────
  // Cancelled appointments still render on the board (struck-through) so a
  // cancelled slot doesn't silently vanish — but a cancelled slot is not a
  // "session happening today", so the stat count + the next-session cue are
  // computed over the live (non-cancelled) rows only.
  const activeToday = (todaysAppointments ?? []).filter(
    (a) => a.status !== 'cancelled',
  )
  const sessionsToday = activeToday.length
  const nextSession = activeToday.find(
    (a) => new Date(a.start_at).getTime() >= now.getTime(),
  )
  const activeClientCount = activeClients?.length ?? 0
  const newThisWeek =
    (newClients ?? []).filter(
      (c) =>
        now.getTime() - new Date(c.created_at).getTime() <=
        7 * 24 * 60 * 60 * 1000,
    ).length

  // Programs ending: active programs whose computed end date falls inside the
  // next 7 days and is not already past (P1-3). The old test
  // (`weeksIn + 1 >= duration_weeks`) stayed true forever once a program
  // passed its final week, so long-stale programs inflated the count.
  const programsEndingCount = activePrograms.filter((p) => {
    const end = programEndIso(p.start_date, p.duration_weeks)
    return end !== null && end >= todayIso && end <= todayPlus7Iso
  }).length

  // ── Needs-attention (4 brief triggers, deduped per client) ─────────────
  const attention = buildAttentionList({
    flaggedNotes: (flaggedNotes ?? []) as unknown as FlaggedNote[],
    activeClients: activeClients ?? [],
    activePrograms,
    lastCompletedByClient,
    overdueFollowedUpByClient,
    assessedClientIds,
    clientsWithAnyProgram,
    clientsWithDraftProgram,
    upcomingApptClientIds,
    lastApptMsByClient,
    upcomingProgramDayClientIds,
    reconcileAppts,
    toneByClientId,
    nowMs: now.getTime(),
    tenDaysAgoMs: tenDaysAgo.getTime(),
    tenDaysAgoIso,
    sevenDaysAgoMs: sevenDaysAgo.getTime(),
    todayIso,
    todayPlus7Iso,
  })
  // Total attention ROWS across both groups (rule 3, operator 2026-06-28: count
  // rows, not clients — a client with both an adherence and a clinical-admin row
  // counts twice). Drives the stat + sub-line.
  const attentionRowCount = attention.adherence.length + attention.admin.length

  // Project recent completions into the panel shape, dropping archived-client
  // and null-client rows, then keeping the 5 most recent (P2-2).
  type RecentCompletionRow = {
    id: string
    completed_at: string
    session_rpe: number | null
    client: {
      id: string
      first_name: string
      last_name: string
      archived_at: string | null
      category_id: string | null
    } | null
    program_day: { day_label: string; scheduled_date: string } | null
    exercise_logs:
      | Array<{
          id: string
          program_exercise_id: string | null
          program_exercise: {
            sort_order: number
            section_title: string | null
            superset_group_id: string | null
            exercise: { name: string } | null
          } | null
          set_logs: Array<{
            set_number: number
            reps_performed: number | null
            rep_metric: string | null
            weight_value: number | string | null
            weight_metric: string | null
            optional_metric: string | null
            optional_value: string | null
            rpe: number | null
          }> | null
        }>
      | null
  }
  const recentCompletions: DashboardCompletion[] = (
    (recentCompletionRows ?? []) as unknown as RecentCompletionRow[]
  )
    .filter((row) => row.client !== null && !row.client.archived_at)
    .slice(0, 5)
    .map((row) => {
      let setCount = 0
      const exercises: ProfileCompletionExercise[] = (row.exercise_logs ?? [])
        .map((el) => {
          const sets: ProfileCompletionSet[] = (el.set_logs ?? [])
            .map((sl) => {
              setCount += 1
              return {
                set_number: sl.set_number,
                reps: sl.reps_performed,
                rep_metric: sl.rep_metric,
                weight_value:
                  sl.weight_value !== null ? Number(sl.weight_value) : null,
                weight_metric: sl.weight_metric,
                optional_metric: sl.optional_metric,
                optional_value: sl.optional_value,
                rpe: sl.rpe,
              }
            })
            .sort((a, b) => a.set_number - b.set_number)
          return {
            exercise_log_id: el.id,
            program_exercise_id: el.program_exercise_id,
            sort_order: el.program_exercise?.sort_order ?? 0,
            section_title: el.program_exercise?.section_title ?? null,
            superset_group_id: el.program_exercise?.superset_group_id ?? null,
            exercise_name: el.program_exercise?.exercise?.name ?? 'Exercise',
            sets,
          }
        })
        .sort((a, b) => a.sort_order - b.sort_order)
      return {
        id: row.id,
        client_id: row.client!.id,
        client_first_name: row.client!.first_name,
        client_last_name: row.client!.last_name,
        client_tone: categoryToneFor(row.client!.category_id, categoryIds),
        day_label: row.program_day?.day_label ?? 'Ad-hoc',
        scheduled_date: row.program_day?.scheduled_date ?? null,
        completed_at: row.completed_at,
        session_rpe: row.session_rpe,
        set_count: setCount,
        exercises,
      }
    })

  const greeting = `${greetingFor(hourInTimeZone(tz))}, ${profile?.first_name ?? 'there'}.`

  // Factual, quiet sub-line (P2-5): what's on today + who needs follow-up.
  const sessionsClause =
    sessionsToday > 0
      ? `${sessionsToday} ${sessionsToday === 1 ? 'session' : 'sessions'} today`
      : 'No sessions booked today'
  const attentionClause =
    attentionRowCount > 0
      ? `${attentionRowCount} ${attentionRowCount === 1 ? 'item needs' : 'items need'} follow-up`
      : null
  const subLine = attentionClause
    ? `${sessionsClause} · ${attentionClause}.`
    : `${sessionsClause}.`

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{formatDateLong(now, tz)}</div>
          <h1>{greeting}</h1>
          <div className="sub">{subLine}</div>
        </div>
      </div>

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 28,
        }}
      >
        <StatCard
          value={String(sessionsToday)}
          label="Sessions today"
          detail={
            nextSession
              ? `Next: ${nextSession.client?.first_name ?? ''} · ${formatTime(new Date(nextSession.start_at), tz)}`
              : sessionsToday === 0
                ? 'Nothing booked yet'
                : 'All done for today'
          }
          tone="primary"
        />
        <StatCard
          value={String(activeClientCount)}
          label="Active clients"
          detail={
            newThisWeek > 0 ? `${newThisWeek} new this week` : 'Steady state'
          }
        />
        {/* Operator rule 2026-07-03: attention = red (act now), programs
            ending = amber (plan ahead) — swapped from the original mapping. */}
        <StatCard
          value={String(attentionRowCount)}
          label="Need attention"
          detail={
            attentionRowCount === 0 ? 'All clear' : 'See the panel below'
          }
          tone={attentionRowCount > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          value={String(programsEndingCount)}
          label="Programs ending"
          detail={
            programsEndingCount === 0
              ? 'None ending this week'
              : 'Plan the next block'
          }
          tone={programsEndingCount > 0 ? 'warning' : 'neutral'}
        />
      </div>

      {/* Two-column: Needs attention + Today's sessions */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 22,
          marginBottom: 28,
        }}
      >
        {activeClientCount === 0 ? (
          <div className="card" style={{ padding: '22px 26px' }}>
            <div
              style={{
                padding: '28px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                textAlign: 'center',
                color: 'var(--color-muted)',
                fontSize: '.88rem',
              }}
            >
              <UserPlusIcon
                size={28}
                strokeWidth={2}
                color="var(--color-muted)"
                aria-hidden
              />
              <div>No clients yet.</div>
              <Link href="/clients/new" className="btn outline">
                Add your first client
              </Link>
            </div>
          </div>
        ) : (
          <AttentionPanel
            adherence={attention.adherence}
            admin={attention.admin}
          />
        )}
        <TodaysSessionsPanel
          items={todaysAppointments ?? []}
          now={now}
          tz={tz}
        />
      </div>

      <RecentlyCompletedPanel completions={recentCompletions} />
    </div>
  )
}

/* ====================== Stat card ====================== */

function StatCard({
  value,
  label,
  detail,
  tone = 'neutral',
}: {
  value: string
  label: string
  detail?: string
  tone?: 'neutral' | 'primary' | 'warning' | 'danger'
}) {
  const valueColor = {
    neutral: 'var(--color-charcoal)',
    primary: 'var(--color-primary)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-alert)',
  }[tone]
  const dotColor = {
    neutral: 'var(--color-muted)',
    primary: 'var(--color-accent)',
    warning: 'var(--color-warning)',
    danger: 'var(--color-alert)',
  }[tone]
  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: '2.4rem',
          color: valueColor,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: '.82rem',
          color: 'var(--color-text-light)',
          fontWeight: 500,
          marginTop: 6,
        }}
      >
        {label}
      </div>
      {detail && (
        <div
          style={{
            fontSize: '.72rem',
            color: 'var(--color-muted)',
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor,
            }}
          />
          {detail}
        </div>
      )}
    </div>
  )
}

/* ====================== Needs-attention panel ====================== */

// Lower = more urgent. Drives per-client dedup (keep the most urgent reason) and
// the panel sort order. The brief §6.8.2 order (Flag → Overdue → Ending → New)
// extended for the v2 triggers: Ended (training gap live now) sits above Ending
// (≤7 days out); Reconcile (a past session needing attendance/note, item 3)
// below the training-state triggers but above the new-client setup ones; and
// Onboarding (a quiet new-client nudge) is the least urgent.
const PRIORITY = {
  flag: 0,
  overdue: 1,
  ended: 2,
  ending: 3,
  reconcile: 4,
  new: 5,
  onboarding: 6,
} as const

// Which group each tone belongs to (operator decision 2026-06-28). Two distinct
// concerns that don't compete for one row: ADHERENCE (portal / training — is the
// client doing their program?) and CLINICAL ADMIN (bookings / records — is the
// appointment paperwork done?). Deduped separately, so a client can show one row
// in each group.
const DOMAIN: Record<AttentionTone, 'adherence' | 'admin'> = {
  flag: 'admin',
  overdue: 'adherence',
  ended: 'adherence',
  ending: 'adherence',
  reconcile: 'admin',
  new: 'adherence',
  onboarding: 'adherence',
}

// One past appointment that may need reconciling (item 3). Pre-projected in the
// page (practice-tz dates resolved) so buildAttentionList stays tz-agnostic.
type ReconcileAppt = {
  id: string
  clientId: string
  firstName: string
  lastName: string
  status: string
  hasNote: boolean
  dateIso: string
  when: string
}

type FlaggedNote = {
  id: string
  note_type: string | null
  title: string | null
  flag_body_region: string | null
  client: {
    id: string
    first_name: string
    last_name: string
    archived_at: string | null
  } | null
}

type AttentionProgram = {
  status: string
  start_date: string | null
  duration_weeks: number | null
  client_id: string
  client: {
    id: string
    first_name: string
    last_name: string
    archived_at: string | null
  } | null
}

function buildAttentionList({
  flaggedNotes,
  activeClients,
  activePrograms,
  lastCompletedByClient,
  overdueFollowedUpByClient,
  assessedClientIds,
  clientsWithAnyProgram,
  clientsWithDraftProgram,
  upcomingApptClientIds,
  lastApptMsByClient,
  upcomingProgramDayClientIds,
  reconcileAppts,
  toneByClientId,
  nowMs,
  tenDaysAgoMs,
  tenDaysAgoIso,
  sevenDaysAgoMs,
  todayIso,
  todayPlus7Iso,
}: {
  flaggedNotes: FlaggedNote[]
  activeClients: Array<{
    id: string
    first_name: string
    last_name: string
    invited_at: string | null
    onboarded_at: string | null
    created_at: string
  }>
  activePrograms: AttentionProgram[]
  lastCompletedByClient: Map<string, string>
  overdueFollowedUpByClient: Map<string, number>
  assessedClientIds: Set<string>
  clientsWithAnyProgram: Set<string>
  clientsWithDraftProgram: Set<string>
  upcomingApptClientIds: Set<string>
  lastApptMsByClient: Map<string, number>
  upcomingProgramDayClientIds: Set<string>
  reconcileAppts: ReconcileAppt[]
  toneByClientId: Map<string, AvatarTone>
  nowMs: number
  tenDaysAgoMs: number
  tenDaysAgoIso: string
  sevenDaysAgoMs: number
  todayIso: string
  todayPlus7Iso: string
}): { adherence: AttentionItem[]; admin: AttentionItem[] } {
  // Candidates are built without the avatar tone; it is stamped once at the
  // end from toneByClientId, so no push site can drift from the category rule.
  type Candidate = Omit<AttentionItem, 'avatarTone'>
  const candidates: Candidate[] = []

  // Flag (red) — active injury flag / contraindication unreviewed > 14 days.
  for (const n of flaggedNotes) {
    if (!n.client || n.client.archived_at) continue
    const kind =
      n.note_type === 'contraindication' ? 'contraindication' : 'injury flag'
    candidates.push({
      clientId: n.client.id,
      avatar: initialsFor(n.client.first_name, n.client.last_name),
      firstName: n.client.first_name,
      lastName: n.client.last_name,
      tone: 'flag',
      tag: 'Flag',
      reason:
        n.title ??
        (n.flag_body_region
          ? `Active ${kind} — ${n.flag_body_region}`
          : `Active ${kind}`),
      action: { label: 'Review', href: `/clients/${n.client.id}` },
      priority: PRIORITY.flag,
    })
  }

  // Active programs feed Overdue and Ending. The Ended/gap trigger is handled in
  // the client loop below instead — it must also see clients who have no program
  // at all (single-session clients), which this program loop never reaches.
  for (const p of activePrograms) {
    if (!p.client || p.client.archived_at) continue
    const c = p.client

    // A program past its computed end date is stale, not "active in-window":
    // exclude it from Overdue so a never-archived past-due program can't
    // become a permanent attention item (the same inflation P1-3 removed from
    // the stat card, kept out of the panel too). Open-ended programs (no
    // duration) have no end date and stay eligible.
    const endIso = programEndIso(p.start_date, p.duration_weeks)
    const inWindow = endIso === null || endIso >= todayIso

    // Overdue (amber) — no logged session beyond the weekly cadence + grace,
    // for an in-window program. A client who has never logged is measured from
    // start_date + 10 days, so a brand-new program doesn't flag on day one.
    // (Q1: 10 days.)
    // "Program checked & message sent" resets the overdue clock: an
    // acknowledgement inside the overdue cadence suppresses the trigger, so the
    // client re-surfaces only if still silent ~10 days later (Q: reset the
    // clock). Overdue is the one trigger with no natural clear, so this is its
    // manual exit. See OverdueFollowUpButton / acknowledgeOverdueFollowupAction.
    const followedUpMs = overdueFollowedUpByClient.get(p.client_id)
    const recentlyFollowedUp =
      followedUpMs !== undefined && followedUpMs >= tenDaysAgoMs

    const last = lastCompletedByClient.get(p.client_id)
    let overdue = false
    let overdueReason = ''
    if (inWindow && !recentlyFollowedUp && last) {
      if (new Date(last).getTime() < tenDaysAgoMs) {
        overdue = true
        const days = Math.max(
          1,
          Math.round((nowMs - new Date(last).getTime()) / 86_400_000),
        )
        overdueReason = `Last session ${days} days ago`
      }
    } else if (
      inWindow &&
      !recentlyFollowedUp &&
      !last &&
      p.start_date &&
      p.start_date <= tenDaysAgoIso
    ) {
      overdue = true
      overdueReason = 'No sessions logged yet'
    }
    if (overdue) {
      candidates.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'overdue',
        tag: 'Overdue',
        reason: overdueReason,
        // "Open" goes to the program calendar (checking the program is the
        // point); the row name still links to the profile. Lines up with the
        // ack button beside it in the panel.
        action: { label: 'Open', href: `/clients/${c.id}/program` },
        priority: PRIORITY.overdue,
      })
    }

    // Ending (amber) — program ends within 7 days, no successor drafted yet.
    if (
      endIso !== null &&
      endIso >= todayIso &&
      endIso <= todayPlus7Iso &&
      !clientsWithDraftProgram.has(p.client_id)
    ) {
      candidates.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'ending',
        tag: 'Ending',
        reason: `Program ends ${endRelative(endIso, todayIso)} — no new block yet`,
        action: { label: 'Plan', href: `/clients/${c.id}/program` },
        priority: PRIORITY.ending,
      })
    }
  }

  // Per-active-client triggers: Ended/gap, New, Onboarding. Iterating clients
  // (not programs) is what lets the gap detector see single-session clients who
  // have no program row at all. A client can match more than one; the per-client
  // dedupe below keeps the most urgent.
  for (const c of activeClients) {
    // ── Ended / gap (amber) — out of training, two tracks judged separately ──
    // A client trains on a PROGRAM (home/gym day-by-day) and/or via booked
    // APPOINTMENTS (in-clinic). These are different tracks, so an ended program
    // is judged by the program — NOT by the nominal end date, and NOT by whether
    // appointments happen to be booked. (Conflating them was the original bug:
    // a client with a finished block but standing appointments never surfaced.)
    if (clientsWithAnyProgram.has(c.id)) {
      // Program client: gap when no training day is scheduled today or later
      // ("sessions remaining", §2 v2 — true even for an open-ended program with
      // no dates set) and no draft block is queued. The next block is the action,
      // so it fires regardless of any in-clinic appointments they may also have.
      if (
        !upcomingProgramDayClientIds.has(c.id) &&
        !clientsWithDraftProgram.has(c.id)
      ) {
        candidates.push({
          clientId: c.id,
          avatar: initialsFor(c.first_name, c.last_name),
          firstName: c.first_name,
          lastName: c.last_name,
          tone: 'ended',
          tag: 'Ended',
          reason: 'Program ended — no new block',
          action: { label: 'Plan', href: `/clients/${c.id}/program` },
          priority: PRIORITY.ended,
        })
      }
    } else {
      // Single-session client (no program at all): their training IS their
      // bookings, so the gap is "no upcoming appointment". Needs evidence they
      // trained before (a logged session or a past booking) and have lapsed past
      // the ~10-day cadence, so a client who just hasn't rebooked yet isn't
      // nagged, and a brand-new client (New/Onboarding territory) isn't caught.
      const lastCompletedIso = lastCompletedByClient.get(c.id)
      const lastCompletedMs = lastCompletedIso
        ? new Date(lastCompletedIso).getTime()
        : null
      const lastApptMs = lastApptMsByClient.get(c.id) ?? null
      const lastMs =
        lastCompletedMs === null
          ? lastApptMs
          : lastApptMs === null
            ? lastCompletedMs
            : Math.max(lastCompletedMs, lastApptMs)
      if (
        !upcomingApptClientIds.has(c.id) &&
        lastMs !== null &&
        lastMs < tenDaysAgoMs
      ) {
        const days = Math.max(1, Math.round((nowMs - lastMs) / 86_400_000))
        candidates.push({
          clientId: c.id,
          avatar: initialsFor(c.first_name, c.last_name),
          firstName: c.first_name,
          lastName: c.last_name,
          tone: 'ended',
          tag: 'Ended',
          reason: `No sessions booked — last seen ${days} days ago`,
          action: { label: 'Open', href: `/clients/${c.id}` },
          priority: PRIORITY.ended,
        })
      }
    }

    // ── New (green) — initial assessment recorded, but no program yet ──
    // Sourced from the live `initial_assessment` note (assessedClientIds); the
    // dormant `assessments` table never had rows (v2 fix).
    if (assessedClientIds.has(c.id) && !clientsWithAnyProgram.has(c.id)) {
      candidates.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'new',
        tag: 'New',
        reason: 'Assessment complete — no program yet',
        action: { label: 'Build program', href: `/clients/${c.id}/program/new` },
        priority: PRIORITY.new,
      })
    }

    // ── Onboarding funnel (§1 v2) — invited 7+ days ago, no logged session ──
    // "Got going" = a logged portal session ONLY (operator decision 2026-06-28:
    // an in-clinic appointment does NOT count — surface every invited client who
    // hasn't logged so they can be nudged, then dismissed if they're fine).
    // Replaces the old "invited — not onboarded" New reason. Two reason states,
    // not three: there's no queryable last-login, and onboarded_at already
    // implies the client logged in once (accepting the invite sets the
    // password). The "Program checked & message sent" ack (shared with Overdue)
    // snoozes it ~10 days, then it re-surfaces if still stalled — its manual
    // exit, since reaching out leaves no other DB trace.
    const onboardingFollowedUpMs = overdueFollowedUpByClient.get(c.id)
    const onboardingRecentlyFollowedUp =
      onboardingFollowedUpMs !== undefined &&
      onboardingFollowedUpMs >= tenDaysAgoMs
    if (
      c.invited_at &&
      new Date(c.invited_at).getTime() <= sevenDaysAgoMs &&
      !lastCompletedByClient.has(c.id) &&
      !onboardingRecentlyFollowedUp
    ) {
      const days = Math.max(
        1,
        Math.round((nowMs - new Date(c.invited_at).getTime()) / 86_400_000),
      )
      candidates.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'onboarding',
        tag: 'Onboarding',
        reason: c.onboarded_at
          ? 'Onboarded — no sessions logged yet'
          : `Invited ${days} days ago — not accepted`,
        action: { label: 'Open', href: `/clients/${c.id}` },
        priority: PRIORITY.onboarding,
      })
    }
  }

  // Reconciliation (item 3) — ONE row per client, combining attendance-not-set
  // and note-owed (operator decision 2026-06-28: never split into separate
  // rows). >1 session total → the row's Open opens a per-client pop-up listing
  // them all, each labelled with its type; exactly 1 → inline with a direct
  // Open. no_show / completed-with-note are already reconciled (filtered out).
  // reconcileAppts arrive oldest-first, so each client's sessions are too.
  type ReconcileGroup = {
    clientId: string
    firstName: string
    lastName: string
    sessions: {
      id: string
      when: string
      dateIso: string
      typeLabel: string
    }[]
  }
  const reconcileGroups = new Map<string, ReconcileGroup>()
  for (const a of reconcileAppts) {
    let typeLabel: string | null = null
    if (a.status === 'pending' || a.status === 'confirmed')
      typeLabel = 'attendance not set'
    else if (a.status === 'completed' && !a.hasNote) typeLabel = 'note owed'
    if (!typeLabel) continue
    let g = reconcileGroups.get(a.clientId)
    if (!g) {
      g = {
        clientId: a.clientId,
        firstName: a.firstName,
        lastName: a.lastName,
        sessions: [],
      }
      reconcileGroups.set(a.clientId, g)
    }
    g.sessions.push({ id: a.id, when: a.when, dateIso: a.dateIso, typeLabel })
  }
  const reconcileItems: Candidate[] = [...reconcileGroups.values()]
    .sort((a, b) => a.sessions[0]!.dateIso.localeCompare(b.sessions[0]!.dateIso))
    .map((g) => {
      const oldest = g.sessions[0]!
      const n = g.sessions.length
      return {
        clientId: g.clientId,
        avatar: initialsFor(g.firstName, g.lastName),
        firstName: g.firstName,
        lastName: g.lastName,
        tone: 'reconcile' as const,
        tag: 'Reconcile',
        // Single → show the session inline; multiple → a count, the Open opens
        // the per-client pop-up listing every attendance + note session.
        reason:
          n === 1
            ? `${oldest.when} — ${oldest.typeLabel}`
            : `${n} sessions to reconcile`,
        action: {
          label: 'Open',
          href: `/schedule?d=${oldest.dateIso}&focus=${oldest.id}`,
        },
        priority: PRIORITY.reconcile,
        sessions: g.sessions,
      }
    })

  // Dedupe per (client × domain). Only Flag + the adherence tones live in
  // `candidates`; reconcile rows are already grouped per (client × type) above
  // and append to the admin group as-is, so a client can show an attendance row
  // AND a note row alongside any flag.
  const byKey = new Map<string, Candidate>()
  for (const it of candidates) {
    const key = `${it.clientId}:${DOMAIN[it.tone]}`
    const existing = byKey.get(key)
    if (!existing || it.priority < existing.priority) {
      byKey.set(key, it)
    }
  }
  const deduped = [...byKey.values()]
  const byPriority = (a: Candidate, b: Candidate) => a.priority - b.priority
  const withTone = (it: Candidate): AttentionItem => ({
    ...it,
    avatarTone: toneByClientId.get(it.clientId) ?? 'n',
  })
  return {
    adherence: deduped
      .filter((it) => DOMAIN[it.tone] === 'adherence')
      .sort(byPriority)
      .map(withTone),
    admin: [
      ...deduped.filter((it) => DOMAIN[it.tone] === 'admin'),
      ...reconcileItems,
    ]
      .sort(byPriority)
      .map(withTone),
  }
}

/* ====================== Today's sessions panel ====================== */

function TodaysSessionsPanel({
  items,
  now,
  tz,
}: {
  items: Array<{
    id: string
    start_at: string
    end_at: string
    appointment_type: string
    status: string
    client: { id: string; first_name: string; last_name: string } | null
  }>
  now: Date
  tz: string
}) {
  return (
    <div className="card" style={{ padding: '22px 26px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <div className="eyebrow" style={{ margin: 0 }}>
          Today&rsquo;s sessions
        </div>
        <Link href="/schedule" className="btn primary">
          <CalendarIcon size={14} aria-hidden />
          Schedule
        </Link>
      </div>
      {items.length === 0 ? (
        <div
          style={{
            padding: '28px 0',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.88rem',
          }}
        >
          No sessions booked for today.
        </div>
      ) : (
        items
          .filter((i) => i.client !== null)
          .map((s) => {
            const start = new Date(s.start_at)
            const end = new Date(s.end_at)
            const isCancelled = s.status === 'cancelled'
            // A cancelled slot isn't happening, so it carries no live state —
            // the "Cancelled" pill + struck-through name say everything.
            const isLive =
              !isCancelled &&
              start.getTime() <= now.getTime() &&
              end.getTime() >= now.getTime()
            const isPast = !isCancelled && end.getTime() < now.getTime()
            // Live cue (Q2): "now" while in progress, "done" once past; the
            // booking status (confirmed/pending) is the right-side pill.
            const liveLabel = isCancelled
              ? null
              : isLive
                ? 'Now'
                : isPast
                  ? 'Done'
                  : 'Upcoming'
            const booking = bookingStatus(s.status)
            return (
              <Link
                key={s.id}
                href={`/clients/${s.client!.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '72px 1fr auto',
                  alignItems: 'center',
                  padding: '14px 0',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  gap: 16,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '1.05rem',
                    color: isCancelled
                      ? 'var(--color-muted)'
                      : isLive
                        ? 'var(--color-accent)'
                        : isPast
                          ? 'var(--color-muted)'
                          : 'var(--color-charcoal)',
                  }}
                >
                  {formatTime(start, tz)}
                </div>
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      ...(isCancelled
                        ? {
                            textDecoration: 'line-through',
                            color: 'var(--color-muted)',
                          }
                        : null),
                    }}
                  >
                    {s.client!.first_name} {s.client!.last_name}
                  </div>
                  <div
                    style={{
                      fontSize: '.78rem',
                      color: 'var(--color-text-light)',
                    }}
                  >
                    {s.appointment_type}
                    {liveLabel && (
                      <span
                        style={{
                          color: isLive
                            ? 'var(--color-accent)'
                            : 'var(--color-muted)',
                        }}
                      >
                        {' '}
                        · {liveLabel}
                      </span>
                    )}
                  </div>
                </div>
                {booking ? (
                  <span className={`tag ${booking.cls}`}>{booking.label}</span>
                ) : (
                  <span />
                )}
              </Link>
            )
          })
      )}
    </div>
  )
}

/** Map the appointment status to a tag (brief §6.8.3 confirmed/pending). */
function bookingStatus(
  status: string,
): { label: string; cls: string } | null {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', cls: 'active' }
    case 'pending':
      return { label: 'Pending', cls: 'overdue' }
    case 'no_show':
      return { label: 'No show', cls: 'flag' }
    case 'completed':
      return { label: 'Completed', cls: 'ending' }
    case 'cancelled':
      return { label: 'Cancelled', cls: 'cancelled' }
    default:
      return null
  }
}

/* ====================== Helpers ====================== */

/** End date (ISO) of a program = start_date + duration_weeks × 7 days. */
function programEndIso(
  startDate: string | null,
  durationWeeks: number | null,
): string | null {
  if (!startDate || !durationWeeks) return null
  return addDaysToIsoDate(startDate, durationWeeks * 7)
}

/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
function daysBetweenIso(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) /
      86_400_000,
  )
}

/** "today" / "tomorrow" / "in N days" for a near-future ISO date. */
function endRelative(endIso: string, todayIso: string): string {
  if (endIso === todayIso) return 'today'
  const days = daysBetweenIso(todayIso, endIso)
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatDateLong(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(d)
}

function formatTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(d)
}

/** "Mon 23 Jun · 2:00pm" in the practice tz — a reconcile session's when (date +
 * time, so multiple same-day sessions are distinguishable in the dropdown). */
function formatDateTimeShort(d: Date, timeZone: string): string {
  const date = new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(d)
  const time = new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(d)
  return `${date} · ${time}`
}

/** Practice-tz calendar date (YYYY-MM-DD) of an instant — for the ?d= deep link. */
function isoDateInTimeZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

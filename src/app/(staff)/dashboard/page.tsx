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
  initialsFor,
  type AvatarTone,
} from '../clients/_lib/client-helpers'
import {
  RecentlyCompletedPanel,
  type DashboardCompletion,
} from './_components/RecentlyCompletedPanel'
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
  const todayPlus7Iso = addDaysToIsoDate(todayIso, 7)

  // Parallel fetches.
  const [
    { data: activeClients },
    { data: newClients },
    { data: todaysAppointments },
    { data: recentCompletionRows },
    { data: allProgramRows },
    { data: flaggedNotes },
    { data: lastCompletedRows },
    { data: completedAssessmentRows },
  ] = await Promise.all([
    supabase
      .from('clients')
      .select('id, first_name, last_name, invited_at, onboarded_at, created_at')
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
      .neq('status', 'cancelled')
      .order('start_at'),
    // 5 most recent completed sessions across this EP's clients (RLS scopes
    // to own org). Fetch 8 then drop archived-client / null rows and slice
    // to 5 (P2-2), so an archived client's session can't crowd the list.
    // Same embed shape as the profile completions loader plus client identity.
    supabase
      .from('sessions')
      .select(
        `id, completed_at, session_rpe,
         client:clients(id, first_name, last_name, archived_at),
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
    // Clients with a completed assessment, for the New trigger.
    supabase
      .from('assessments')
      .select('client_id')
      .eq('status', 'completed')
      .is('deleted_at', null),
  ])

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

  const completedAssessmentIds = new Set(
    ((completedAssessmentRows ?? []) as Array<{ client_id: string }>).map(
      (a) => a.client_id,
    ),
  )
  const clientsWithAnyProgram = new Set(allPrograms.map((p) => p.client_id))
  const clientsWithDraftProgram = new Set(
    allPrograms.filter((p) => p.status === 'draft').map((p) => p.client_id),
  )

  // ── Stats ──────────────────────────────────────────────────────────────
  const sessionsToday = todaysAppointments?.length ?? 0
  const nextSession = todaysAppointments?.find(
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
    completedAssessmentIds,
    clientsWithAnyProgram,
    clientsWithDraftProgram,
    nowMs: now.getTime(),
    tenDaysAgoMs: tenDaysAgo.getTime(),
    tenDaysAgoIso,
    todayIso,
    todayPlus7Iso,
  })

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
    attention.length > 0
      ? `${attention.length} ${attention.length === 1 ? 'client needs' : 'clients need'} follow-up`
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
        <StatCard
          value={String(attention.length)}
          label="Need attention"
          detail={
            attention.length === 0 ? 'All clear' : 'See the panel below'
          }
          tone={attention.length > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          value={String(programsEndingCount)}
          label="Programs ending"
          detail={
            programsEndingCount === 0
              ? 'None ending this week'
              : 'Plan the next block'
          }
          tone={programsEndingCount > 0 ? 'danger' : 'neutral'}
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
          <AttentionPanel items={attention} />
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

type AttentionTone = 'flag' | 'overdue' | 'ending' | 'new'

type AttentionItem = {
  clientId: string
  avatar: string
  firstName: string
  lastName: string
  tone: AttentionTone
  tag: string
  reason: string
  action: { label: string; href: string }
  // Lower = more urgent. Drives dedupe (keep the most urgent per client) +
  // the panel sort order. Brief §6.8.2 lists: Flag, Overdue, Ending, New.
  priority: number
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
  completedAssessmentIds,
  clientsWithAnyProgram,
  clientsWithDraftProgram,
  nowMs,
  tenDaysAgoMs,
  tenDaysAgoIso,
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
  completedAssessmentIds: Set<string>
  clientsWithAnyProgram: Set<string>
  clientsWithDraftProgram: Set<string>
  nowMs: number
  tenDaysAgoMs: number
  tenDaysAgoIso: string
  todayIso: string
  todayPlus7Iso: string
}): AttentionItem[] {
  const candidates: AttentionItem[] = []

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
      priority: 0,
    })
  }

  // Active programs feed both Overdue and Ending.
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
    const last = lastCompletedByClient.get(p.client_id)
    let overdue = false
    let overdueReason = ''
    if (inWindow && last) {
      if (new Date(last).getTime() < tenDaysAgoMs) {
        overdue = true
        const days = Math.max(
          1,
          Math.round((nowMs - new Date(last).getTime()) / 86_400_000),
        )
        overdueReason = `Last session ${days} days ago`
      }
    } else if (inWindow && !last && p.start_date && p.start_date <= tenDaysAgoIso) {
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
        action: { label: 'Open', href: `/clients/${c.id}` },
        priority: 1,
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
        priority: 2,
      })
    }
  }

  // New (green) — needs first program, or invited but not yet onboarded.
  for (const c of activeClients) {
    if (completedAssessmentIds.has(c.id) && !clientsWithAnyProgram.has(c.id)) {
      candidates.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'new',
        tag: 'New',
        reason: 'Assessment complete — no program yet',
        action: { label: 'Build program', href: `/clients/${c.id}/program/new` },
        priority: 3,
      })
    } else if (c.invited_at && !c.onboarded_at) {
      candidates.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'new',
        tag: 'New',
        reason: 'Invited — not yet onboarded',
        action: { label: 'Open', href: `/clients/${c.id}` },
        priority: 3,
      })
    }
  }

  // One row per client — keep the most urgent reason — then sort by urgency.
  const byClient = new Map<string, AttentionItem>()
  for (const it of candidates) {
    const existing = byClient.get(it.clientId)
    if (!existing || it.priority < existing.priority) {
      byClient.set(it.clientId, it)
    }
  }
  return [...byClient.values()].sort((a, b) => a.priority - b.priority)
}

const ATTENTION_VISIBLE = 6

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const visible = items.slice(0, ATTENTION_VISIBLE)
  const overflow = items.length - visible.length
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
          Needs attention
        </div>
        <Link
          href="/clients"
          style={{
            fontSize: '.78rem',
            color: 'var(--color-primary)',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          View all →
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
          Nothing flagged.
        </div>
      ) : (
        <>
          {visible.map((it) => {
            const variant: AvatarTone =
              it.tone === 'flag' ? 'r' : it.tone === 'new' ? 'n' : 'a'
            return (
              <div
                key={`${it.clientId}-${it.tag}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 0',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <span
                  className={`avatar ${variant}`}
                  style={{ width: 40, height: 40, fontSize: 40 * 0.38 }}
                >
                  {it.avatar}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Link
                      href={`/clients/${it.clientId}`}
                      style={{
                        fontWeight: 600,
                        color: 'var(--color-charcoal)',
                        textDecoration: 'none',
                      }}
                    >
                      {it.firstName} {it.lastName}
                    </Link>
                    <span className={`tag ${it.tone}`}>{it.tag}</span>
                  </div>
                  <div
                    style={{
                      fontSize: '.78rem',
                      color: 'var(--color-text-light)',
                      marginTop: 2,
                    }}
                  >
                    {it.reason}
                  </div>
                </div>
                <Link href={it.action.href} className="btn outline">
                  {it.action.label}
                </Link>
              </div>
            )
          })}
          {overflow > 0 && (
            <Link
              href="/clients"
              style={{
                display: 'block',
                padding: '12px 0 2px',
                fontSize: '.78rem',
                color: 'var(--color-primary)',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              +{overflow} more →
            </Link>
          )}
        </>
      )}
    </div>
  )
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
            const isLive =
              start.getTime() <= now.getTime() &&
              end.getTime() >= now.getTime()
            const isPast = end.getTime() < now.getTime()
            // Live cue (Q2): "now" while in progress, "done" once past; the
            // booking status (confirmed/pending) is the right-side pill.
            const liveLabel = isLive ? 'Now' : isPast ? 'Done' : 'Upcoming'
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
                    color: isLive
                      ? 'var(--color-accent)'
                      : isPast
                        ? 'var(--color-muted)'
                        : 'var(--color-charcoal)',
                  }}
                >
                  {formatTime(start, tz)}
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {s.client!.first_name} {s.client!.last_name}
                  </div>
                  <div
                    style={{
                      fontSize: '.78rem',
                      color: 'var(--color-text-light)',
                    }}
                  >
                    {s.appointment_type}
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

/** "today" / "tomorrow" / "in N days" for a near-future ISO date. */
function endRelative(endIso: string, todayIso: string): string {
  if (endIso === todayIso) return 'today'
  const days = Math.round(
    (Date.parse(`${endIso}T00:00:00Z`) -
      Date.parse(`${todayIso}T00:00:00Z`)) /
      86_400_000,
  )
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

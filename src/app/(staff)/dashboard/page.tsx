import Link from 'next/link'
import { Calendar as CalendarIcon, UserPlus as UserPlusIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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
 * and a Recent activity feed. All computed from live data; everything
 * empty-states cleanly.
 */
export default async function DashboardPage() {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Current user's first name for the greeting.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .maybeSingle()

  // Org timezone — future-proofs the "today" window when/if we add
  // multi-timezone orgs. For v1 we use server local time.
  await supabase
    .from('organizations')
    .select('timezone')
    .eq('id', organizationId)
    .maybeSingle()

  const now = new Date()
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  )
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

  // Parallel fetches.
  //
  // Phase L (2026-05-14) — the old activity feed pulled `recentAppointments`
  // and `recentNotes` and mixed them into a single timeline. Per Q-L9
  // sign-off the dashboard's bottom panel was reframed as "recent activity
  // from the client portal" — i.e. completed training sessions only.
  // Notes/appointments mix retired. Flagged notes still loaded below for
  // the AttentionPanel; that surface is untouched.
  const [
    { data: activeClients },
    { data: newClients },
    { data: todaysAppointments },
    { data: recentCompletionRows },
    { data: activePrograms },
    { data: flaggedNotes },
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
    // Phase L — 5 most recent completed sessions across all of this EP's
    // clients (RLS scopes to own org). Same embed shape as the profile
    // page's completions loader plus client identity. Fan-out is ≤ 5×~5×
    // ~5 rows pre-launch; promote to a SECURITY DEFINER RPC if telemetry
    // later says otherwise (Q-L8 watch-list item).
    supabase
      .from('sessions')
      .select(
        `id, completed_at, session_rpe,
         client:clients(id, first_name, last_name),
         program_day:program_days(day_label, scheduled_date),
         exercise_logs(
           id, program_exercise_id,
           program_exercise:program_exercises(
             sort_order, section_title, superset_group_id,
             exercise:exercises(name)
           ),
           set_logs(
             set_number, reps_performed, weight_value, weight_metric,
             optional_metric, optional_value, rpe
           )
         )`,
      )
      .not('completed_at', 'is', null)
      .is('deleted_at', null)
      .order('completed_at', { ascending: false })
      .limit(5),
    supabase
      .from('programs')
      .select(
        `id, name, duration_weeks, start_date,
         client:clients(id, first_name, last_name)`,
      )
      .eq('status', 'active')
      .is('deleted_at', null),
    // CN-4 (brief §6.8.2): active flags not reviewed within 14 days.
    // Previously required is_pinned (an unpinned flag could never reach
    // the panel) and ignored review age entirely. "Mark reviewed" on the
    // client profile clears a flag from here for the next 14 days;
    // resolving clears it for good.
    supabase
      .from('clinical_notes')
      .select(
        `id, note_type, title, flag_body_region, flag_reviewed_at,
         flag_resolved_at,
         client:clients(id, first_name, last_name)`,
      )
      .in('note_type', ['injury_flag', 'contraindication'])
      .is('deleted_at', null)
      .is('flag_resolved_at', null)
      .or(
        `flag_reviewed_at.is.null,flag_reviewed_at.lt.${fourteenDaysAgo.toISOString()}`,
      )
      .limit(10),
  ])

  // Stat: sessions today, excluding cancelled.
  const sessionsToday = todaysAppointments?.length ?? 0
  const nextSession = todaysAppointments?.find(
    (a) => new Date(a.start_at).getTime() >= now.getTime(),
  )
  const activeClientCount = activeClients?.length ?? 0
  const newThisWeek =
    (newClients ?? []).filter(
      (c) =>
        Date.now() - new Date(c.created_at).getTime() <=
        7 * 24 * 60 * 60 * 1000,
    ).length

  // Needs-attention aggregation.
  const attention = buildAttentionList({
    flaggedNotes: flaggedNotes ?? [],
    activeClients: activeClients ?? [],
  })

  // Programs ending: active programs where we've reached the final week.
  const programsEnding = (activePrograms ?? []).filter((p) => {
    if (!p.start_date || !p.duration_weeks) return false
    const start = new Date(p.start_date)
    const weeksIn = Math.floor(
      (Date.now() - start.getTime()) / (7 * 24 * 60 * 60 * 1000),
    )
    return weeksIn + 1 >= p.duration_weeks
  })

  // Phase L — project the recent-completions rows into the dashboard
  // panel shape. Same single-pass shape as the profile loader: walk
  // exercise_logs once for set_count + the per-exercise/per-set detail.
  // Rows with `client === null` are dropped (shouldn't happen for active
  // completed sessions, but defensive against soft-deleted edges).
  type RecentCompletionRow = {
    id: string
    completed_at: string
    session_rpe: number | null
    client: { id: string; first_name: string; last_name: string } | null
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
    .filter((row) => row.client !== null)
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

  const greeting = `${greetingFor(now)}, ${profile?.first_name ?? 'there'}.`

  const attentionText =
    attention.length === 0
      ? ''
      : `${attention.length} ${attention.length === 1 ? 'client needs' : 'clients need'} attention.`
  const subLine =
    sessionsToday === 0
      ? attentionText || "You're clear. Take a breath."
      : `${sessionsToday} ${
          sessionsToday === 1 ? 'session' : 'sessions'
        } today${attentionText ? `, ${attentionText.toLowerCase()}` : '.'}`

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{formatDateLong(now)}</div>
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
              ? `Next: ${nextSession.client?.first_name ?? ''} · ${formatTime(new Date(nextSession.start_at))}`
              : sessionsToday === 0
                ? 'Nothing booked yet'
                : "All done for today"
          }
          tone="primary"
        />
        <StatCard
          value={String(activeClientCount)}
          label="Active clients"
          detail={
            newThisWeek > 0
              ? `${newThisWeek} new this week`
              : 'Steady state'
          }
        />
        <StatCard
          value={String(attention.length)}
          label="Need attention"
          detail={
            attention.length === 0
              ? 'All tracking healthy'
              : 'Scroll down for details'
          }
          tone={attention.length > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          value={String(programsEnding.length)}
          label="Programs ending"
          detail={
            programsEnding.length === 0
              ? 'None ending this week'
              : 'Need new training blocks'
          }
          tone={programsEnding.length > 0 ? 'danger' : 'neutral'}
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

type AttentionItem = {
  clientId: string
  avatar: string
  firstName: string
  lastName: string
  tone: 'flag' | 'new' | 'overdue'
  tag: string
  reason: string
  action: { label: string; href: string }
}

function buildAttentionList({
  flaggedNotes,
  activeClients,
}: {
  flaggedNotes: Array<{
    id: string
    note_type: string | null
    title: string | null
    flag_body_region: string | null
    client: { id: string; first_name: string; last_name: string } | null
  }>
  activeClients: Array<{
    id: string
    first_name: string
    last_name: string
    invited_at: string | null
    onboarded_at: string | null
    created_at: string
  }>
}): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const n of flaggedNotes) {
    if (!n.client) continue
    const kind =
      n.note_type === 'contraindication' ? 'contraindication' : 'injury flag'
    items.push({
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
    })
  }

  // Invited but not onboarded — first session unscheduled.
  for (const c of activeClients) {
    if (c.invited_at && !c.onboarded_at) {
      items.push({
        clientId: c.id,
        avatar: initialsFor(c.first_name, c.last_name),
        firstName: c.first_name,
        lastName: c.last_name,
        tone: 'new',
        tag: 'New',
        reason: 'Invited — not yet onboarded',
        action: { label: 'Schedule', href: `/clients/${c.id}` },
      })
    }
  }

  return items.slice(0, 6)
}

function AttentionPanel({ items }: { items: AttentionItem[] }) {
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
          Nothing flagged. Nice.
        </div>
      ) : (
        items.map((it) => {
          const variant: AvatarTone =
            it.tone === 'flag' ? 'r' : it.tone === 'new' ? 'n' : 'a'
          return (
            <div
              key={`${it.clientId}-${it.tag}-${it.reason}`}
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
                  <span
                    className={`tag ${
                      it.tone === 'flag'
                        ? 'flag'
                        : it.tone === 'new'
                          ? 'new'
                          : 'overdue'
                    }`}
                  >
                    {it.tag}
                  </span>
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
        })
      )}
    </div>
  )
}

/* ====================== Today's sessions panel ====================== */

function TodaysSessionsPanel({
  items,
  now,
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
            const statusTag = isLive ? 'Now' : isPast ? 'Done' : 'Upcoming'
            const statusKind = isLive ? 'new' : isPast ? 'active' : 'overdue'
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
                      ? 'var(--color-primary)'
                      : 'var(--color-charcoal)',
                  }}
                >
                  {formatTime(start)}
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
                  </div>
                </div>
                <span className={`tag ${statusKind}`}>{statusTag}</span>
              </Link>
            )
          })
      )}
    </div>
  )
}

/* ====================== Helpers ====================== */

function greetingFor(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatDateLong(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(d)
}

function formatTime(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}


import Link from 'next/link'
import { Calendar as CalendarIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  initialsFor,
  type AvatarTone,
} from '../clients/_lib/client-helpers'
import {
  ActivityFeed,
  type ActivityItem,
} from './_components/ActivityFeed'

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
  const [
    { data: activeClients },
    { data: newClients },
    { data: todaysAppointments },
    { data: recentAppointments },
    { data: recentNotes },
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
    supabase
      .from('appointments')
      .select(
        `id, start_at, appointment_type, status,
         client:clients(id, first_name, last_name)`,
      )
      .gte('start_at', fourteenDaysAgo.toISOString())
      .is('deleted_at', null)
      .order('start_at', { ascending: false })
      .limit(12),
    supabase
      .from('clinical_notes')
      .select(
        `id, note_date, note_type, title, subjective, body_rich,
         flag_body_region, is_pinned, created_at,
         client:clients(id, first_name, last_name)`,
      )
      .is('deleted_at', null)
      .order('note_date', { ascending: false })
      .limit(12),
    supabase
      .from('programs')
      .select(
        `id, name, duration_weeks, start_date,
         client:clients(id, first_name, last_name)`,
      )
      .eq('status', 'active')
      .is('deleted_at', null),
    supabase
      .from('clinical_notes')
      .select(
        `id, note_type, title, flag_body_region, flag_resolved_at,
         client:clients(id, first_name, last_name)`,
      )
      .eq('is_pinned', true)
      .in('note_type', ['injury_flag', 'contraindication'])
      .is('deleted_at', null)
      .is('flag_resolved_at', null)
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

  // Activity feed: mix recent notes + recent appointments, sort by time.
  const activityItems: ActivityItem[] = [
    ...(recentNotes ?? [])
      .filter((n) => n.client !== null)
      .map(
        (n): ActivityItem => ({
          id: `note-${n.id}`,
          bucket: isFlagNote(n.note_type) ? 'flag' : 'note',
          timestamp: n.created_at ?? n.note_date,
          client_id: n.client!.id,
          client_first_name: n.client!.first_name,
          client_last_name: n.client!.last_name,
          title: titleFromNote(n),
          meta: metaFromNote(n),
          excerpt: excerptFromNote(n),
        }),
      ),
    ...(recentAppointments ?? [])
      .filter((a) => a.client !== null)
      .map(
        (a): ActivityItem => ({
          id: `appt-${a.id}`,
          bucket: 'appointment',
          timestamp: a.start_at,
          client_id: a.client!.id,
          client_first_name: a.client!.first_name,
          client_last_name: a.client!.last_name,
          title: `${a.appointment_type} · ${a.status}`,
          meta: formatDayTime(new Date(a.start_at)),
          excerpt: null,
        }),
      ),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 20)

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
              : 'Need new mesocycles'
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
        <AttentionPanel items={attention} />
        <TodaysSessionsPanel
          items={todaysAppointments ?? []}
          now={now}
        />
      </div>

      <ActivityFeed items={activityItems} />
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
          ? `Active injury flag — ${n.flag_body_region}`
          : 'Active injury flag'),
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

function isFlagNote(t: string | null | undefined): boolean {
  return t === 'injury_flag' || t === 'contraindication'
}

function titleFromNote(n: {
  title: string | null
  note_type: string
  flag_body_region: string | null
}): string {
  if (n.title) return n.title
  if (n.note_type === 'injury_flag') return 'Injury flag raised'
  if (n.note_type === 'contraindication') return 'Contraindication flagged'
  if (n.note_type === 'progress_note') return 'Progress note added'
  if (n.note_type === 'initial_assessment') return 'Initial assessment'
  if (n.note_type === 'discharge') return 'Discharge note'
  return 'Note added'
}

function metaFromNote(n: {
  note_type: string
  flag_body_region: string | null
  note_date: string
}): string {
  const bits: string[] = [prettifyNoteType(n.note_type)]
  if (n.flag_body_region) bits.push(n.flag_body_region)
  return bits.join(' · ')
}

function excerptFromNote(n: {
  subjective: string | null
  body_rich: string | null
}): string | null {
  const body = (n.body_rich ?? n.subjective ?? '').trim()
  if (!body) return null
  return body.length > 240 ? body.slice(0, 240) + '…' : body
}

function prettifyNoteType(t: string): string {
  return t
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}

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

function formatDayTime(d: Date): string {
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}


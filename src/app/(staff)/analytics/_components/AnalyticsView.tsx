'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'

export type AnalyticsAppointment = {
  id: string
  start_at: string
  end_at: string
  appointment_type: string
  status: string
}

export type AnalyticsClient = {
  id: string
  category_name: string | null
  archived_at: string | null
  created_at: string
}

interface AnalyticsViewProps {
  appointments: AnalyticsAppointment[]
  clients: AnalyticsClient[]
}

type Tab = 'overview' | 'clients' | 'sessions' | 'revenue' | 'clinical'
type Range = '7d' | '30d' | '12m'

export function AnalyticsView({
  appointments,
  clients,
}: AnalyticsViewProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState<Range>('30d')

  const rangeStart = useMemo(() => rangeStartFor(range), [range])
  const rangedAppts = useMemo(
    () =>
      appointments.filter(
        (a) => new Date(a.start_at).getTime() >= rangeStart.getTime(),
      ),
    [appointments, rangeStart],
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            Practice insights · last {rangeLabel(range)}
          </div>
          <h1>Analytics</h1>
          <div className="sub">
            Volume, retention, revenue and clinical outcomes
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              gap: 2,
              background: '#F5F0EA',
              padding: 2,
              borderRadius: 7,
            }}
          >
            {(['7d', '30d', '12m'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  background: range === r ? '#fff' : 'transparent',
                  boxShadow:
                    range === r ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
                  borderRadius: 5,
                  fontSize: '.78rem',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  color:
                    range === r
                      ? 'var(--color-primary)'
                      : 'var(--color-text-light)',
                  cursor: 'pointer',
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <button type="button" className="btn outline" disabled>
            <Download size={14} aria-hidden />
            Export
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--color-border-subtle)',
          margin: '0 0 24px',
          overflowX: 'auto',
        }}
      >
        {(
          [
            ['overview', 'Overview'],
            ['clients', 'Clients'],
            ['sessions', 'Sessions'],
            ['revenue', 'Revenue'],
            ['clinical', 'Clinical'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${
                tab === k ? 'var(--color-primary)' : 'transparent'
              }`,
              marginBottom: -1,
              color:
                tab === k
                  ? 'var(--color-primary)'
                  : 'var(--color-text-light)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: '.86rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          appointments={appointments}
          rangedAppts={rangedAppts}
          range={range}
          clients={clients}
        />
      )}
      {tab === 'clients' && <ClientsTab clients={clients} />}
      {tab === 'sessions' && <SessionsTab appointments={rangedAppts} />}
      {tab === 'revenue' && <PendingModuleCard kind="revenue" />}
      {tab === 'clinical' && <PendingModuleCard kind="clinical" />}
    </div>
  )
}

/* ====================== Overview tab ====================== */

function OverviewTab({
  appointments,
  rangedAppts,
  range,
  clients,
}: {
  appointments: AnalyticsAppointment[]
  rangedAppts: AnalyticsAppointment[]
  range: Range
  clients: AnalyticsClient[]
}) {
  // Completed + confirmed + pending count toward volume. Cancelled and
  // no_show excluded — they didn't happen.
  const volumeAppts = rangedAppts.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'no_show',
  )

  const sessionsCount = volumeAppts.length
  const activeClients = clients.filter((c) => !c.archived_at).length

  // Per-week counts for the bar chart. 12 weeks if range=12m, else 4 for 30d, 1 for 7d.
  const weeks = range === '7d' ? 1 : range === '30d' ? 4 : 12
  const weeksData = weeklyCounts(volumeAppts, weeks)

  // Session type mix — top 5 by count.
  const typeMix = Object.entries(
    volumeAppts.reduce<Record<string, number>>((acc, a) => {
      acc[a.appointment_type] = (acc[a.appointment_type] ?? 0) + 1
      return acc
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  const typeMixMax = typeMix.length > 0 ? typeMix[0][1] : 1

  // Sparkline data: daily counts for the last 14 days.
  const last14Dates = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (13 - i))
    return d
  })
  const dailyCounts = last14Dates.map(
    (d) =>
      volumeAppts.filter((a) => sameDay(new Date(a.start_at), d)).length,
  )

  // Avg session length in minutes.
  const avgDuration =
    volumeAppts.length === 0
      ? 0
      : Math.round(
          volumeAppts.reduce(
            (s, a) =>
              s +
              (new Date(a.end_at).getTime() -
                new Date(a.start_at).getTime()) /
                (1000 * 60),
            0,
          ) / volumeAppts.length,
        )

  // Cancellation rate.
  const cancelRate =
    rangedAppts.length === 0
      ? 0
      : Math.round(
          (rangedAppts.filter((a) => a.status === 'cancelled').length * 100) /
            rangedAppts.length,
        )

  // Totals — compare current window to previous window for the delta pill.
  const prevStart = new Date(
    rangeStartFor(range).getTime() -
      (Date.now() - rangeStartFor(range).getTime()),
  )
  const previousCount = appointments.filter((a) => {
    const t = new Date(a.start_at).getTime()
    return (
      t >= prevStart.getTime() && t < rangeStartFor(range).getTime() &&
      a.status !== 'cancelled' &&
      a.status !== 'no_show'
    )
  }).length
  const delta = sessionsCount - previousCount

  return (
    <>
      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <StatCard
          value={String(sessionsCount)}
          label={`Sessions · ${rangeLabel(range)}`}
          detail={
            delta === 0
              ? 'No change vs prior window'
              : `${delta > 0 ? '+' : ''}${delta} vs prior window`
          }
          tone="primary"
        />
        <StatCard
          value={String(activeClients)}
          label="Active clients"
          detail="Not archived"
        />
        <StatCard
          value="—"
          label="Revenue"
          detail="Billing module pending"
          tone="muted"
        />
        <StatCard
          value={avgDuration === 0 ? '—' : `${avgDuration} min`}
          label="Avg session length"
          detail={
            avgDuration === 0
              ? 'No sessions yet'
              : avgDuration >= 55 && avgDuration <= 65
                ? 'Target band 55–65'
                : 'Off target'
          }
        />
      </div>

      {/* Two-col: bar chart + type mix */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 14,
          marginBottom: 14,
        }}
      >
        <div className="card" style={{ padding: 22 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 14,
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '1rem',
                }}
              >
                Sessions per week
              </div>
              <div style={{ fontSize: '.74rem', color: 'var(--color-text-light)' }}>
                {weeks === 1 ? 'This week' : `Last ${weeks} weeks`}
              </div>
            </div>
          </div>
          {weeksData.every((w) => w === 0) ? (
            <ChartEmpty message="No sessions yet in this window." />
          ) : (
            <WeeklyBarChart data={weeksData} />
          )}
        </div>

        <div className="card" style={{ padding: 22 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1rem',
              marginBottom: 4,
            }}
          >
            Session type mix
          </div>
          <div
            style={{
              fontSize: '.74rem',
              color: 'var(--color-text-light)',
              marginBottom: 16,
            }}
          >
            {rangeLabel(range)} breakdown
          </div>
          {typeMix.length === 0 ? (
            <ChartEmpty message="No sessions booked yet." />
          ) : (
            typeMix.map(([label, v], i) => (
              <HBar
                key={label}
                label={label}
                value={v}
                max={typeMixMax}
                colour={typeColours[i % typeColours.length]}
              />
            ))
          )}
        </div>
      </div>

      {/* Sparkline strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
        }}
      >
        <SparkCard
          title="Daily session count"
          big={String(dailyCounts[dailyCounts.length - 1] ?? 0)}
          sub="today · last 14 days trend"
          data={dailyCounts}
          colour="var(--color-primary)"
        />
        <SparkCard
          title="Avg session length"
          big={avgDuration === 0 ? '—' : `${avgDuration} min`}
          sub="across the current window"
          data={
            dailyCounts.map(() => Math.max(1, avgDuration || 1))
          }
          colour="#E8A317"
          staticLine
        />
        <SparkCard
          title="Cancellation rate"
          big={`${cancelRate}%`}
          sub={
            cancelRate === 0
              ? 'None cancelled'
              : cancelRate < 10
                ? 'Healthy'
                : 'High — investigate'
          }
          data={dailyCounts.map(() => Math.max(0, cancelRate))}
          colour={cancelRate >= 10 ? 'var(--color-alert)' : 'var(--color-accent)'}
          staticLine
        />
      </div>
    </>
  )
}

/* ====================== Clients tab ====================== */

function ClientsTab({ clients }: { clients: AnalyticsClient[] }) {
  const active = clients.filter((c) => !c.archived_at)
  const byCategory = Object.entries(
    active.reduce<Record<string, number>>((acc, c) => {
      const k = c.category_name ?? 'Uncategorised'
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {}),
  ).sort((a, b) => b[1] - a[1])
  const catMax = byCategory[0]?.[1] ?? 1

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
      <div className="card" style={{ padding: 22 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            marginBottom: 4,
          }}
        >
          Cohort retention
        </div>
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            marginBottom: 20,
          }}
        >
          Retention at 3 / 6 / 12 months by onboarding month
        </div>
        <div
          style={{
            padding: '28px 0',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.88rem',
          }}
        >
          Needs 3+ months of onboarded clients to populate. Cohorts appear
          automatically once the data exists.
        </div>
      </div>
      <div className="card" style={{ padding: 22 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            marginBottom: 4,
          }}
        >
          By category
        </div>
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            marginBottom: 16,
          }}
        >
          {active.length} active client{active.length === 1 ? '' : 's'}
        </div>
        {byCategory.length === 0 ? (
          <ChartEmpty message="No active clients yet." />
        ) : (
          byCategory.map(([label, v], i) => (
            <HBar
              key={label}
              label={label}
              value={v}
              max={catMax}
              colour={typeColours[i % typeColours.length]}
            />
          ))
        )}
      </div>
    </div>
  )
}

/* ====================== Sessions tab ====================== */

function SessionsTab({
  appointments,
}: {
  appointments: AnalyticsAppointment[]
}) {
  // Busiest hours: count per hour-of-day for the current range.
  const hourCounts = new Array(14).fill(0) as number[] // 6am..7pm = 14 buckets
  for (const a of appointments) {
    if (a.status === 'cancelled') continue
    const h = new Date(a.start_at).getHours()
    if (h >= 6 && h < 20) hourCounts[h - 6] += 1
  }
  const hMax = Math.max(...hourCounts, 1)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div className="card" style={{ padding: 22 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            marginBottom: 4,
          }}
        >
          Busiest hours
        </div>
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            marginBottom: 20,
          }}
        >
          {appointments.length === 0
            ? 'No sessions in this window.'
            : `${appointments.length} sessions across the window`}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 3,
            height: 120,
          }}
        >
          {hourCounts.map((v, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${(v / hMax) * 100}%`,
                background: 'var(--color-primary)',
                opacity: 0.4 + (v / hMax) * 0.6,
                borderRadius: '2px 2px 0 0',
                minHeight: v > 0 ? 3 : 0,
              }}
              title={`${6 + i}:00 — ${v} session${v === 1 ? '' : 's'}`}
            />
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 8,
            fontSize: '.62rem',
            color: 'var(--color-muted)',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
          }}
        >
          <span>6a</span>
          <span>9a</span>
          <span>12p</span>
          <span>3p</span>
          <span>6p</span>
          <span>8p</span>
        </div>
      </div>
      <div className="card" style={{ padding: 22 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            marginBottom: 4,
          }}
        >
          Capacity
        </div>
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            marginBottom: 20,
          }}
        >
          Needs availability rules to compute utilisation.
        </div>
        <div
          style={{
            padding: '28px 0',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.88rem',
          }}
        >
          Utilisation chart appears once the Settings → Availability module
          lands (staff hours per weekday).
        </div>
      </div>
    </div>
  )
}

/* ====================== Revenue + Clinical: empty-state cards ====================== */

function PendingModuleCard({ kind }: { kind: 'revenue' | 'clinical' }) {
  const title =
    kind === 'revenue' ? 'Revenue reporting pending' : 'Clinical outcomes pending'
  const body =
    kind === 'revenue'
      ? "Revenue breakdown (Private · Medicare · NDIS · WorkCover), outstanding invoices, and per-session averages land with the billing module. Until then, nothing to report."
      : 'Outcome markers roll up from published reports and session logs — ADD:ABD ratios, sprint splits, pain (VAS), bone-loading volume. Appears once the report integrations (VALD, ForceFrame) are wired.'

  return (
    <div
      className="card"
      style={{
        padding: '40px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.2rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: '.92rem',
          margin: '0 auto',
          lineHeight: 1.6,
          maxWidth: 520,
        }}
      >
        {body}
      </p>
    </div>
  )
}

/* ====================== Chart primitives ====================== */

function StatCard({
  value,
  label,
  detail,
  tone = 'neutral',
}: {
  value: string
  label: string
  detail?: string
  tone?: 'neutral' | 'primary' | 'muted'
}) {
  const valueColor = {
    neutral: 'var(--color-charcoal)',
    primary: 'var(--color-primary)',
    muted: 'var(--color-muted)',
  }[tone]
  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: '2.2rem',
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
          }}
        >
          {detail}
        </div>
      )}
    </div>
  )
}

function HBar({
  label,
  value,
  max,
  colour,
}: {
  label: string
  value: number
  max: number
  colour: string
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '.78rem',
          marginBottom: 4,
        }}
      >
        <span style={{ color: 'var(--color-text)' }}>{label}</span>
        <span style={{ color: 'var(--color-text-light)', fontWeight: 600 }}>
          {value}
        </span>
      </div>
      <div
        style={{
          height: 5,
          background: '#F0EBE5',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${(value / max) * 100}%`,
            height: '100%',
            background: colour,
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  )
}

function WeeklyBarChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
          height: 160,
          padding: '0 0 12px',
          borderBottom: '1px solid #F0EBE5',
        }}
      >
        {data.map((v, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
            }}
            title={`Week ${i + 1}: ${v}`}
          >
            <div
              style={{
                background: 'var(--color-primary)',
                height: `${(v / max) * 100}%`,
                minHeight: v > 0 ? 3 : 0,
                borderRadius: '2px 2px 0 0',
              }}
            />
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 6,
          fontSize: '.64rem',
          color: 'var(--color-muted)',
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          letterSpacing: '.04em',
        }}
      >
        <span>{data.length} weeks ago</span>
        <span>Now</span>
      </div>
    </>
  )
}

function SparkCard({
  title,
  big,
  sub,
  data,
  colour,
  staticLine = false,
}: {
  title: string
  big: string
  sub: string
  data: number[]
  colour: string
  staticLine?: boolean
}) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ fontSize: '.74rem', color: 'var(--color-text-light)' }}>
        {title}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: '1.8rem',
          color: 'var(--color-primary)',
          lineHeight: 1.1,
          margin: '4px 0 2px',
        }}
      >
        {big}
      </div>
      <div
        style={{
          fontSize: '.7rem',
          color: 'var(--color-muted)',
          marginBottom: 10,
        }}
      >
        {sub}
      </div>
      {staticLine ? (
        <div
          style={{
            height: 40,
            borderBottom: `1.5px dashed ${colour}`,
            marginBottom: 2,
          }}
        />
      ) : (
        <Sparkline data={data} colour={colour} />
      )}
    </div>
  )
}

function Sparkline({ data, colour }: { data: number[]; colour: string }) {
  if (data.length < 2) {
    return (
      <div
        style={{
          height: 40,
          borderBottom: `1.5px solid ${colour}`,
          opacity: 0.25,
        }}
      />
    )
  }
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * 100},${
          100 - ((v - min) / (max - min || 1)) * 100
        }`,
    )
    .join(' ')
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ width: '100%', height: 40 }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={colour}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function ChartEmpty({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '20px 0',
        textAlign: 'center',
        color: 'var(--color-muted)',
        fontSize: '.84rem',
      }}
    >
      {message}
    </div>
  )
}

/* ====================== Helpers ====================== */

function rangeStartFor(range: Range): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (range === '7d') d.setDate(d.getDate() - 6)
  else if (range === '30d') d.setDate(d.getDate() - 29)
  else d.setMonth(d.getMonth() - 12)
  return d
}

function rangeLabel(r: Range): string {
  if (r === '7d') return '7 days'
  if (r === '30d') return '30 days'
  return '12 months'
}

function weeklyCounts(
  appts: AnalyticsAppointment[],
  weeks: number,
): number[] {
  const out = new Array(weeks).fill(0) as number[]
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const now = Date.now()
  for (const a of appts) {
    const t = new Date(a.start_at).getTime()
    const diffWeeks = Math.floor((now - t) / msPerWeek)
    const idx = weeks - 1 - diffWeeks
    if (idx >= 0 && idx < weeks) out[idx] += 1
  }
  return out
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const typeColours = [
  'var(--color-primary)',
  'var(--color-accent)',
  'var(--color-alert)',
  '#E8A317',
  '#78746F',
]

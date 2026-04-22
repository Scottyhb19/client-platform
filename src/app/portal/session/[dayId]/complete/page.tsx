import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function PortalSessionCompletePage({
  params,
}: {
  params: Promise<{ dayId: string }>
}) {
  const { dayId } = await params
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // Find the most recent completed session for this program_day.
  const { data: session } = await supabase
    .from('sessions')
    .select(
      `id, started_at, completed_at,
       exercise_logs(
         id,
         sets:set_logs(
           reps_performed, weight_value, rpe
         )
       )`,
    )
    .eq('program_day_id', dayId)
    .not('completed_at', 'is', null)
    .is('deleted_at', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!session) {
    // Session not yet completed (or none at all) — bounce back to the
    // live logger. This also covers deep-linking to /complete before
    // the final set is done.
    return (
      <FallbackCard
        title="No completed session yet"
        body="Finish logging your sets before you land here."
        dayId={dayId}
      />
    )
  }

  // Summary stats.
  let totalSets = 0
  let totalReps = 0
  let totalVolumeKg = 0
  let rpeSum = 0
  let rpeCount = 0

  for (const el of session.exercise_logs ?? []) {
    for (const s of el.sets ?? []) {
      totalSets += 1
      if (s.reps_performed !== null) totalReps += s.reps_performed
      if (s.weight_value !== null && s.reps_performed !== null) {
        totalVolumeKg += Number(s.weight_value) * s.reps_performed
      }
      if (s.rpe !== null) {
        rpeSum += s.rpe
        rpeCount += 1
      }
    }
  }

  const durationMin =
    session.started_at && session.completed_at
      ? Math.max(
          1,
          Math.round(
            (new Date(session.completed_at).getTime() -
              new Date(session.started_at).getTime()) /
              (1000 * 60),
          ),
        )
      : null
  const avgRpe = rpeCount > 0 ? rpeSum / rpeCount : null

  return (
    <div style={{ padding: '60px 24px 32px', textAlign: 'center' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--color-accent)',
          margin: '0 auto 20px',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
        }}
      >
        <Check size={32} aria-hidden />
      </div>

      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.72rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--color-primary)',
        }}
      >
        Session complete
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '2rem',
          margin: '4px 0 14px',
          letterSpacing: '-.01em',
        }}
      >
        Another one in the bank.
      </h2>
      <p
        style={{
          fontSize: '.92rem',
          color: 'var(--color-text-light)',
          lineHeight: 1.5,
          marginBottom: 28,
        }}
      >
        {totalSets} {totalSets === 1 ? 'set' : 'sets'} logged. Consistency
        wins.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginBottom: 28,
          textAlign: 'left',
        }}
      >
        <StatTile
          label="Volume"
          value={
            totalVolumeKg > 0 ? `${Math.round(totalVolumeKg)}kg` : '—'
          }
        />
        <StatTile
          label="Avg RPE"
          value={avgRpe !== null ? avgRpe.toFixed(1) : '—'}
        />
        <StatTile
          label="Duration"
          value={durationMin !== null ? `${durationMin} min` : '—'}
        />
      </div>

      <Link
        href="/portal"
        style={{
          display: 'block',
          padding: 16,
          background: 'var(--color-primary)',
          color: '#fff',
          borderRadius: 12,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.1rem',
          letterSpacing: '.02em',
          textDecoration: 'none',
        }}
      >
        Back to today
      </Link>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          fontSize: '.62rem',
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.15rem',
          color: 'var(--color-charcoal)',
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function FallbackCard({
  title,
  body,
  dayId,
}: {
  title: string
  body: string
  dayId: string
}) {
  return (
    <div style={{ padding: '40px 24px', textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.2rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: '.88rem',
          color: 'var(--color-text-light)',
          lineHeight: 1.5,
          marginBottom: 20,
        }}
      >
        {body}
      </p>
      <Link
        href={`/portal/session/${dayId}`}
        style={{
          display: 'inline-block',
          padding: '12px 22px',
          background: 'var(--color-primary)',
          color: '#fff',
          borderRadius: 10,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.95rem',
          textDecoration: 'none',
        }}
      >
        Back to the logger
      </Link>
    </div>
  )
}

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
      `id, started_at, completed_at, session_rpe,
       exercise_logs(
         id,
         sets:set_logs(
           reps_performed, weight_value
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
  let totalVolumeKg = 0

  for (const el of session.exercise_logs ?? []) {
    for (const s of el.sets ?? []) {
      totalSets += 1
      if (s.weight_value !== null && s.reps_performed !== null) {
        totalVolumeKg += Number(s.weight_value) * s.reps_performed
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
  // Session RPE is the single value the client gave on the wrap-up screen
  // (sessions.session_rpe) — closure on this session, NOT the removed per-set
  // aggregate. NULL when the client skipped the rating (a clean "Not rated"
  // tile, never a dash — 2026-06-26 dogfooding deviation).
  const sessionRpe = session.session_rpe
  // P2-3: exercises count (distinct exercise_logs for the session) — the
  // brief's §6.3.1 stat set names "exercises". Kept alongside Volume / Session
  // RPE / Duration, so the panel is four tiles.
  const exerciseCount = session.exercise_logs?.length ?? 0

  return (
    <div style={{ padding: '60px 24px 32px', textAlign: 'center' }}>
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--session-accent)',
          margin: '0 auto 20px',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--session-on-accent)',
        }}
      >
        <Check size={32} aria-hidden />
      </div>

      <div
        className="session-eyebrow"
        // Override eyebrow's default muted colour — completion screen wants
        // the eyebrow to read as a "yes you did it" accent, not a quiet label.
        style={{ color: 'var(--session-accent)' }}
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
          color: 'var(--session-text-muted)',
          lineHeight: 1.5,
          marginBottom: 28,
        }}
      >
        {totalSets} {totalSets === 1 ? 'set' : 'sets'} logged. Consistency
        wins.
      </p>

      <div
        // 2×2 at 375px — four tiles across would crush a value like
        // "1,234kg"; a 2×2 keeps each tile readable.
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
          marginBottom: 28,
          textAlign: 'left',
        }}
      >
        <StatTile
          label="Exercises"
          value={exerciseCount > 0 ? String(exerciseCount) : '—'}
        />
        <StatTile
          label="Volume"
          value={
            totalVolumeKg > 0 ? `${Math.round(totalVolumeKg)}kg` : '—'
          }
        />
        <StatTile
          label="Session RPE"
          value={sessionRpe !== null ? String(sessionRpe) : 'Not rated'}
          muted={sessionRpe === null}
        />
        <StatTile
          label="Duration"
          value={durationMin !== null ? `${durationMin} min` : '—'}
        />
      </div>

      <Link
        href="/portal"
        className="portal-btn-primary"
        style={{
          background: 'var(--session-cta-bg)',
          color: 'var(--session-cta-text)',
        }}
      >
        Back to today
      </Link>
    </div>
  )
}

/**
 * Compact stat tile for the completion summary. Wraps a `.portal-stat`
 * (label-then-value) in a `.portal-card` with the smaller list-row radius
 * (--radius-chip / 10px) so the three tiles read as a tight panel rather
 * than full content cards.
 */
function StatTile({
  label,
  value,
  // `muted` softens the value (lighter colour, smaller size) for a clean
  // non-numeric state — e.g. "Not rated" when the client skipped Session RPE.
  // Reads as an intentional absence, never a missing-data dash.
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--session-card)',
        border: '1px solid var(--session-border)',
        borderRadius: 'var(--radius-chip)',
        padding: '10px 12px',
      }}
    >
      <div
        // Tighter eyebrow than .portal-eyebrow's standard 0.72rem — stat
        // tiles need a smaller label to balance the tile's own size.
        style={{
          fontSize: '.62rem',
          color: 'var(--session-text-muted)',
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
          fontSize: muted ? '0.92rem' : '1.15rem',
          color: muted ? 'var(--session-text-muted)' : 'var(--session-text)',
          marginTop: muted ? 4 : 2,
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
          color: 'var(--session-text)',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: '.88rem',
          color: 'var(--session-text-muted)',
          lineHeight: 1.5,
          marginBottom: 20,
        }}
      >
        {body}
      </p>
      <Link
        href={`/portal/session/${dayId}`}
        className="portal-btn-primary"
        // Inline-block override — fallback is centred under a paragraph,
        // not the full-width primary CTA shape that .portal-btn-primary
        // assumes. Keep the class for font/transition; tighten the box and
        // swap to the in-session palette.
        style={{
          display: 'inline-block',
          width: 'auto',
          padding: '12px 22px',
          fontSize: '.95rem',
          borderRadius: 'var(--radius-chip)',
          background: 'var(--session-cta-bg)',
          color: 'var(--session-cta-text)',
        }}
      >
        Back to the logger
      </Link>
    </div>
  )
}

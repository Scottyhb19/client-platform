import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Logger, type LoggedSet, type LoggerExercise } from './_components/Logger'
import { startOrResumeSessionAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function PortalSessionPage({
  params,
}: {
  params: Promise<{ dayId: string }>
}) {
  const { dayId } = await params
  const supabase = await createSupabaseServerClient()

  // P1-7: these four reads are independent (each keyed on dayId / auth, no
  // inter-dependency), so fetch them in parallel and run the guards after —
  // one wait instead of three sequential round-trips. The session start
  // (needs the not-completed guard to pass) and the existing-logs read
  // (needs the sessionId) stay sequential below.
  //   - day: must be published (can't start a session on a draft day).
  //   - completed: if this program_day already has a completed session for
  //     the caller, route to the summary — covers every entry path (strip
  //     tap, deep link, back, shared URL). RLS scopes it to the caller.
  //   - exercises: via the SECURITY DEFINER RPC (exercises isn't client-
  //     readable under RLS; the RPC pins to auth.uid()).
  //   - client first name: for the "Great work, {name}" completion screen.
  const [dayRes, completedRes, exercisesRes, clientRes] = await Promise.all([
    supabase
      .from('program_days')
      .select('id, day_label, published_at')
      .eq('id', dayId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('sessions')
      .select('id')
      .eq('program_day_id', dayId)
      .not('completed_at', 'is', null)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle(),
    supabase.rpc('client_get_program_day_exercises', {
      p_program_day_id: dayId,
    }),
    supabase
      .from('clients')
      .select('first_name')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  const day = dayRes.data
  if (!day) notFound()
  if (!day.published_at) {
    redirect('/portal')
  }

  if (completedRes.data) {
    redirect(`/portal/session/${dayId}/complete`)
  }

  const { data: exerciseRows, error: exErr } = exercisesRes
  if (exErr) {
    return <SessionError dayId={dayId} message={exErr.message} />
  }

  const clientName = clientRes.data?.first_name ?? 'there'

  const sorted = [...(exerciseRows ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  )

  // Assign A / B / C letters based on supersets (consecutive rows with
  // the same superset_group_id share a base letter; subindex appended).
  const groupCounts = new Map<string, number>()
  for (const e of sorted) {
    if (e.superset_group_id) {
      groupCounts.set(
        e.superset_group_id,
        (groupCounts.get(e.superset_group_id) ?? 0) + 1,
      )
    }
  }

  const exercises: LoggerExercise[] = []
  let groupLetterIndex = -1
  let currentGroupId: string | null = null
  let subIndex = 0

  for (const e of sorted) {
    const groupId = e.superset_group_id
    const inSuperset = !!groupId && (groupCounts.get(groupId) ?? 1) > 1

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

    // prescription_sets comes back as Json from the RPC's jsonb_agg. Parse
    // and project into the Logger's typed shape. The RPC already orders
    // by set_number, so no sort needed here.
    const rawSets = Array.isArray(e.prescription_sets)
      ? (e.prescription_sets as Array<{
          set_number: number
          reps: string | null
          optional_metric: string | null
          optional_value: string | null
        }>)
      : []

    exercises.push({
      programExerciseId: e.program_exercise_id,
      name: e.exercise_name,
      sectionTitle: e.section_title,
      instructions: e.instructions,
      prescribedSets: rawSets.map((s) => ({
        setNumber: s.set_number,
        reps: s.reps,
        optionalMetric: s.optional_metric,
        optionalValue: s.optional_value,
      })),
      letter,
      supersetGroupId: e.superset_group_id,
      videoUrl: e.exercise_video_url,
    })
  }

  if (exercises.length === 0) {
    return (
      <SessionError
        dayId={dayId}
        message="This day has no exercises yet. Ask your EP."
      />
    )
  }

  // Start or resume the session. client_start_session guards against
  // double-starts; resume handles the "already in progress" case.
  const { sessionId, error: startErr } =
    await startOrResumeSessionAction(dayId)
  if (startErr || !sessionId) {
    return (
      <SessionError
        dayId={dayId}
        message={
          startErr ??
          "We couldn't start this session. Try again from Today."
        }
      />
    )
  }

  // Pull existing set logs + per-exercise notes for this session so a
  // resume shows what's already been done (sets) and prefills the per-group
  // notes field (notes, P1-4).
  const { data: logRows } = await supabase
    .from('exercise_logs')
    .select(
      `id, program_exercise_id, notes,
       sets:set_logs(
         set_number, reps_performed, weight_value, weight_metric,
         optional_value, rpe
       )`,
    )
    .eq('session_id', sessionId)
    .is('deleted_at', null)

  const existingLogs: LoggedSet[] = []
  const exerciseNotes: Record<string, string> = {}
  for (const el of logRows ?? []) {
    if (!el.program_exercise_id) continue
    if (el.notes) exerciseNotes[el.program_exercise_id] = el.notes
    for (const s of el.sets ?? []) {
      existingLogs.push({
        programExerciseId: el.program_exercise_id,
        setNumber: s.set_number,
        reps: s.reps_performed,
        weightValue:
          s.weight_value !== null ? Number(s.weight_value) : null,
        weightMetric: s.weight_metric,
        optionalValue: s.optional_value,
        rpe: s.rpe,
      })
    }
  }

  return (
    <Logger
      sessionId={sessionId}
      dayId={dayId}
      dayLabel={day.day_label}
      clientName={clientName}
      exercises={exercises}
      existingLogs={existingLogs}
      exerciseNotes={exerciseNotes}
    />
  )
}

function SessionError({
  dayId: _dayId,
  message,
}: {
  dayId: string
  message: string
}) {
  return (
    <>
      <div
        style={{
          padding: '18px 20px 16px',
        }}
      >
        <Link
          href="/portal"
          style={{
            fontSize: '.82rem',
            color: 'var(--session-text-muted)',
            textDecoration: 'none',
          }}
        >
          ← Back
        </Link>
      </div>
      <div
        style={{
          margin: '0 16px 16px',
          padding: '32px 20px',
          textAlign: 'center',
          background: 'var(--session-card)',
          border: '1px solid var(--session-border)',
          borderRadius: 'var(--radius-card)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--session-text)',
            marginBottom: 6,
          }}
        >
          Can&rsquo;t start this session
        </div>
        <p
          style={{
            fontSize: '.86rem',
            lineHeight: 1.5,
            color: 'var(--session-text-muted)',
            margin: 0,
          }}
        >
          {message}
        </p>
      </div>
    </>
  )
}

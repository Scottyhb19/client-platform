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

  // The program_day must be published — can't start a session on a
  // draft day. Portal layout already verified the caller is a client.
  const { data: day } = await supabase
    .from('program_days')
    .select('id, day_label, published_at')
    .eq('id', dayId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!day) notFound()
  if (!day.published_at) {
    redirect('/portal')
  }

  // Load the exercise list via the SECURITY DEFINER RPC. Using the RPC
  // rather than a direct SELECT because the exercises table isn't
  // client-readable under RLS; the RPC pins the query to auth.uid().
  const { data: exerciseRows, error: exErr } = await supabase.rpc(
    'client_get_program_day_exercises',
    { p_program_day_id: dayId },
  )

  if (exErr) {
    return (
      <SessionError
        dayId={dayId}
        message={exErr.message}
      />
    )
  }

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

    exercises.push({
      programExerciseId: e.program_exercise_id,
      name: e.exercise_name,
      sectionTitle: e.section_title,
      instructions: e.instructions,
      sets: e.sets ?? 1,
      reps: e.reps,
      optionalValue: e.optional_value,
      rpe: e.rpe,
      letter,
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

  // Pull existing set logs for this session so a resume shows what's
  // already been done.
  const { data: logRows } = await supabase
    .from('exercise_logs')
    .select(
      `id, program_exercise_id,
       sets:set_logs(
         set_number, reps_performed, weight_value, weight_metric,
         optional_value, rpe
       )`,
    )
    .eq('session_id', sessionId)
    .is('deleted_at', null)

  const existingLogs: LoggedSet[] = []
  for (const el of logRows ?? []) {
    if (!el.program_exercise_id) continue
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
      dayLabel={`Day ${day.day_label}`}
      exercises={exercises}
      existingLogs={existingLogs}
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
            color: 'var(--color-text-light)',
            textDecoration: 'none',
          }}
        >
          ← Back
        </Link>
      </div>
      <div
        style={{
          margin: '0 16px 16px',
          background: '#fff',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '32px 20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-charcoal)',
            marginBottom: 6,
          }}
        >
          Can&rsquo;t start this session
        </div>
        <p
          style={{
            fontSize: '.86rem',
            lineHeight: 1.5,
            color: 'var(--color-text-light)',
            margin: 0,
          }}
        >
          {message}
        </p>
      </div>
    </>
  )
}

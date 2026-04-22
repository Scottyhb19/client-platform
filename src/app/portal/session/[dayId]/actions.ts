'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Start a new session against a published program_day, OR resume an
 * existing in-progress session for the same day. Returns the session id.
 * The SECURITY DEFINER `client_start_session` RPC refuses to create a
 * second in-progress session — we catch that case and look up the
 * existing row instead.
 */
export async function startOrResumeSessionAction(
  programDayId: string,
): Promise<{ sessionId: string | null; error: string | null }> {
  const supabase = await createSupabaseServerClient()

  // Does this client already have an in-progress session for this day?
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { sessionId: null, error: 'Not authenticated.' }

  const { data: existing } = await supabase
    .from('sessions')
    .select('id, program_day_id')
    .eq('program_day_id', programDayId)
    .is('completed_at', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (existing) {
    return { sessionId: existing.id, error: null }
  }

  // Otherwise ask the RPC to start one. If a DIFFERENT session is in
  // progress it'll error — we surface that so the user can finish it.
  const { data, error } = await supabase.rpc('client_start_session', {
    p_program_day_id: programDayId,
  })

  if (error) {
    return { sessionId: null, error: error.message }
  }
  return { sessionId: data, error: null }
}

export type LogSetInput = {
  sessionId: string
  programExerciseId: string
  setNumber: number
  reps: number | null
  weightValue: number | null
  weightMetric: string | null
  optionalValue: string | null
  rpe: number | null
}

export async function logSetAction(
  input: LogSetInput,
): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient()

  // Generated RPC types mark every param as non-null, but the Postgres
  // function accepts NULL on every field except the ids + set_number.
  // Cast the args to `never` so TS doesn't block legitimate null loads.
  const { error } = await supabase.rpc(
    'client_log_set',
    {
      p_session_id: input.sessionId,
      p_program_exercise_id: input.programExerciseId,
      p_set_number: input.setNumber,
      p_weight_value: input.weightValue,
      p_weight_metric: input.weightMetric,
      p_reps_performed: input.reps,
      p_optional_metric: null,
      p_optional_value: input.optionalValue,
      p_rpe: input.rpe,
      p_notes: null,
    } as never,
  )

  if (error) return { error: error.message }
  return { error: null }
}

export async function completeSessionAction(
  sessionId: string,
  dayId: string,
  feedback: string | null,
  sessionRpe: number | null,
): Promise<{ error: string | null }> {
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc(
    'client_complete_session',
    {
      p_session_id: sessionId,
      p_session_rpe: sessionRpe,
      p_feedback: feedback,
    } as never,
  )
  if (error) return { error: error.message }

  revalidatePath('/portal')
  redirect(`/portal/session/${dayId}/complete`)
}

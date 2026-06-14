'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { resolvePortalToday } from '../../_lib/timezone'

/**
 * Phase K (2026-05-13). "Begin session early" on a future programmed day.
 * Two-step: (1) reschedule the program_day's scheduled_date to today via
 * the client_reschedule_program_day_to_today RPC; (2) start a session
 * normally via startOrResumeSessionAction. Sequencing in the server
 * action (not inside one RPC) so each RPC keeps a single responsibility
 * and the v3 client_start_session refusal stack (in-progress, completed-
 * already) applies unchanged after the date has moved.
 *
 * The reschedule RPC enforces its own refusals (future-only, no same-date
 * collision, no in-progress, no completed). Surface any error message
 * back to the caller — DayScreen renders it inline beneath the confirm
 * dialog so the client knows what went wrong without losing the card.
 */
export async function rescheduleAndStartSessionAction(
  programDayId: string,
): Promise<{ sessionId: string | null; error: string | null }> {
  const supabase = await createSupabaseServerClient()

  // Auth check upfront so the RPC's identical check is purely defensive.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { sessionId: null, error: 'Not authenticated.' }

  // Step 1: move scheduled_date → today. The RPC no longer derives "today"
  // from UTC CURRENT_DATE (section 7 P0-1 — that caused the false "Today
  // already has a session" collision); we resolve the device/org-timezone
  // today here and pass it as p_today. RPC returns the program_day_id on
  // success (or RAISEs an exception supabase-js surfaces as an error). The
  // `as never` cast matches the idiom used by logSetAction /
  // completeSessionAction below (generated types lag the new signature).
  const { todayIso } = await resolvePortalToday(supabase)
  const { error: rescheduleErr } = await supabase.rpc(
    'client_reschedule_program_day_to_today' as never,
    { p_program_day_id: programDayId, p_today: todayIso } as never,
  )
  if (rescheduleErr) {
    // Pass the RPC's user-facing message through unchanged. The RPC
    // attaches HINT strings via USING HINT; supabase-js exposes them
    // on .message + .hint, and we surface .message to the user.
    return { sessionId: null, error: rescheduleErr.message }
  }

  // Step 2: start (or resume — defensive idempotency) the session.
  // After step 1, the day's scheduled_date = today, so this is now
  // structurally identical to "Begin session" on today's card.
  return startOrResumeSessionAction(programDayId)
}

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

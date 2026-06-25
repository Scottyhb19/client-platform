'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Phase C — day-level copy + repeat server actions.
 *
 * Both wrap RPCs (copy_program_day, repeat_program_day_weekly) that
 * return a tagged jsonb { status, ... } so the UI can branch on the
 * outcome without try/catching exceptions. The action layer just
 * threads the RPC's response through plus revalidates the page on
 * any successful write.
 */

export type ConflictEntry = {
  date: string          // ISO 'YYYY-MM-DD'
  existingDayId: string
}

export type CopyDayActionResult =
  | { error: string }
  | { status: 'created'; newDayId: string }
  | { status: 'conflict'; conflicts: ConflictEntry[] }
  | { status: 'no_program'; targetDate: string }

export type RepeatDayActionResult =
  | { error: string }
  | { status: 'created'; newDayIds: string[]; noProgramDates: string[] }
  | {
      status: 'conflict'
      conflicts: ConflictEntry[]
      noProgramDates: string[]
    }
  | { status: 'invalid_end_date' }

export type RemoveDayActionResult =
  | { error: string }
  | { status: 'removed' }

export type PublishAllActionResult =
  | { error: string }
  | { status: 'done'; assigned: number; skippedEmpty: number }

export type CreateDayActionResult =
  | { error: string }
  | { status: 'created'; newDayId: string }
  | { status: 'no_program'; targetDate: string }
  | { status: 'conflict'; existingDayId: string }

export type RenameDayActionResult =
  | { error: string }
  | { status: 'renamed'; dayLabel: string }

export type DuplicateDayActionResult =
  | { error: string }
  | { status: 'created'; newDayId: string }
  | { status: 'conflict' }
  | { status: 'no_program'; targetDate: string }

export type CopyWeekActionResult =
  | { error: string }
  | { status: 'created'; newDayIds: string[]; noProgramDates: string[] }
  | {
      status: 'conflict'
      conflicts: ConflictEntry[]
      noProgramDates: string[]
    }
  | { status: 'empty_week' }
  | { status: 'invalid_week' }

export type RepeatWeekActionResult =
  | { error: string }
  | { status: 'created'; newDayIds: string[]; noProgramDates: string[] }
  | {
      status: 'conflict'
      conflicts: ConflictEntry[]
      noProgramDates: string[]
    }
  | { status: 'empty_week' }
  | { status: 'invalid_week' }
  | { status: 'invalid_end_date' }


/**
 * Copy one program_day to a target date. The destination program is
 * resolved server-side from the date — for cross-program copies, the
 * new day attaches to whichever active program covers the target.
 *
 * Pass `force = true` after the user confirms an overwrite from the
 * conflict dialog.
 */
export async function copyDayAction(
  clientId: string,
  sourceDayId: string,
  targetDate: string,
  force: boolean = false,
): Promise<CopyDayActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('copy_program_day', {
    p_source_day_id: sourceDayId,
    p_target_date: targetDate,
    p_force: force,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from copy_program_day' }
  }

  const obj = data as {
    status: string
    new_day_id?: string
    target_date?: string
    conflicts?: Array<{ date: string; existing_day_id: string }>
  }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return { status: 'created', newDayId: obj.new_day_id! }
    case 'conflict':
      return {
        status: 'conflict',
        conflicts: (obj.conflicts ?? []).map((c) => ({
          date: c.date,
          existingDayId: c.existing_day_id,
        })),
      }
    case 'no_program':
      return { status: 'no_program', targetDate: obj.target_date! }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}


/**
 * Repeat one program_day weekly on the same weekday until p_end_date
 * (inclusive). Each occurrence attaches to whichever active program
 * covers that date; dates outside any program are silently skipped
 * and reported in `noProgramDates` so the UI can mention them.
 *
 * Pass `force = true` after the user confirms overwriting any conflicts.
 */
export async function repeatDayWeeklyAction(
  clientId: string,
  sourceDayId: string,
  endDate: string,
  force: boolean = false,
): Promise<RepeatDayActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('repeat_program_day_weekly', {
    p_source_day_id: sourceDayId,
    p_end_date: endDate,
    p_force: force,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from repeat_program_day_weekly' }
  }

  const obj = data as {
    status: string
    new_day_ids?: string[]
    no_program_dates?: string[]
    conflicts?: Array<{ date: string; existing_day_id: string }>
  }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return {
        status: 'created',
        newDayIds: obj.new_day_ids ?? [],
        noProgramDates: obj.no_program_dates ?? [],
      }
    case 'conflict':
      return {
        status: 'conflict',
        conflicts: (obj.conflicts ?? []).map((c) => ({
          date: c.date,
          existingDayId: c.existing_day_id,
        })),
        noProgramDates: obj.no_program_dates ?? [],
      }
    case 'invalid_end_date':
      return { status: 'invalid_end_date' }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}


/**
 * P1-1 (program-calendar polish pass) — copy a whole Mon–Sun week of
 * sessions onto another week. The RPC orchestrates copy_program_day per
 * source day (same weekday offsets), accumulating conflicts across the
 * WHOLE week into one response so the UI shows a single confirm dialog.
 *
 * Pass `force = true` after the user confirms overwriting conflicts.
 */
export async function copyWeekAction(
  clientId: string,
  sourceWeekStart: string,
  targetWeekStart: string,
  force: boolean = false,
): Promise<CopyWeekActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('copy_program_week', {
    p_client_id: clientId,
    p_source_week_start: sourceWeekStart,
    p_target_week_start: targetWeekStart,
    p_force: force,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from copy_program_week' }
  }

  const obj = data as {
    status: string
    new_day_ids?: string[]
    no_program_dates?: string[]
    conflicts?: Array<{ date: string; existing_day_id: string }>
  }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return {
        status: 'created',
        newDayIds: obj.new_day_ids ?? [],
        noProgramDates: obj.no_program_dates ?? [],
      }
    case 'conflict':
      return {
        status: 'conflict',
        conflicts: (obj.conflicts ?? []).map((c) => ({
          date: c.date,
          existingDayId: c.existing_day_id,
        })),
        noProgramDates: obj.no_program_dates ?? [],
      }
    case 'empty_week':
      return { status: 'empty_week' }
    case 'invalid_week':
      return { status: 'invalid_week' }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}


/**
 * P1-1 — repeat a whole Mon–Sun week onto every subsequent week through
 * the picked end date (day-granular cutoff; auto-extends the covering
 * block best-effort, matching the day-level repeat).
 */
export async function repeatWeekAction(
  clientId: string,
  sourceWeekStart: string,
  endDate: string,
  force: boolean = false,
): Promise<RepeatWeekActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('repeat_program_week', {
    p_client_id: clientId,
    p_source_week_start: sourceWeekStart,
    p_end_date: endDate,
    p_force: force,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from repeat_program_week' }
  }

  const obj = data as {
    status: string
    new_day_ids?: string[]
    no_program_dates?: string[]
    conflicts?: Array<{ date: string; existing_day_id: string }>
  }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return {
        status: 'created',
        newDayIds: obj.new_day_ids ?? [],
        noProgramDates: obj.no_program_dates ?? [],
      }
    case 'conflict':
      return {
        status: 'conflict',
        conflicts: (obj.conflicts ?? []).map((c) => ({
          date: c.date,
          existingDayId: c.existing_day_id,
        })),
        noProgramDates: obj.no_program_dates ?? [],
      }
    case 'empty_week':
      return { status: 'empty_week' }
    case 'invalid_week':
      return { status: 'invalid_week' }
    case 'invalid_end_date':
      return { status: 'invalid_end_date' }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}


/**
 * "Assign all" (program-calendar polish) — publish every unassigned
 * program_day that has at least one exercise, across the client's active
 * blocks, in one pass. Empty days (no live program_exercises) are skipped
 * and counted, mirroring the single-day AssignButton guard that disables
 * publishing a day with zero exercises.
 *
 * Runs as the authenticated EP (no SECURITY DEFINER): RLS scopes every
 * read and the UPDATE to the caller's organization, so a stray clientId
 * from another org resolves to zero rows rather than leaking. A single
 * published_at timestamp is stamped across the batch so "assigned together"
 * stays legible in the data.
 */
export async function publishAllProgramDaysAction(
  clientId: string,
): Promise<PublishAllActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Active blocks for this client (RLS-scoped to the caller's org).
  const { data: progs, error: pErr } = await supabase
    .from('programs')
    .select('id')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .is('deleted_at', null)
  if (pErr) return { error: pErr.message }

  const programIds = (progs ?? []).map((p) => p.id)
  if (programIds.length === 0) {
    return { status: 'done', assigned: 0, skippedEmpty: 0 }
  }

  // Unassigned (published_at NULL), live days across those blocks.
  const { data: daysRaw, error: dErr } = await supabase
    .from('program_days')
    .select('id')
    .in('program_id', programIds)
    .is('published_at', null)
    .is('deleted_at', null)
  if (dErr) return { error: dErr.message }

  const dayIds = (daysRaw ?? []).map((d) => d.id)
  if (dayIds.length === 0) {
    return { status: 'done', assigned: 0, skippedEmpty: 0 }
  }

  // Which of those days carry at least one live exercise? Empty days can't
  // be published (same rule as the single-day path).
  const { data: exRaw, error: eErr } = await supabase
    .from('program_exercises')
    .select('program_day_id')
    .in('program_day_id', dayIds)
    .is('deleted_at', null)
  if (eErr) return { error: eErr.message }

  const daysWithExercises = new Set(
    (exRaw ?? []).map((e) => e.program_day_id),
  )
  const toPublish = dayIds.filter((id) => daysWithExercises.has(id))
  const skippedEmpty = dayIds.length - toPublish.length

  if (toPublish.length === 0) {
    return { status: 'done', assigned: 0, skippedEmpty }
  }

  const { error: uErr } = await supabase
    .from('program_days')
    .update({ published_at: new Date().toISOString() })
    .in('id', toPublish)
    .is('published_at', null)
  if (uErr) return { error: uErr.message }

  revalidatePath(`/clients/${clientId}/program`)
  return { status: 'done', assigned: toPublish.length, skippedEmpty }
}


/**
 * Soft-delete a program_day (the EP "delete session" action from the
 * calendar popover). Cascades to its program_exercises via the
 * soft_delete_program_day RPC (SECURITY DEFINER + manual org gate;
 * see migration 20260503140000).
 */
export async function removeProgramDayAction(
  clientId: string,
  dayId: string,
): Promise<RemoveDayActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('soft_delete_program_day', {
    p_id: dayId,
  })

  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}/program`)
  return { status: 'removed' }
}


/**
 * Rename a program_day's `day_label`. Trimmed and length-validated
 * client-side AND server-side (1..30 chars, matching the DB CHECK
 * constraint). RLS scopes the UPDATE to the caller's organization.
 */
export async function renameProgramDayAction(
  clientId: string,
  dayId: string,
  rawLabel: string,
): Promise<RenameDayActionResult> {
  await requireRole(['owner', 'staff'])

  const label = rawLabel.trim()
  if (label.length < 1 || label.length > 30) {
    return { error: 'Label must be 1–30 characters.' }
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('program_days')
    .update({ day_label: label })
    .eq('id', dayId)
    .is('deleted_at', null)

  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}/program`)
  revalidatePath(`/clients/${clientId}/program/days/${dayId}`)
  return { status: 'renamed', dayLabel: label }
}


/**
 * Phase I §2.13 (session-builder polish pass) — duplicate one program_day
 * to a target date the EP picks. Wraps the duplicate_program_day RPC
 * (migration 20260508100000) which copies the day + program_exercises
 * + program_exercise_sets in a single transaction. Refuses on conflict
 * (no force-overwrite path); the new day lands as a draft (published_at
 * NULL).
 *
 * Caller revalidates both the program calendar (so the new day appears
 * on the date) and the source-day route (in case the EP is still on it).
 * The caller also navigates to the new day on success.
 */
export async function duplicateProgramDayAction(
  clientId: string,
  sourceDayId: string,
  targetDate: string,
): Promise<DuplicateDayActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('duplicate_program_day', {
    p_source_day_id: sourceDayId,
    p_target_date: targetDate,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from duplicate_program_day' }
  }

  const obj = data as {
    status: string
    new_day_id?: string
    target_date?: string
  }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return { status: 'created', newDayId: obj.new_day_id! }
    case 'conflict':
      return { status: 'conflict' }
    case 'no_program':
      return { status: 'no_program', targetDate: obj.target_date! }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}


/**
 * Phase F.0 (D-PROG-004) — create an ad-hoc program_day on the chosen
 * date for the client. The destination program is resolved server-side
 * by date (matches copy semantics). The day is inserted with
 * day_label='Day 1' and no exercises; the EP fills it out in the session
 * builder. Wraps the create_program_day RPC.
 */
export async function createProgramDayAction(
  clientId: string,
  targetDate: string,
): Promise<CreateDayActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('create_program_day', {
    p_client_id: clientId,
    p_target_date: targetDate,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from create_program_day' }
  }

  const obj = data as {
    status: string
    new_day_id?: string
    target_date?: string
    existing_day_id?: string
  }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return { status: 'created', newDayId: obj.new_day_id! }
    case 'no_program':
      return { status: 'no_program', targetDate: obj.target_date! }
    case 'conflict':
      return { status: 'conflict', existingDayId: obj.existing_day_id! }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}

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

export type CreateDayActionResult =
  | { error: string }
  | { status: 'created'; newDayId: string }
  | { status: 'no_program'; targetDate: string }
  | { status: 'conflict'; existingDayId: string }

export type RenameDayActionResult =
  | { error: string }
  | { status: 'renamed'; dayLabel: string }


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

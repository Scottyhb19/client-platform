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

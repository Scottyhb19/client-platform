'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Phase D — block-level copy + repeat server actions.
 *
 * Both wrap RPCs that return tagged jsonb so the UI branches without
 * try/catching exceptions. The actions thread the response through
 * and revalidate the page on any successful write.
 */

export type CopyProgramActionResult =
  | { error: string }
  | { status: 'created'; newProgramId: string }
  | { status: 'overlap' }
  | { status: 'invalid_source' }

export type RepeatProgramActionResult =
  | { error: string }
  | { status: 'created'; newProgramId: string }
  | { status: 'overlap' }
  | { status: 'invalid_source' }


/**
 * Clone a program (with all its weeks, days, exercises) onto an
 * EP-picked new start date. Defaults the new name to "<source> (copy)".
 *
 * Overlap with an existing active program is reported as
 * status='overlap'; the UI can show a clear "pick a date that doesn't
 * overlap" message.
 */
export async function copyProgramAction(
  clientId: string,
  sourceProgramId: string,
  newStartDate: string,
  newName?: string,
): Promise<CopyProgramActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Generated types treat p_new_name as string | undefined (DEFAULT
  // NULL on the SQL side). Omit the key when caller didn't pass a name.
  const args = {
    p_source_program_id: sourceProgramId,
    p_new_start_date: newStartDate,
    ...(newName !== undefined && newName !== ''
      ? { p_new_name: newName }
      : {}),
  }
  const { data, error } = await supabase.rpc('copy_program', args)

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from copy_program' }
  }

  const obj = data as { status: string; new_program_id?: string }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return { status: 'created', newProgramId: obj.new_program_id! }
    case 'overlap':
      return { status: 'overlap' }
    case 'invalid_source':
      return { status: 'invalid_source' }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}


/**
 * Clone a program back-to-back, immediately following its end. The new
 * program's start_date is computed server-side as
 * source.start_date + duration_weeks * 7. New name is
 * "<source.name> (next)".
 */
export async function repeatProgramAction(
  clientId: string,
  sourceProgramId: string,
): Promise<RepeatProgramActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('repeat_program', {
    p_source_program_id: sourceProgramId,
  })

  if (error) return { error: error.message }
  if (!data || typeof data !== 'object') {
    return { error: 'Unexpected response from repeat_program' }
  }

  const obj = data as { status: string; new_program_id?: string }

  switch (obj.status) {
    case 'created':
      revalidatePath(`/clients/${clientId}/program`)
      return { status: 'created', newProgramId: obj.new_program_id! }
    case 'overlap':
      return { status: 'overlap' }
    case 'invalid_source':
      return { status: 'invalid_source' }
    default:
      return { error: `Unknown status: ${obj.status}` }
  }
}

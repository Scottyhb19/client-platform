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

export type ArchiveProgramActionResult =
  | { error: string }
  | { status: 'archived' }


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
 * Archive an active program — flips status='archived' and stamps
 * archived_at. Frees the (client_id, daterange) slot held by the
 * EXCLUDE constraint `programs_no_active_overlap` so the EP can create
 * a new block in the same window.
 *
 * Direct UPDATE through the user's session (no RPC needed): the
 * `programs` SELECT RLS policy filters `deleted_at IS NULL`, and we
 * intentionally don't touch `deleted_at` — the row stays visible in
 * "archived blocks" history. Only soft-delete writes hit the RLS
 * gotcha that requires a SECURITY DEFINER RPC (see
 * `project_postgrest_soft_delete_rls.md`).
 *
 * The CHECK constraint `programs_archived_has_timestamp` requires
 * `archived_at IS NOT NULL` whenever status='archived'; we set both
 * in the same UPDATE so the row never transits an invalid state.
 *
 * The program's `program_days` aren't touched — the calendar query on
 * `/clients/[id]/program` already filters to `programs.status='active'`,
 * so the days disappear from the calendar without further work.
 */
export async function archiveProgramAction(
  clientId: string,
  programId: string,
): Promise<ArchiveProgramActionResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('programs')
    .update({
      status: 'archived',
      archived_at: new Date().toISOString(),
    })
    .eq('id', programId)
    .eq('status', 'active')
    .is('deleted_at', null)

  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}/program`)
  revalidatePath(`/clients/${clientId}`)
  return { status: 'archived' }
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

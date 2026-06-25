'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Acknowledge an overdue client from the dashboard Needs-attention panel
 * ("Program checked & message sent"). Stamps clients.overdue_followed_up_at =
 * now, which the Overdue trigger treats as activity — the client drops off the
 * panel and only re-surfaces if they are still silent after the overdue
 * cadence (~10 days). Mirrors markClinicalFlagReviewedAction (the flag snooze).
 *
 * Acknowledgement only: it records that the EP did the follow-up (checked the
 * program, sent a message via the client / messaging screens). It does not
 * itself send anything. RLS ("staff update clients in own org") scopes the
 * write to the EP's own org; clients/portal cannot UPDATE clients at all.
 */
export async function acknowledgeOverdueFollowupAction(
  clientId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('clients')
    .update({ overdue_followed_up_at: new Date().toISOString() })
    .eq('id', clientId)
    .is('deleted_at', null)

  if (error) return { error: `Could not update: ${error.message}` }

  revalidatePath('/dashboard')
  return { error: null }
}

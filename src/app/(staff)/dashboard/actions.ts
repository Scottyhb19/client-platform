'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Acknowledge a follow-up from the dashboard Needs-attention panel
 * ("Program checked & message sent"). Stamps clients.overdue_followed_up_at =
 * now, a generic "the EP followed up with this client" marker that both the
 * Overdue and the Onboarding triggers treat as activity — the client drops off
 * the panel and only re-surfaces if they are still silent after the ~10-day
 * cadence. Mirrors markClinicalFlagReviewedAction (the flag snooze).
 *
 * (The column name is overdue-specific for historical reasons; it now serves as
 * a shared follow-up ack. No rename — it is referenced across deployed code.)
 *
 * Acknowledgement only: it records that the EP did the follow-up (checked the
 * program / reached out via the client / messaging screens). It does not itself
 * send anything. RLS ("staff update clients in own org") scopes the write to the
 * EP's own org; clients/portal cannot UPDATE clients at all.
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

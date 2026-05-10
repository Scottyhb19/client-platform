'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export interface CancelBookingResult {
  error: string | null
}

/**
 * Cancel a booking. Calls the SECURITY DEFINER client_cancel_appointment
 * RPC which enforces:
 *   - caller owns the appointment (auth.uid()-pinned)
 *   - 24-hour cutoff (raises 'cannot cancel within 24 hours' otherwise)
 *   - status flip + cancelled_at + reminder cancellation in one transaction
 *
 * The 24h cutoff is also enforced in the UI (the cancel button is hidden
 * inside the window). This is the belt-and-braces version.
 */
export async function cancelAppointmentAction(
  formData: FormData,
): Promise<CancelBookingResult> {
  const appointmentId = formData.get('appointment_id')?.toString() ?? ''
  if (!appointmentId) return { error: 'Missing appointment id.' }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc(
    'client_cancel_appointment',
    { p_appointment_id: appointmentId },
  )

  if (error) {
    if (error.message?.includes('cannot cancel within 24 hours')) {
      return {
        error:
          'Inside the 24-hour window — please message your EP through the portal.',
      }
    }
    return { error: error.message }
  }

  revalidatePath('/portal/book')
  return { error: null }
}

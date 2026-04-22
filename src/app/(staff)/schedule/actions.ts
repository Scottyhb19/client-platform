'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type CreateAppointmentInput = {
  clientId: string
  startAtIso: string
  durationMinutes: number
  appointmentType: string
  location: string | null
  notes: string | null
}

export async function createAppointmentAction(
  input: CreateAppointmentInput,
): Promise<{ error: string | null; id: string | null }> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  if (!input.clientId) return { error: 'Client required.', id: null }
  if (!input.startAtIso) return { error: 'Start time required.', id: null }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    return { error: 'Duration must be positive.', id: null }
  }

  const start = new Date(input.startAtIso)
  if (Number.isNaN(start.getTime())) {
    return { error: 'Invalid start time.', id: null }
  }
  const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000)

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      organization_id: organizationId,
      staff_user_id: userId,
      client_id: input.clientId,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      appointment_type: input.appointmentType || 'Session',
      location: input.location,
      notes: input.notes,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { error: `Failed to create booking: ${error.message}`, id: null }

  revalidatePath('/schedule')
  return { error: null, id: data.id }
}

export async function cancelAppointmentAction(
  appointmentId: string,
  reason: string | null,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('appointments')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason,
    })
    .eq('id', appointmentId)

  if (error) return { error: `Cancel failed: ${error.message}` }
  revalidatePath('/schedule')
  return { error: null }
}

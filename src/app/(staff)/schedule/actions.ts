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

export type NewClientInlineInput = {
  firstName: string
  lastName: string
  email: string
}

export type NewClientInlineResult = {
  error: string | null
  client: {
    id: string
    first_name: string
    last_name: string
    category_name: string | null
  } | null
}

/**
 * Create a bare-bones client from the booking composer.
 * Skips the Supabase auth invite — the EP can send that later from the
 * client's profile. Returns the new row so the composer can select it
 * without a page refresh.
 */
export async function createClientInlineAction(
  input: NewClientInlineInput,
): Promise<NewClientInlineResult> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const first = input.firstName.trim()
  const last = input.lastName.trim()
  const email = input.email.trim().toLowerCase()

  if (!first || !last) {
    return { error: 'First and last name are required.', client: null }
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'A valid email is required.', client: null }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('clients')
    .insert({
      organization_id: organizationId,
      first_name: first,
      last_name: last,
      email,
    })
    .select('id, first_name, last_name')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { error: 'A client with that email already exists.', client: null }
    }
    return { error: `Could not create client: ${error.message}`, client: null }
  }

  revalidatePath('/schedule')
  revalidatePath('/clients')
  return {
    error: null,
    client: {
      id: data.id,
      first_name: data.first_name,
      last_name: data.last_name,
      category_name: null,
    },
  }
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

/**
 * Persist a drag-move or drag-resize on an appointment.
 * RLS enforces tenant scope; we just validate start < end and that the
 * new start/end are real dates.
 */
export async function updateAppointmentTimeAction(
  appointmentId: string,
  startAtIso: string,
  endAtIso: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const start = new Date(startAtIso)
  const end = new Date(endAtIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { error: 'Invalid dates.' }
  }
  if (end.getTime() <= start.getTime()) {
    return { error: 'End must be after start.' }
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('appointments')
    .update({
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    })
    .eq('id', appointmentId)

  if (error) return { error: `Update failed: ${error.message}` }
  revalidatePath('/schedule')
  return { error: null }
}

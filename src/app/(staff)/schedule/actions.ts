'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendBookingConfirmationEmail } from '@/lib/email/send-booking-confirmation'
import { EmailConfigError } from '@/lib/email/client'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import {
  formatBookingDateLine,
  formatBookingTimeRange,
} from '@/app/portal/book/new/_lib/format'

export type CreateAppointmentInput = {
  clientId: string | null
  startAtIso: string
  durationMinutes: number
  appointmentType: string
  location: string | null
  notes: string | null
  // 'unavailable' creates a staff-only block (admin/meeting/note) with no
  // client; defaults to 'appointment' (P1-7).
  kind?: 'appointment' | 'unavailable'
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

/**
 * Email the client a confirmation for a staff-created appointment (P1-2).
 * Best-effort — the booking is already saved; mirrors the portal's confirmation
 * send. Skips silently if the client has no email. Reuses the shared, tz-aware
 * booking formatters and the org's timezone.
 */
async function sendStaffBookingConfirmation(
  appointmentId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { data: appt } = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, appointment_type, location, staff_user_id,
       organization:organizations(name, timezone),
       client:clients(first_name, email)`,
    )
    .eq('id', appointmentId)
    .maybeSingle()

  if (!appt || !appt.client?.email || !appt.organization) return

  const { data: staffProfile } = await supabase
    .from('user_profiles')
    .select('first_name, last_name')
    .eq('user_id', appt.staff_user_id)
    .maybeSingle()

  const tz = appt.organization.timezone ?? PRACTICE_TIMEZONE
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? ''
  const bookingUrl = baseUrl
    ? `${baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`}/portal/book`
    : 'https://app.example.com/portal/book'
  const practitionerName =
    `${staffProfile?.first_name ?? ''} ${staffProfile?.last_name ?? ''}`.trim() ||
    'your EP'

  await sendBookingConfirmationEmail({
    to: appt.client.email,
    firstName: appt.client.first_name ?? 'there',
    practiceName: appt.organization.name,
    practitionerName,
    appointmentType: appt.appointment_type,
    dateLine: formatBookingDateLine(appt.start_at, tz),
    timeLine: formatBookingTimeRange(appt.start_at, appt.end_at, tz),
    location: appt.location,
    bookingUrl,
  })
}

export async function createAppointmentAction(
  input: CreateAppointmentInput,
): Promise<{ error: string | null; id: string | null }> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  const kind = input.kind === 'unavailable' ? 'unavailable' : 'appointment'

  if (kind === 'appointment' && !input.clientId) {
    return { error: 'Client required.', id: null }
  }
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
      client_id: kind === 'appointment' ? input.clientId : null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      appointment_type: input.appointmentType || 'Session',
      kind,
      location: input.location,
      notes: input.notes,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      created_by_role: 'staff',
    })
    .select('id')
    .single()

  if (error) {
    // P1-4: the appointments_no_staff_overlap EXCLUDE constraint rejects a
    // double-booking (exclusion_violation, 23P01). Surface a clean inline
    // message instead of the raw constraint error.
    if (error.code === '23P01') {
      return {
        error: 'That time overlaps an existing booking for this practitioner.',
        id: null,
      }
    }
    return { error: `Failed to create booking: ${error.message}`, id: null }
  }

  // P1-2: email the client their confirmation (best-effort; the booking is
  // already saved). Appointment-kind only — unavailable blocks have no client.
  if (kind === 'appointment') {
    await sendStaffBookingConfirmation(data.id).catch((e) => {
      if (e instanceof EmailConfigError) throw e
      return null
    })
  }

  revalidatePath('/schedule')
  return { error: null, id: data.id }
}

export type RecurringAppointmentsInput = {
  clientId: string | null
  // Concrete per-occurrence start instants, computed by the composer (calendar-
  // unit cadence preserving wall-clock). The action stays a dumb loop-inserter.
  startAtIsos: string[]
  durationMinutes: number
  appointmentType: string
  location: string | null
  notes: string | null
  kind?: 'appointment' | 'unavailable'
}

export type RecurringAppointmentsResult = {
  error: string | null
  created: number
  firstId: string | null
  // Occurrences skipped because they clashed with an existing booking (23P01).
  skipped: string[]
}

/**
 * Book a recurring series (P2-14). Generates CONCRETE appointment rows — one
 * per occurrence — so the EP can later cancel/move a single session of the
 * series (no abstract recurrence rule). Each insert fires the
 * appointment_manage_reminder trigger, so every future appointment-kind
 * instance enqueues its own T-lead reminder automatically.
 *
 * Partial success is intentional: an instance that clashes with an existing
 * booking (the P1-4 appointments_no_staff_overlap EXCLUDE constraint → 23P01)
 * is SKIPPED and reported, not silently dropped and not fatal to the rest. A
 * non-overlap error aborts and returns what was booked so far.
 *
 * No confirmation email is sent for a series (operator decision) — a 12-week
 * series emailing 12 confirmations is spam; the per-session reminders carry the
 * value. A single booking (createAppointmentAction) still confirms.
 */
export async function createRecurringAppointmentsAction(
  input: RecurringAppointmentsInput,
): Promise<RecurringAppointmentsResult> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  const kind = input.kind === 'unavailable' ? 'unavailable' : 'appointment'
  const fail = (error: string): RecurringAppointmentsResult => ({
    error,
    created: 0,
    firstId: null,
    skipped: [],
  })

  if (kind === 'appointment' && !input.clientId) return fail('Client required.')
  if (!input.startAtIsos?.length) return fail('No occurrences to book.')
  if (input.startAtIsos.length > 52) {
    return fail('Too many occurrences (max 52).')
  }
  if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
    return fail('Duration must be positive.')
  }

  const supabase = await createSupabaseServerClient()
  let created = 0
  let firstId: string | null = null
  const skipped: string[] = []

  for (const startIso of input.startAtIsos) {
    const start = new Date(startIso)
    if (Number.isNaN(start.getTime())) {
      skipped.push(startIso)
      continue
    }
    const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000)

    const { data, error } = await supabase
      .from('appointments')
      .insert({
        organization_id: organizationId,
        staff_user_id: userId,
        client_id: kind === 'appointment' ? input.clientId : null,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        appointment_type: input.appointmentType || 'Session',
        kind,
        location: input.location,
        notes: input.notes,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        created_by_role: 'staff',
      })
      .select('id')
      .single()

    if (error) {
      // 23P01 = overlaps an existing booking for this practitioner (P1-4):
      // skip this instance, keep the series going.
      if (error.code === '23P01') {
        skipped.push(startIso)
        continue
      }
      // Anything else aborts — return what we managed so the EP isn't guessing.
      return {
        error: `Stopped after ${created} booked: ${error.message}`,
        created,
        firstId,
        skipped,
      }
    }

    created++
    if (!firstId) firstId = data.id
  }

  revalidatePath('/schedule')
  return { error: null, created, firstId, skipped }
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
      cancelled_by_role: 'staff',
    })
    .eq('id', appointmentId)

  if (error) return { error: `Cancel failed: ${error.message}` }
  revalidatePath('/schedule')
  return { error: null }
}

/**
 * Remove an Unavailable block (admin / meeting / note … kind='unavailable',
 * P1-7) from the schedule (P2-8 review fix). Unlike a client appointment —
 * which cancels, keeping the cancelled record + attribution — an unavailable
 * block is the EP's own time-blocking, so removing it soft-deletes the row: it
 * disappears from the grid instead of lingering as a cancelled block under the
 * "Show cancellations" toggle.
 *
 * Goes through the SECURITY DEFINER soft_delete_unavailable_block RPC: a direct
 * UPDATE deleted_at can't set it because the appointments SELECT policy filters
 * deleted_at IS NULL (the PostgREST re-select 42501 trap). The RPC is scoped to
 * kind='unavailable', so this can never delete a client appointment.
 */
export async function removeUnavailableBlockAction(
  appointmentId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('soft_delete_unavailable_block', {
    p_id: appointmentId,
  })

  if (error) return { error: `Could not remove block: ${error.message}` }
  revalidatePath('/schedule')
  return { error: null }
}

/**
 * Move an appointment along its lifecycle from the schedule popover (P2-8c):
 * mark it completed or a no-show, or reopen a mis-marked one back to confirmed.
 * Mirrors cancelAppointmentAction; cancellation keeps its own action (it
 * carries a reason + actor role). This covers the remaining non-terminal
 * transitions so the lifecycle no longer stalls at 'confirmed' (FM-13).
 *
 * The appointment_manage_reminder trigger (P1-2/P1-3) owns the reminder side
 * effect: it auto-cancels any queued reminder when the status leaves
 * pending/confirmed (so completed/no_show need no manual reminder handling)
 * and re-enqueues on reopen if the appointment is still in the future — so we
 * only set the status + its bookkeeping timestamp here.
 *
 * no_show stamps no_show_marked_at (the column exists for exactly this);
 * 'confirmed' must satisfy appointments_confirmed_fields (confirmed_at NOT
 * NULL), so reopen (re)stamps confirmed_at and clears the stale no_show marker.
 */
export async function setAppointmentStatusAction(
  appointmentId: string,
  status: 'completed' | 'no_show' | 'confirmed',
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const nowIso = new Date().toISOString()
  const patch: {
    status: 'completed' | 'no_show' | 'confirmed'
    no_show_marked_at?: string | null
    confirmed_at?: string
  } =
    status === 'no_show'
      ? { status, no_show_marked_at: nowIso }
      : status === 'completed'
        ? { status, no_show_marked_at: null }
        : { status, confirmed_at: nowIso, no_show_marked_at: null }

  const { error } = await supabase
    .from('appointments')
    .update(patch)
    .eq('id', appointmentId)

  if (error) return { error: `Could not update status: ${error.message}` }
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

  if (error) {
    // P1-4: same double-booking backstop on the drag-move/resize path.
    if (error.code === '23P01') {
      return {
        error: 'That time overlaps an existing booking for this practitioner.',
      }
    }
    return { error: `Update failed: ${error.message}` }
  }
  revalidatePath('/schedule')
  return { error: null }
}

/**
 * The given client's next booked session after `afterIso` (P2-14 popover): the
 * soonest pending/confirmed appointment-kind booking, used to show "Next
 * session · <date>" when the EP opens an appointment. RLS scopes reads to the
 * caller's org. Returns null when the client has nothing further booked.
 */
export async function getClientNextAppointmentAction(
  clientId: string,
  afterIso: string,
): Promise<{ startIso: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('appointments')
    .select('start_at')
    .eq('client_id', clientId)
    .eq('kind', 'appointment')
    .in('status', ['pending', 'confirmed'])
    .is('deleted_at', null)
    .gt('start_at', afterIso)
    .order('start_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return { startIso: data?.start_at ?? null }
}

/**
 * Find the caller's soonest open slot for a given session length (P2-15,
 * Tools → Find next available). Delegates to the staff_next_available_slot RPC,
 * which scans the caller's availability minus closures and existing bookings
 * over a 90-day window and returns the single earliest opening. Read-only.
 */
export async function findNextAvailableSlotAction(
  slotMinutes: number,
): Promise<{ error: string | null; slotStartIso: string | null }> {
  const { userId } = await requireRole(['owner', 'staff'])

  if (!Number.isFinite(slotMinutes) || slotMinutes < 5 || slotMinutes > 240) {
    return { error: 'Invalid session length.', slotStartIso: null }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('staff_next_available_slot', {
    p_staff_user_id: userId,
    p_from: new Date().toISOString(),
    p_slot_minutes: slotMinutes,
  })

  if (error) return { error: error.message, slotStartIso: null }
  // RETURNS TABLE (LIMIT 1) → an array of 0 or 1 rows.
  const row = Array.isArray(data) ? data[0] : null
  return { error: null, slotStartIso: row?.slot_start ?? null }
}

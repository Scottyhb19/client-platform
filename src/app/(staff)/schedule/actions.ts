'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendBookingConfirmationEmail } from '@/lib/email/send-booking-confirmation'
import { sendRescheduleNotificationEmail } from '@/lib/email/send-reschedule-notification'
import { EmailConfigError } from '@/lib/email/client'
import { captureException } from '@/lib/observability/sentry'
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
       organization:organizations(name, timezone, email_notifications_enabled),
       client:clients(first_name, email)`,
    )
    .eq('id', appointmentId)
    .maybeSingle()

  if (!appt || !appt.client?.email || !appt.organization) return
  // P2-5: respect the practice's email toggle — skip the confirmation when off.
  if (!appt.organization.email_notifications_enabled) return

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

/**
 * Email the client that their appointment has moved (deliberate reschedule from
 * the staff schedule). Best-effort; mirrors sendStaffBookingConfirmation's fetch
 * + gating (client email, org email toggle, appointment-kind only). The appt is
 * read AFTER the move, so its start/end are the NEW time; the previous time is
 * passed in for the "was …" line.
 */
async function sendStaffRescheduleNotification(
  appointmentId: string,
  previousStartIso: string | null,
  previousEndIso: string | null,
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { data: appt } = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, appointment_type, location, kind, staff_user_id,
       organization:organizations(name, timezone, email_notifications_enabled),
       client:clients(first_name, email)`,
    )
    .eq('id', appointmentId)
    .maybeSingle()

  // Appointment-kind client bookings only; unavailable blocks have no client.
  if (!appt || appt.kind !== 'appointment') return
  if (!appt.client?.email || !appt.organization) return
  // P2-5: respect the practice's email toggle.
  if (!appt.organization.email_notifications_enabled) return

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

  const previousLine =
    previousStartIso && previousEndIso
      ? `${formatBookingDateLine(previousStartIso, tz)}, ${formatBookingTimeRange(previousStartIso, previousEndIso, tz)}`
      : null

  await sendRescheduleNotificationEmail({
    to: appt.client.email,
    firstName: appt.client.first_name ?? 'there',
    practiceName: appt.organization.name,
    practitionerName,
    appointmentType: appt.appointment_type,
    dateLine: formatBookingDateLine(appt.start_at, tz),
    timeLine: formatBookingTimeRange(appt.start_at, appt.end_at, tz),
    previousLine,
    location: appt.location,
    bookingUrl,
  })
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * Guard that `type` is a live session type of `kind` in the caller's org
 * (P2-12 / FM-16). The composer already constrains to a select of live types;
 * this is the server-side backstop so a stale / renamed / typo'd type can't be
 * written and mislabel the schedule. RLS scopes session_types to the org.
 */
async function isValidAppointmentType(
  supabase: ServerClient,
  type: string,
  kind: 'appointment' | 'unavailable',
): Promise<boolean> {
  const { data } = await supabase
    .from('session_types')
    .select('name')
    .eq('kind', kind)
    .is('deleted_at', null)
  return (data ?? []).some((s) => s.name === type)
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

  const type = input.appointmentType || 'Session'
  if (!(await isValidAppointmentType(supabase, type, kind))) {
    return {
      error: 'Unknown appointment type — pick one from the list.',
      id: null,
    }
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      organization_id: organizationId,
      staff_user_id: userId,
      client_id: kind === 'appointment' ? input.clientId : null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      appointment_type: type,
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
      // P1-3: surface an unexpected confirmation-send throw (booking is saved).
      captureException(e, { where: 'booking-confirm:staff' })
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

  const apptType = input.appointmentType || 'Session'
  if (!(await isValidAppointmentType(supabase, apptType, kind))) {
    return fail('Unknown appointment type.')
  }

  let created = 0
  let firstId: string | null = null
  const skipped: string[] = []

  // One shared id across every occurrence of this series, so the EP can later
  // archive "this occurrence and all later ones" (archive_appointment_and_future).
  // A single booking (createAppointmentAction) never sets it.
  const recurrenceGroupId = crypto.randomUUID()

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
        appointment_type: apptType,
        kind,
        location: input.location,
        notes: input.notes,
        status: 'confirmed',
        confirmed_at: new Date().toISOString(),
        created_by_role: 'staff',
        recurrence_group_id: recurrenceGroupId,
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
  revalidatePath('/dashboard')
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
 * Archive a client appointment created by mistake. Unlike cancellation — which
 * is meaningful history and counts toward the cancellation-rate KPI — an
 * accidental booking should count as nothing at all. Archiving soft-deletes the
 * row (deleted_at), so it vanishes from the grid, dashboard, and analytics and
 * is neither attended nor cancelled.
 *
 * Goes through the SECURITY DEFINER archive_appointment RPC: a direct UPDATE
 * deleted_at trips the appointments deleted_at-IS-NULL SELECT-policy re-select
 * trap (42501). The RPC is scoped to kind='appointment' and also cancels any
 * queued reminder (the reminder trigger does not fire on deleted_at).
 */
export async function archiveAppointmentAction(
  appointmentId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('archive_appointment', {
    p_id: appointmentId,
  })

  if (error) return { error: `Could not archive appointment: ${error.message}` }
  revalidatePath('/schedule')
  revalidatePath('/dashboard')
  return { error: null }
}

/**
 * Archive a recurring occurrence AND every later occurrence in its series
 * (operator request: end a repeat from this session forward, keeping the
 * already-delivered earlier ones). Delegates to archive_appointment_and_future,
 * which soft-deletes the matching kind='appointment' rows and cancels their
 * queued reminders in one transaction. A non-series row archives alone.
 *
 * Returns the count archived so the caller can confirm what happened. Only
 * series booked after the recurrence_group_id migration are linked; older
 * repeats fall back to single-row archive.
 */
export async function archiveAppointmentAndFutureAction(
  appointmentId: string,
): Promise<{ error: string | null; archived: number }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('archive_appointment_and_future', {
    p_id: appointmentId,
  })

  if (error) {
    return { error: `Could not archive series: ${error.message}`, archived: 0 }
  }
  revalidatePath('/schedule')
  revalidatePath('/dashboard')
  return { error: null, archived: typeof data === 'number' ? data : 0 }
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
  // The dashboard's reconcile + today's-sessions panels read this status, so
  // refresh it too — otherwise actioning a past session here leaves the
  // dashboard showing it unchanged on return.
  revalidatePath('/dashboard')
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
  // Deliberate reschedule (the popover move-mode) emails the client their
  // session moved; a drag-move/resize leaves it false and stays silent.
  notifyClient = false,
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

  // Capture the pre-move time for the reschedule email's "was …" line, before
  // the update overwrites it. Only when we're going to notify.
  let previous: { start_at: string; end_at: string } | null = null
  if (notifyClient) {
    const { data } = await supabase
      .from('appointments')
      .select('start_at, end_at')
      .eq('id', appointmentId)
      .maybeSingle()
    previous = data ?? null
  }

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

  // Tell the client their session moved (deliberate reschedule only). Best-
  // effort — the move is already saved, so an email failure isn't fatal.
  if (notifyClient) {
    await sendStaffRescheduleNotification(
      appointmentId,
      previous?.start_at ?? null,
      previous?.end_at ?? null,
    ).catch((e) => {
      if (e instanceof EmailConfigError) throw e
      captureException(e, { where: 'reschedule-notify:staff' })
      return null
    })
  }

  revalidatePath('/schedule')
  // The portal's bookings view reads the same appointment row (force-dynamic),
  // so the new time shows on the client's next load; revalidate keeps it fresh
  // even if that route is ever cached.
  revalidatePath('/portal/book')
  return { error: null }
}

/**
 * The given client's next *actual upcoming* booked session (P2-14 popover): the
 * soonest pending/confirmed appointment-kind booking, used to show "Next
 * session · <date>" when the EP opens an appointment.
 *
 * The anchor is `max(now, afterIso)`, never `afterIso` alone. Opening a session
 * from the past must NOT report "the next one after that past session" — that
 * appointment may itself be long gone, which reads as a lie. Anchoring on now
 * means a past session shows the genuinely-next upcoming booking, while opening
 * a future booking still shows the one that follows it. RLS scopes reads to the
 * caller's org. Returns null when the client has nothing further booked.
 */
export async function getClientNextAppointmentAction(
  clientId: string,
  afterIso: string,
): Promise<{ startIso: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const nowIso = new Date().toISOString()
  const anchorIso = afterIso > nowIso ? afterIso : nowIso

  const { data } = await supabase
    .from('appointments')
    .select('start_at')
    .eq('client_id', clientId)
    .eq('kind', 'appointment')
    .in('status', ['pending', 'confirmed'])
    .is('deleted_at', null)
    .gt('start_at', anchorIso)
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

/**
 * The public, unauthenticated .ics feed URL for a token (P2-15 B). The token
 * IS the credential, so the URL embeds it; keep it private.
 *
 * Origin comes from the actual request host, not a build-time
 * NEXT_PUBLIC_APP_URL — so the link points to wherever the app is running
 * (localhost in dev, the deployed domain in prod), and never to a host where
 * this route isn't deployed yet.
 */
async function calendarFeedUrl(token: string): Promise<string> {
  const h = await headers()
  const host = h.get('host') ?? ''
  const proto =
    h.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https')
  const origin = host ? `${proto}://${host}` : ''
  return `${origin}/api/calendar/${token}`
}

/** The caller's current calendar-feed URL, or null if they have no feed yet. */
export async function getCalendarFeedAction(): Promise<{ url: string | null }> {
  const { userId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  // Owner-only SELECT RLS on calendar_feed_tokens — a co-member can't read it.
  const { data } = await supabase
    .from('calendar_feed_tokens')
    .select('token')
    .eq('staff_user_id', userId)
    .maybeSingle()
  return { url: data?.token ? await calendarFeedUrl(data.token) : null }
}

/** Mint or rotate the caller's feed token; returns the new URL. */
export async function regenerateCalendarFeedAction(): Promise<{
  url: string | null
  error: string | null
}> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('regenerate_calendar_feed_token')
  if (error) return { url: null, error: error.message }
  return {
    url: data ? await calendarFeedUrl(data as string) : null,
    error: null,
  }
}

/** Turn the caller's feed off (the URL stops working). */
export async function revokeCalendarFeedAction(): Promise<{
  error: string | null
}> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('revoke_calendar_feed_token')
  return { error: error?.message ?? null }
}

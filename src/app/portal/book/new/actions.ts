'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendBookingConfirmationEmail } from '@/lib/email/send-booking-confirmation'
import { formatBookingDateLine, formatBookingTimeRange } from './_lib/format'

export interface ConfirmBookingResult {
  error: string | null
}

/**
 * useActionState-compatible signature (prevState, formData) → state.
 * Wraps the underlying confirm logic so a `'use client'` form can read
 * the error inline. Success path redirects (Next throws to navigate);
 * error path returns state with a message.
 */
export async function confirmBookingActionState(
  _prev: ConfirmBookingResult,
  formData: FormData,
): Promise<ConfirmBookingResult> {
  return confirmBookingAction(formData)
}

/**
 * Confirm-and-book server action.
 *
 * Reads the four hidden inputs from the review form, calls the
 * client_book_appointment RPC (which is the source of truth — race guard
 * lives there), then sends the confirmation email. Email failure does NOT
 * roll back the booking — the booking is already in the database, and the
 * client will see it on /portal/book.
 *
 * On the 'slot no longer available' error class, redirects back to step 3
 * with a flag so the UI can surface "another client just took this slot —
 * pick another".
 */
export async function confirmBookingAction(
  formData: FormData,
): Promise<ConfirmBookingResult> {
  const sessionTypeId = formData.get('session_type_id')?.toString() ?? ''
  const staffUserId = formData.get('staff_user_id')?.toString() ?? ''
  const startAt = formData.get('start_at')?.toString() ?? ''
  const endAt = formData.get('end_at')?.toString() ?? ''
  const dayParam = formData.get('day')?.toString() ?? ''

  if (!sessionTypeId || !staffUserId || !startAt || !endAt) {
    return { error: 'Missing booking fields. Try again from the start.' }
  }

  const supabase = await createSupabaseServerClient()

  const { data: appointmentId, error: rpcError } = await supabase.rpc(
    // @ts-expect-error — supabase gen-types introspection cache is lagging
    // behind the deployed migration. Function exists; remove after the
    // next successful `npm run supabase:types`.
    'client_book_appointment',
    {
      p_session_type_id: sessionTypeId,
      p_staff_user_id: staffUserId,
      p_start_at: startAt,
      p_end_at: endAt,
    },
  )

  if (rpcError) {
    if (rpcError.message?.includes('slot no longer available')) {
      // Drop straight back to the time picker for that day with a flag.
      const params = new URLSearchParams({
        step: 'time',
        type: sessionTypeId,
        day: dayParam,
        error: 'slot-taken',
      })
      redirect(`/portal/book/new?${params.toString()}`)
    }
    return { error: rpcError.message }
  }

  if (!appointmentId) {
    return { error: 'Booking did not return an id. Please try again.' }
  }

  // Email the confirmation. Best-effort — failures don't block the booking.
  await sendBookingConfirmationEmailForAppointment(
    appointmentId as string,
  ).catch(() => null)

  revalidatePath('/portal/book')
  redirect('/portal/book?booked=1')
}

/**
 * Looks up the freshly-booked appointment, the client's email/name, the
 * EP's name, and the org's name, then renders + sends the confirmation
 * email. Pulled out of the action body so an email failure can be caught
 * without aborting the redirect.
 */
async function sendBookingConfirmationEmailForAppointment(
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

  if (!appt || !appt.client?.email || !appt.organization) {
    return
  }

  // Staff name is fetched separately so the appointments embed stays
  // unambiguous (both client_id and staff_user_id eventually trace to
  // user-shaped records, and PostgREST's auto-resolution prefers the
  // direct FK chain).
  const { data: staffProfile } = await supabase
    .from('user_profiles')
    .select('first_name, last_name')
    .eq('user_id', appt.staff_user_id)
    .maybeSingle()

  const dateLine = formatBookingDateLine(
    appt.start_at,
    appt.organization.timezone,
  )
  const timeLine = formatBookingTimeRange(
    appt.start_at,
    appt.end_at,
    appt.organization.timezone,
  )

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
    dateLine,
    timeLine,
    location: appt.location,
    bookingUrl,
  })
}

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalEmpty, PortalTop } from '../../_components/PortalTop'
import { StepType } from './_components/StepType'
import { StepDay } from './_components/StepDay'
import { StepTime } from './_components/StepTime'
import { StepReview } from './_components/StepReview'
import { isoDateInTz } from './_lib/format'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import {
  addDaysToIsoDate,
  startOfDayInstant,
  todayIsoInTimeZone,
} from '@/lib/dates'

export const dynamic = 'force-dynamic'

const STEPS = ['type', 'day', 'time', 'review'] as const
type Step = (typeof STEPS)[number]

interface Slot {
  staff_user_id: string
  slot_start: string
  slot_end: string
}

interface SessionType {
  id: string
  name: string
  color: string
  sort_order: number
  default_duration_minutes: number
}

interface Organization {
  id: string
  name: string
  timezone: string
}

/**
 * /portal/book/new — multi-step booking picker.
 *
 * URL-driven so the back button works on mobile. Each step reads its
 * required params from searchParams and renders. The page is one server
 * component that loads all data needed for the current step in one round
 * trip, then dispatches to the right Step* component.
 */
export default async function PortalBookNewPage({
  searchParams,
}: {
  searchParams: Promise<{
    step?: string
    type?: string
    day?: string
    start?: string
    end?: string
    staff?: string
    error?: string
  }>
}) {
  const params = await searchParams
  const step: Step = (STEPS as readonly string[]).includes(params.step ?? '')
    ? (params.step as Step)
    : 'type'

  const supabase = await createSupabaseServerClient()

  // The portal layout already gates on role=client and a clients row, so
  // we only need to resolve the org's display info + the picker data.
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, timezone')
    .maybeSingle()

  if (!org) {
    return (
      <>
        <PortalTop title="Bookings" greeting="Find a time" />
        <PortalEmpty
          title="No organization found"
          message="Your account isn't linked to a practice yet — please contact your EP."
        />
      </>
    )
  }

  const organization: Organization = {
    id: org.id,
    name: org.name,
    // The booking surface is governed by the CLINIC timezone, not the device
    // cookie that drives the portal home's personal "today" (section 7). The
    // slot engine (client_available_slots) generates and buckets slots in the
    // org timezone, so the picker's day labels must match it — otherwise a slot
    // generated as "Sat 9am" clinic-local could mislabel under a travelling
    // client's device "Fri"/"Sun" (FM-9). The home-today (device) vs booking-
    // day (org) split is intentional, locked in P0-2 / Q2. Fall back to the
    // PRACTICE_TIMEZONE constant, not a hardcoded literal. (P2-2.)
    timezone: org.timezone ?? PRACTICE_TIMEZONE,
  }

  // Session types first: the slot length depends on the chosen type's
  // duration (P1-6), so slots can't be fetched until the type is known.
  // Slots come from the SECURITY DEFINER client_available_slots RPC, which
  // already pins to the caller's org via auth.uid().
  //
  // Booking window = whole calendar days in the clinic timezone, NOT a rolling
  // 28×24h UTC span. p_from stays "now" so slots earlier today drop off as the
  // day advances (the past isn't bookable); p_to is midnight at the START of
  // day+28 — a stable whole-day boundary, so the final day's afternoon slots
  // are no longer truncated by the load time-of-day (P2-1 / FM-8). The far edge
  // is independent of when the page loads; the last bookable day is today+27
  // (28 days). Reuses startOfDayInstant, the P0-2 primitive.
  const bookingTz = organization.timezone
  const fromIso = new Date().toISOString()
  const windowEndIso = addDaysToIsoDate(todayIsoInTimeZone(bookingTz), 28)
  const toIso = startOfDayInstant(windowEndIso, bookingTz).toISOString()

  const { data: sessionTypeRows, error: typeErr } = await supabase
    .from('session_types')
    // Appointment-kind only — Unavailable types (admin/meeting/note) are
    // staff-only and never bookable by clients (P1-7). RLS also enforces this.
    .select('id, name, color, sort_order, default_duration_minutes')
    .eq('kind', 'appointment')
    .is('deleted_at', null)
    .order('sort_order')

  const sessionTypes: SessionType[] = (sessionTypeRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    sort_order: s.sort_order,
    default_duration_minutes: s.default_duration_minutes,
  }))

  // Slot length = the selected type's duration. Before a type is chosen (the
  // 'type' step) use the shortest type's duration so the "any times open?"
  // empty-state stays the most permissive (P1-6).
  const slotMinutes =
    (params.type
      ? sessionTypes.find((t) => t.id === params.type)?.default_duration_minutes
      : undefined) ??
    (sessionTypes.length > 0
      ? Math.min(...sessionTypes.map((t) => t.default_duration_minutes))
      : 60)

  const { data: slotRows, error: slotErr } = await supabase.rpc(
    'client_available_slots',
    { p_from: fromIso, p_to: toIso, p_slot_minutes: slotMinutes },
  )

  if (typeErr || slotErr) {
    return (
      <>
        <PortalTop title="Bookings" greeting="Find a time" />
        <PortalEmpty
          title="Couldn't load times"
          message="Something went wrong loading the booking page. Please refresh."
        />
      </>
    )
  }

  const slots: Slot[] = (slotRows ?? []).map((s) => ({
    staff_user_id: s.staff_user_id,
    slot_start: s.slot_start,
    slot_end: s.slot_end,
  }))

  // Validate step prerequisites. Falling through redirects to the earliest
  // unsatisfied step so a stale URL doesn't render a broken state.
  if (step === 'day' && !params.type) {
    redirect('/portal/book/new')
  }
  if (step === 'time' && (!params.type || !params.day)) {
    redirect(`/portal/book/new?step=day&type=${params.type ?? ''}`)
  }
  if (
    step === 'review' &&
    (!params.type || !params.day || !params.start || !params.end || !params.staff)
  ) {
    const back = new URLSearchParams({
      step: 'time',
      type: params.type ?? '',
      day: params.day ?? '',
    })
    redirect(`/portal/book/new?${back.toString()}`)
  }

  // Empty-state shortcut: no slots at all in the next 4 weeks.
  if (slots.length === 0) {
    return (
      <>
        <PortalTop title="Bookings" greeting="Find a time" />
        <PortalEmpty
          title="No times open in the next four weeks"
          message="Your EP hasn't published availability for this window yet. Check back soon, or message them through the portal."
        />
      </>
    )
  }

  if (step === 'type') {
    return <StepType sessionTypes={sessionTypes} />
  }

  if (step === 'day') {
    const selectedType = sessionTypes.find((t) => t.id === params.type)
    if (!selectedType) redirect('/portal/book/new')
    return (
      <StepDay
        sessionType={selectedType!}
        slots={slots}
        timezone={organization.timezone}
      />
    )
  }

  if (step === 'time') {
    const selectedType = sessionTypes.find((t) => t.id === params.type)
    if (!selectedType) redirect('/portal/book/new')

    const dayKey = params.day!
    const slotsForDay = slots.filter(
      (s) => isoDateInTz(s.slot_start, organization.timezone) === dayKey,
    )
    return (
      <StepTime
        sessionType={selectedType!}
        day={dayKey}
        slots={slotsForDay}
        timezone={organization.timezone}
        slotTaken={params.error === 'slot-taken'}
      />
    )
  }

  // step === 'review'
  const selectedType = sessionTypes.find((t) => t.id === params.type)
  if (!selectedType) redirect('/portal/book/new')

  return (
    <StepReview
      sessionType={selectedType!}
      day={params.day!}
      startIso={params.start!}
      endIso={params.end!}
      staffUserId={params.staff!}
      timezone={organization.timezone}
    />
  )
}

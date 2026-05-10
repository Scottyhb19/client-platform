import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalEmpty, PortalTop } from '../../_components/PortalTop'
import { StepType } from './_components/StepType'
import { StepDay } from './_components/StepDay'
import { StepTime } from './_components/StepTime'
import { StepReview } from './_components/StepReview'
import { isoDateInTz } from './_lib/format'

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
        <PortalTop title="Book" greeting="Find a time" />
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
    timezone: org.timezone ?? 'Australia/Sydney',
  }

  // Fetch all session types and the next 4 weeks of slots in parallel.
  // Slots are returned by the SECURITY DEFINER client_available_slots RPC
  // which already pins to the caller's org via auth.uid().
  const fromIso = new Date().toISOString()
  const toIso = new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: sessionTypeRows, error: typeErr },
    { data: slotRows, error: slotErr },
  ] = await Promise.all([
    supabase
      .from('session_types')
      .select('id, name, color, sort_order')
      .is('deleted_at', null)
      .order('sort_order'),
    supabase.rpc('client_available_slots', {
      p_from: fromIso,
      p_to: toIso,
    }),
  ])

  if (typeErr || slotErr) {
    return (
      <>
        <PortalTop title="Book" greeting="Find a time" />
        <PortalEmpty
          title="Couldn't load times"
          message="Something went wrong loading the booking page. Please refresh."
        />
      </>
    )
  }

  const sessionTypes: SessionType[] = (sessionTypeRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    sort_order: s.sort_order,
  }))

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
        <PortalTop title="Book" greeting="Find a time" />
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

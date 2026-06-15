import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import { todayIsoInPracticeTz, startOfDayInstant } from '@/lib/dates'
import {
  WeekView,
  type Appointment,
  type BookingClient,
  type SessionType,
  type ViewMode,
} from './_components/WeekView'
import type { StaffMember } from './_components/PractitionerSidebar'

export const dynamic = 'force-dynamic'

/**
 * 03 Schedule — full-bleed week view.
 *
 * Breaks out of the .page 1200px container on purpose so the grid fills
 * the viewport. The (staff) layout wraps this in `flex-1` which
 * provides the vertical room.
 *
 * Week navigation is URL-driven (?w=YYYY-MM-DD, Monday of target week).
 * Practitioner filter is URL-driven too (?staff=id1,id2).
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    w?: string
    staff?: string
    view?: string
    d?: string
  }>
}) {
  const params = await searchParams
  // "Today" and all week math run in the practice timezone, never the Vercel
  // server's UTC clock — otherwise the highlighted day and the week boundary
  // are wrong for the AU operator every morning between local midnight and
  // ~10–11am (P0-2 / FM-2; the section-6 fix /schedule never adopted).
  const todayIso = todayIsoInPracticeTz()
  // ?d= (a specific date) overrides ?w= (the week's Monday); both are ISO
  // calendar dates. Absent both, default to the week containing today.
  const selectedIso = normaliseIsoDate(params.d)
  const baseIso = selectedIso ?? normaliseIsoDate(params.w) ?? todayIso
  const weekStartIso = isoMonday(baseIso)
  const weekEndIso = addDaysIso(weekStartIso, 7) // exclusive
  const viewMode: ViewMode = params.view === 'day' ? 'day' : 'week'

  const { userId, organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // Load all staff (owner + staff roles) in this org.
  const { data: roleRows } = await supabase
    .from('user_organization_roles')
    .select('user_id, role, user_profiles!inner(first_name, last_name)')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'staff'])

  const staff: StaffMember[] = (roleRows ?? []).map((r) => ({
    user_id: r.user_id,
    first_name: r.user_profiles.first_name,
    last_name: r.user_profiles.last_name,
    is_me: r.user_id === userId,
  }))
  // Sort "me" first, then alphabetical.
  staff.sort((a, b) => {
    if (a.is_me && !b.is_me) return -1
    if (!a.is_me && b.is_me) return 1
    return `${a.first_name} ${a.last_name}`.localeCompare(
      `${b.first_name} ${b.last_name}`,
    )
  })

  // Selection — default to the current user.
  const validStaffIds = new Set(staff.map((s) => s.user_id))
  const requestedIds = (params.staff ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && validStaffIds.has(s))
  const selectedStaffIds =
    requestedIds.length > 0 ? requestedIds : [userId]

  // Work-week definition — distinct day_of_week values from the current
  // user's weekly availability rules. day_of_week uses 0=Mon…6=Sun (see
  // client_portal_functions.sql line 481 for the established convention).
  // Fallback to Mon-Fri when no rules are defined yet.
  const { data: availabilityRows } = await supabase
    .from('availability_rules')
    .select('day_of_week')
    .eq('staff_user_id', userId)
    .eq('recurrence', 'weekly')
    .is('deleted_at', null)

  const availabilityDays = new Set<number>()
  for (const r of availabilityRows ?? []) {
    if (r.day_of_week !== null && r.day_of_week !== undefined) {
      availabilityDays.add(r.day_of_week)
    }
  }
  const workDayIdxs: number[] =
    availabilityDays.size > 0
      ? Array.from(availabilityDays).sort((a, b) => a - b)
      : [0, 1, 2, 3, 4] // Mon-Fri fallback

  // For 1-day view, pick (in priority): the explicitly selected date → today
  // if it falls inside this week → the week's Monday. All comparisons are on
  // ISO calendar dates in the practice tz, so they never drift with the
  // server clock.
  const todayIdx = dayIndexFromMondayIso(weekStartIso, todayIso)
  const todayInWeek = todayIso >= weekStartIso && todayIso < weekEndIso
  const dayViewIdx = selectedIso
    ? dayIndexFromMondayIso(weekStartIso, selectedIso)
    : todayInWeek
      ? todayIdx
      : 0

  const visibleDayIdxs: number[] =
    viewMode === 'day' ? [dayViewIdx] : workDayIdxs

  // Appointments query window — the practice-tz day boundaries of the visible
  // week as real UTC instants. Bounding by the server's local midnight (UTC on
  // Vercel) shifted the window ~10–11h, dropping this week's early-Monday rows
  // while leaking next week's (P0-2 / FM-2).
  const weekStartInstant = startOfDayInstant(weekStartIso, PRACTICE_TIMEZONE)
  const weekEndInstant = startOfDayInstant(weekEndIso, PRACTICE_TIMEZONE)

  const [
    { data, error },
    { data: clientRows },
    { data: sessionTypeRows },
  ] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        `id, start_at, end_at, appointment_type, status, location, notes,
         staff_user_id, created_by_role, cancelled_by_role,
         client:clients(id, first_name, last_name,
           category:client_categories(name))`,
      )
      .gte('start_at', weekStartInstant.toISOString())
      .lt('start_at', weekEndInstant.toISOString())
      .in('staff_user_id', selectedStaffIds)
      .is('deleted_at', null)
      .order('start_at'),
    supabase
      .from('clients')
      .select(
        `id, first_name, last_name,
         category:client_categories(name)`,
      )
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('first_name'),
    supabase
      .from('session_types')
      .select('id, name, color, sort_order')
      .is('deleted_at', null)
      .order('sort_order'),
  ])

  if (error) throw new Error(`Load appointments: ${error.message}`)

  const clients: BookingClient[] = (clientRows ?? []).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    category_name: c.category?.name ?? null,
  }))

  const appointments: Appointment[] = (data ?? [])
    .filter((a) => a.client !== null)
    .map((a) => ({
      id: a.id,
      start_at: a.start_at,
      end_at: a.end_at,
      appointment_type: a.appointment_type,
      status: a.status as Appointment['status'],
      location: a.location,
      notes: a.notes,
      staff_user_id: a.staff_user_id,
      created_by_role:
        a.created_by_role as Appointment['created_by_role'],
      cancelled_by_role:
        a.cancelled_by_role as Appointment['cancelled_by_role'],
      client: {
        id: a.client!.id,
        first_name: a.client!.first_name,
        last_name: a.client!.last_name,
        category_name: a.client!.category?.name ?? null,
      },
    }))

  const sessionTypes: SessionType[] = (sessionTypeRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
  }))

  return (
    <WeekView
      weekStartIso={weekStartIso}
      appointments={appointments}
      clients={clients}
      staff={staff}
      selectedStaffIds={selectedStaffIds}
      sessionTypes={sessionTypes}
      viewMode={viewMode}
      visibleDayIdxs={visibleDayIdxs}
      selectedDateIso={selectedIso}
      todayIso={todayIso}
      nowIso={new Date().toISOString()}
    />
  )
}

function normaliseIsoDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  // Reject impossible calendar dates (e.g. 2026-02-31) by round-tripping
  // through a UTC date — pure calendar math, no timezone involved.
  const probe = new Date(Date.UTC(y!, m! - 1, d!))
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m! - 1 ||
    probe.getUTCDate() !== d
  )
    return null
  return raw
}

/** Monday (ISO) of the week containing the given ISO date (Mon-first). */
function isoMonday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  const dow = date.getUTCDay() // 0=Sun … 6=Sat
  const offset = dow === 0 ? -6 : 1 - dow
  date.setUTCDate(date.getUTCDate() + offset)
  return isoOf(date)
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  date.setUTCDate(date.getUTCDate() + days)
  return isoOf(date)
}

/** Whole days (0–6 within a week) from the week's Monday to the given date. */
function dayIndexFromMondayIso(mondayIso: string, iso: string): number {
  return Math.floor((isoToUtcMs(iso) - isoToUtcMs(mondayIso)) / 86_400_000)
}

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

function isoOf(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

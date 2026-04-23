import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
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
  const selectedDate = parseOptionalIsoDate(params.d)
  // ?d= overrides ?w= (so clicking a date always realigns the week).
  const weekStart = selectedDate
    ? mondayOfWeek(selectedDate)
    : resolveWeekStart(params.w)
  const weekEnd = addDays(weekStart, 7) // exclusive
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

  // For 1-day view, pick (in priority): the explicitly selected date
  // (shows whatever is inside the rolodex circle) → today if within this
  // week → the week's Monday as a final fallback.
  const todayDate = new Date()
  const todayIdx = dayIdxMonBased(todayDate)
  const todayInWeek =
    sameCalendarDay(todayDate, weekStart) ||
    (todayDate > weekStart && todayDate < weekEnd)
  const dayViewIdx = selectedDate
    ? dayIdxMonBased(selectedDate)
    : todayInWeek
      ? todayIdx
      : 0

  const visibleDayIdxs: number[] =
    viewMode === 'day' ? [dayViewIdx] : workDayIdxs

  const [
    { data, error },
    { data: clientRows },
    { data: sessionTypeRows },
  ] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        `id, start_at, end_at, appointment_type, status, location, notes,
         staff_user_id,
         client:clients(id, first_name, last_name,
           category:client_categories(name))`,
      )
      .gte('start_at', weekStart.toISOString())
      .lt('start_at', weekEnd.toISOString())
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

  const now = new Date()
  return (
    <WeekView
      weekStartIso={toIsoDate(weekStart)}
      appointments={appointments}
      clients={clients}
      staff={staff}
      selectedStaffIds={selectedStaffIds}
      sessionTypes={sessionTypes}
      viewMode={viewMode}
      visibleDayIdxs={visibleDayIdxs}
      selectedDateIso={selectedDate ? toIsoDate(selectedDate) : null}
      todayIso={toIsoDate(now)}
      nowIso={now.toISOString()}
    />
  )
}

function parseOptionalIsoDate(raw: string | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1)
  return Number.isNaN(date.getTime()) ? null : date
}

function dayIdxMonBased(d: Date): number {
  return (d.getDay() + 6) % 7 // Mon=0 … Sun=6
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Returns the Monday of the target week. If ?w=YYYY-MM-DD is given,
 * snap to the Monday of that week.
 */
function resolveWeekStart(raw: string | undefined): Date {
  const base = raw ? parseIsoDate(raw) : new Date()
  return mondayOfWeek(base)
}

function mondayOfWeek(d: Date): Date {
  const day = d.getDay() // 0 = Sun, 1 = Mon, …
  const offset = day === 0 ? -6 : 1 - day
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset)
  m.setHours(0, 0, 0, 0)
  return m
}

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

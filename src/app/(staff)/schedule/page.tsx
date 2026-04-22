import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  WeekView,
  type Appointment,
  type BookingClient,
} from './_components/WeekView'

export const dynamic = 'force-dynamic'

/**
 * 03 Schedule — full-bleed week view.
 *
 * Breaks out of the .page 1200px container on purpose so the grid fills
 * the viewport. The (staff) layout wraps this in `flex-1` which
 * provides the vertical room.
 *
 * Week navigation is URL-driven (?w=YYYY-MM-DD, Monday of target week)
 * so bookmarks + back/forward work cleanly.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>
}) {
  const params = await searchParams
  const weekStart = resolveWeekStart(params.w)
  const weekEnd = addDays(weekStart, 7) // exclusive

  const supabase = await createSupabaseServerClient()
  const [{ data, error }, { data: clientRows }] = await Promise.all([
    supabase
      .from('appointments')
      .select(
        `id, start_at, end_at, appointment_type, status, location, notes,
         client:clients(id, first_name, last_name,
           category:client_categories(name))`,
      )
      .gte('start_at', weekStart.toISOString())
      .lt('start_at', weekEnd.toISOString())
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
      client: {
        id: a.client!.id,
        first_name: a.client!.first_name,
        last_name: a.client!.last_name,
        category_name: a.client!.category?.name ?? null,
      },
    }))

  const now = new Date()
  return (
    <WeekView
      weekStartIso={toIsoDate(weekStart)}
      appointments={appointments}
      clients={clients}
      todayIso={toIsoDate(now)}
      nowIso={now.toISOString()}
    />
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

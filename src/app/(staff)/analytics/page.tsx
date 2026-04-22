import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  AnalyticsView,
  type AnalyticsAppointment,
  type AnalyticsClient,
} from './_components/AnalyticsView'

export const dynamic = 'force-dynamic'

/**
 * 06 Analytics.
 *
 * Fetches ~12 months of appointments + all clients once; the client
 * component slices client-side by the selected 7d / 30d / 12m range.
 * A solo-EP caseload tops out around a few hundred appointments per
 * year, so a single fetch is cheap and the UX is snappier than
 * re-fetching on every range change.
 */
export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient()

  const yearAgo = new Date()
  yearAgo.setMonth(yearAgo.getMonth() - 12)
  yearAgo.setHours(0, 0, 0, 0)

  const [{ data: appts, error: apptErr }, { data: cls }] = await Promise.all([
    supabase
      .from('appointments')
      .select('id, start_at, end_at, appointment_type, status')
      .gte('start_at', yearAgo.toISOString())
      .is('deleted_at', null)
      .order('start_at'),
    supabase
      .from('clients')
      .select(
        `id, archived_at, created_at,
         category:client_categories(name)`,
      )
      .is('deleted_at', null),
  ])

  if (apptErr) throw new Error(`Load appointments: ${apptErr.message}`)

  const appointments: AnalyticsAppointment[] = (appts ?? []).map((a) => ({
    id: a.id,
    start_at: a.start_at,
    end_at: a.end_at,
    appointment_type: a.appointment_type,
    status: a.status,
  }))

  const clients: AnalyticsClient[] = (cls ?? []).map((c) => ({
    id: c.id,
    category_name: c.category?.name ?? null,
    archived_at: c.archived_at,
    created_at: c.created_at,
  }))

  return <AnalyticsView appointments={appointments} clients={clients} />
}

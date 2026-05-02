import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  loadPublicationsForClient,
  loadTestHistoryForClient,
} from '@/lib/testing'
import { PortalEmpty, PortalTop } from '../_components/PortalTop'
import { ReportsTabs } from './_components/ReportsTabs'
import { DataView } from './_components/DataView'
import { LegacyView, type LegacyReport } from './_components/LegacyView'

export const dynamic = 'force-dynamic'

type ActiveTab = 'data' | 'files'

export default async function PortalReportsPage(props: {
  searchParams: Promise<{ tab?: string }>
}) {
  const sp = await props.searchParams
  const active: ActiveTab = sp.tab === 'files' ? 'files' : 'data'

  const supabase = await createSupabaseServerClient()

  // The portal layout already gates auth + role, but the page needs the
  // client.id and organization_id to drive the loaders. Re-resolve here
  // rather than threading through context — this is a single round-trip
  // alongside the data load.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: client } = await supabase
    .from('clients')
    .select('id, organization_id')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!client) redirect('/welcome')

  if (active === 'data') {
    // Load both halves in parallel — RLS scopes test_results to the
    // client's own published rows; loadPublicationsForClient filters to
    // live publications. DataView handles its own empty state (catches
    // both "no captures yet" and "everything is hidden").
    const [history, publications] = await Promise.all([
      loadTestHistoryForClient(supabase, client.organization_id, client.id),
      loadPublicationsForClient(supabase, client.id),
    ])

    return (
      <>
        <PortalTop title="Reports" greeting="Shared by your EP" />
        <ReportsTabs active={active} />
        <DataView history={history} publications={publications} />
      </>
    )
  }

  // Files tab — the legacy HTML report flow. RLS: clients see reports
  // where is_published=true AND it's their row.
  const { data: legacy } = await supabase
    .from('reports')
    .select('id, title, report_type, test_date, published_at')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('test_date', { ascending: false })

  const reports: LegacyReport[] = legacy ?? []

  return (
    <>
      <PortalTop title="Reports" greeting="Shared by your EP" />
      <ReportsTabs active={active} />
      {reports.length === 0 ? (
        <PortalEmpty
          title="No files yet"
          message="When your EP shares an assessment file or summary, it will land here."
        />
      ) : (
        <LegacyView reports={reports} />
      )}
    </>
  )
}

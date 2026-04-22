import { ChevronRight } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalEmpty, PortalTop } from '../_components/PortalTop'

export const dynamic = 'force-dynamic'

export default async function PortalReportsPage() {
  const supabase = await createSupabaseServerClient()

  // RLS: clients see reports where is_published=true AND it's their row.
  const { data: reports } = await supabase
    .from('reports')
    .select('id, title, report_type, test_date, published_at')
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('test_date', { ascending: false })

  return (
    <>
      <PortalTop title="Reports" greeting="Shared by your EP" />
      {!reports || reports.length === 0 ? (
        <PortalEmpty
          title="No reports yet"
          message="Your EP will publish assessment results, testing summaries and program reviews here."
        />
      ) : (
        <div style={{ padding: '0 16px' }}>
          {reports.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                background: '#fff',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 10,
                marginBottom: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '.88rem' }}>
                  {r.title}
                </div>
                <div
                  style={{
                    fontSize: '.74rem',
                    color: 'var(--color-muted)',
                    marginTop: 2,
                  }}
                >
                  {formatShort(r.test_date)} · {r.report_type}
                </div>
              </div>
              <ChevronRight
                size={16}
                aria-hidden
                style={{ color: 'var(--color-muted)' }}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function formatShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

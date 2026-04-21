import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function SessionBuilderPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>
}) {
  const { id, dayId } = await params

  const supabase = await createSupabaseServerClient()
  const { data: day } = await supabase
    .from('program_days')
    .select(
      `id, day_label, day_of_week, sort_order,
       program_week:program_weeks(
         week_number,
         program:programs(id, name, client_id)
       )`,
    )
    .eq('id', dayId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!day || day.program_week?.program?.client_id !== id) notFound()

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <Link
          href={`/clients/${id}/program`}
          aria-label="Back to program calendar"
          style={{
            color: 'var(--color-text-light)',
            padding: 6,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            09 Session Builder · {day.program_week?.program?.name} · Week{' '}
            {day.program_week?.week_number} · Day {day.day_label}
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.9rem',
              margin: 0,
              letterSpacing: '-.01em',
            }}
          >
            Session Builder
          </h1>
        </div>
      </div>

      <section
        className="card"
        style={{ padding: '32px 28px', textAlign: 'center' }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1.2rem',
            color: 'var(--color-charcoal)',
            marginBottom: 6,
          }}
        >
          Session Builder lands next
        </div>
        <p
          style={{
            fontSize: '.92rem',
            lineHeight: 1.6,
            margin: '0 auto',
            maxWidth: 520,
            color: 'var(--color-text-light)',
          }}
        >
          Dark slab exercise cards with superset spines, set-level editing, and
          a right panel for Notes / Reports / Library. The crown jewel — getting
          obsessive care in the next commit.
        </p>
      </section>
    </div>
  )
}

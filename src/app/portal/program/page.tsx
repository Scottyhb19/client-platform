import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalTop, PortalEmpty } from '../_components/PortalTop'

export const dynamic = 'force-dynamic'

export default async function PortalProgramPage() {
  const supabase = await createSupabaseServerClient()

  const { data: program } = await supabase
    .from('programs')
    .select(
      `id, name, duration_weeks, start_date,
       program_weeks(id, week_number)`,
    )
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  if (!program || !program.program_weeks?.length) {
    return (
      <>
        <PortalTop title="Program" greeting="Your block overview" />
        <PortalEmpty
          title="No active program"
          message="Your EP hasn't published a program yet. Check back soon."
        />
      </>
    )
  }

  const now = new Date()
  const start = program.start_date ? new Date(program.start_date) : null
  const weeks = [...program.program_weeks].sort(
    (a, b) => b.week_number - a.week_number,
  )

  return (
    <>
      <PortalTop
        title="Program"
        greeting={program.name}
      />
      <div style={{ padding: '0 16px' }}>
        {weeks.map((w) => {
          const isCurrent =
            start !== null &&
            (() => {
              const wkStart = new Date(start)
              wkStart.setDate(wkStart.getDate() + (w.week_number - 1) * 7)
              const wkEnd = new Date(wkStart)
              wkEnd.setDate(wkEnd.getDate() + 7)
              return now >= wkStart && now < wkEnd
            })()
          const isComplete =
            start !== null &&
            (() => {
              const wkEnd = new Date(start)
              wkEnd.setDate(wkEnd.getDate() + w.week_number * 7)
              return now >= wkEnd
            })()
          return (
            <div
              key={w.id}
              style={{
                background: '#fff',
                border: `1px solid ${
                  isCurrent ? 'var(--color-primary)' : 'var(--color-border-subtle)'
                }`,
                borderRadius: 10,
                padding: '14px 16px',
                marginBottom: 8,
                boxShadow: isCurrent ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '1rem',
                }}
              >
                Week {w.week_number}
                {isCurrent && ' — Current'}
                {isComplete && !isCurrent && ' — Complete'}
              </div>
              <div
                style={{
                  fontSize: '.78rem',
                  color: 'var(--color-text-light)',
                  marginTop: 2,
                }}
              >
                {isCurrent
                  ? 'In progress'
                  : isComplete
                    ? 'Done'
                    : 'Upcoming'}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

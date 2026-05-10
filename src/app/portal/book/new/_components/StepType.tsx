import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { StepNav } from './StepNav'

interface SessionType {
  id: string
  name: string
  color: string
}

/**
 * Step 1 of the booking picker — pick a session type. Each type renders
 * as a portal-card with a 4px left-border tinted by the type's display
 * colour (mirrors the visual language of the staff schedule view).
 *
 * Tapping a card advances to the day picker. The chosen type is carried
 * forward in the URL.
 */
export function StepType({
  sessionTypes,
}: {
  sessionTypes: SessionType[]
}) {
  return (
    <>
      <StepNav backHref="/portal/book" title="What kind of session?" stepIndex={1} />
      <div style={{ padding: '4px 16px 24px' }}>
        {sessionTypes.map((t) => (
          <Link
            key={t.id}
            href={`/portal/book/new?step=day&type=${t.id}`}
            className="portal-card is-compact"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px 16px 16px 18px',
              marginBottom: 8,
              textDecoration: 'none',
              color: 'inherit',
              borderLeft: `4px solid ${t.color}`,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1rem',
                color: 'var(--color-charcoal)',
                flex: 1,
              }}
            >
              {t.name}
            </div>
            <ChevronRight
              size={18}
              strokeWidth={2}
              aria-hidden
              style={{ color: 'var(--color-text-light)' }}
            />
          </Link>
        ))}
      </div>
    </>
  )
}

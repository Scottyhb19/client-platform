import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

/**
 * Shared header for each booking-picker step. Back arrow + step label +
 * progress indicator (e.g. "Step 2 of 4"). Renders above the step body.
 *
 * Back link is a plain anchor (not router.back()) so the URL is stable —
 * mobile back-gesture navigates to the previous URL state, not a stack
 * entry that may have been replaced by a redirect.
 */
export function StepNav({
  backHref,
  title,
  stepIndex,
  totalSteps = 4,
}: {
  backHref: string | null
  title: string
  stepIndex: number
  totalSteps?: number
}) {
  return (
    <div
      style={{
        padding: '14px 16px 8px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {backHref ? (
        <Link
          href={backHref}
          aria-label="Back"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            marginLeft: -6,
            color: 'var(--color-charcoal)',
            textDecoration: 'none',
          }}
        >
          <ChevronLeft size={20} strokeWidth={2.25} aria-hidden />
        </Link>
      ) : (
        <span style={{ width: 36, height: 36, marginLeft: -6 }} />
      )}
      <div style={{ flex: 1 }}>
        <div className="portal-eyebrow">
          Step {stepIndex} of {totalSteps}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.4rem',
            lineHeight: 1.1,
            letterSpacing: '-.01em',
            marginTop: 2,
          }}
        >
          {title}
        </div>
      </div>
    </div>
  )
}

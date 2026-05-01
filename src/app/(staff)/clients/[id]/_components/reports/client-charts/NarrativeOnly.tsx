'use client'

/**
 * NarrativeOnly — client view for metrics where the schema says
 * `client_view_chart === 'narrative_only'`. The clinician's framing
 * text carries the message; the value sits as supporting detail.
 *
 * Used for biomarkers, body composition, pain scales — metrics where
 * a chart would mislead more than inform (a 5/10 pain score is not a
 * "metric to chart"; it's a state to interpret).
 */

import type { MetricHistory } from '@/lib/testing/loader-types'

interface NarrativeOnlyProps {
  metric: MetricHistory
  thisSessionValues: { left?: number; right?: number; unilateral?: number }
  /** Optional clinician framing text — appears above the value. When
   *  null, only the value renders. */
  framingText: string | null
}

export function NarrativeOnly({
  metric,
  thisSessionValues,
  framingText,
}: NarrativeOnlyProps) {
  const unit = metric.settings.unit
  const isBilateral = metric.settings.side_left_right
  const values: Array<{ side: 'Left' | 'Right' | null; value: number }> = []
  if (isBilateral) {
    if (thisSessionValues.left !== undefined) {
      values.push({ side: 'Left', value: thisSessionValues.left })
    }
    if (thisSessionValues.right !== undefined) {
      values.push({ side: 'Right', value: thisSessionValues.right })
    }
  } else if (thisSessionValues.unilateral !== undefined) {
    values.push({ side: null, value: thisSessionValues.unilateral })
  }

  return (
    <div
      style={{
        padding: 16,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {framingText && framingText.trim() !== '' && (
        <p
          style={{
            margin: 0,
            fontSize: '.92rem',
            lineHeight: 1.5,
            color: 'var(--color-text)',
            fontStyle: 'italic',
          }}
        >
          {framingText}
        </p>
      )}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        {values.map((v) => (
          <div
            key={v.side ?? 'uni'}
            style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            {v.side && (
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '.62rem',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                  fontWeight: 700,
                }}
              >
                {v.side}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 4,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '1.4rem',
                  color: 'var(--color-charcoal)',
                  lineHeight: 1,
                }}
              >
                {v.value}
              </span>
              <span
                style={{
                  fontSize: '.78rem',
                  color: 'var(--color-text-light)',
                  fontWeight: 500,
                }}
              >
                {unit}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

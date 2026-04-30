'use client'

/**
 * Shared chart primitives.
 *
 * - Series colour palette (warm, restrained — no rainbow)
 * - Common Recharts axis/grid styling
 * - Tooltip wrapper that uses design-system tokens
 *
 * Per docs/decisions.md D-001: Recharts is the chart library; design-
 * system conformance comes from prop overrides. No raw hex outside this
 * file (and even here, the values trace back to globals.css tokens —
 * Recharts can't read CSS variables for stroke/fill so we mirror the
 * resolved values here).
 */

import type { ReactNode } from 'react'

// Mirror of design tokens for Recharts (which doesn't read CSS variables
// for fill/stroke colours). Update both places if a token changes.
export const CHART_COLOURS = {
  primary: '#1e1a18', // --color-primary
  muted: '#7a7166', // --color-muted
  textLight: '#5e5852', // --color-text-light
  border: '#cfc7bd', // --color-border
  borderSubtle: '#d6cfc6', // --color-border-subtle
  surface: '#f7f4f0', // --color-surface
  warning: '#e8a317', // --color-warning
  alert: '#d64045', // --color-alert
  accent: '#2db24c', // --color-accent
}

/** Quiet palette for combined-metric (KOOS-style) charts. */
export const SERIES_PALETTE: readonly string[] = [
  '#1e1a18',
  '#5e5852',
  '#7a7166',
  '#9a8e7e',
  '#b9a98c',
  '#1e1a18',
  '#5e5852',
] as const

/** L/R colour pairing for bilateral charts. Left = primary (decisive),
 *  Right = muted (softer) — both readable at glance, distinguishable
 *  without colour-coding by which-is-better. */
export const BILATERAL_COLOURS = {
  left: CHART_COLOURS.primary,
  right: CHART_COLOURS.muted,
} as const

// Recharts tick props are SVG text attrs, not CSSProperties — keep loose.
export const AXIS_TICK_STYLE = {
  fontSize: 11,
  fontFamily: 'var(--font-sans)',
  fill: CHART_COLOURS.textLight,
} as const

export const TOOLTIP_WRAPPER_STYLE: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${CHART_COLOURS.borderSubtle}`,
  borderRadius: 8,
  padding: 0,
  outline: 'none',
}

export const TOOLTIP_LABEL_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  fontWeight: 600,
  color: CHART_COLOURS.primary,
}

export const TOOLTIP_ITEM_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  color: CHART_COLOURS.textLight,
}

/** Recharts Tooltip formatter signature, accepting the v2.x ValueType. */
export type TooltipFormatterReturn = readonly [string, string]
export type TooltipFormatterValue = string | number | Array<string | number> | undefined

/** Generic chart-frame with title + meta + chart body. Used by every
 *  chart card so spacing stays consistent. */
export function ChartFrame({
  children,
  ariaLabel,
}: {
  children: ReactNode
  ariaLabel: string
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{
        width: '100%',
        height: 220,
      }}
    >
      {children}
    </div>
  )
}

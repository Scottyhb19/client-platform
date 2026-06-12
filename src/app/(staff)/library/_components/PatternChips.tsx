'use client'

import type { Pattern } from '../types'

/**
 * Movement-pattern filter chips. Two selection modes (G-7, program-engine
 * polish pass 2026-06-12, Q-C sign-off):
 *
 *   - single-select (default): "All patterns" + one-at-a-time — the
 *     standalone library page.
 *   - multiSelect: toggle membership, no "All" chip (the host renders its
 *     own reset affordance) — the session builder's Library tab, where
 *     filters AND across categories and OR within (Q3 sign-off
 *     2026-05-07).
 *
 * `dense` tightens padding/size for the session builder's 320px right
 * panel; the visual treatment (.chip / .chip.on) is shared either way.
 */
type SingleSelectProps = {
  multiSelect?: false
  selectedId: string | null
  onChange: (id: string | null) => void
}

type MultiSelectProps = {
  multiSelect: true
  selectedIds: ReadonlySet<string>
  onToggle: (id: string) => void
}

type PatternChipsProps = {
  patterns: Pattern[]
  dense?: boolean
} & (SingleSelectProps | MultiSelectProps)

const DENSE_CHIP: React.CSSProperties = {
  padding: '3px 9px',
  fontSize: '.7rem',
}

export function PatternChips(props: PatternChipsProps) {
  const { patterns, dense } = props
  if (patterns.length === 0) return null

  const chipStyle = dense ? DENSE_CHIP : undefined
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    gap: dense ? 4 : 6,
    flexWrap: 'wrap',
  }

  if (props.multiSelect) {
    return (
      <div role="group" aria-label="Filter by movement pattern" style={rowStyle}>
        {patterns.map((p) => {
          const on = props.selectedIds.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              className={`chip ${on ? 'on' : ''}`}
              style={chipStyle}
              onClick={() => props.onToggle(p.id)}
            >
              {p.name}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div style={rowStyle}>
      <button
        type="button"
        className={`chip ${!props.selectedId ? 'on' : ''}`}
        style={chipStyle}
        onClick={() => props.onChange(null)}
      >
        All patterns
      </button>
      {patterns.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`chip ${props.selectedId === p.id ? 'on' : ''}`}
          style={chipStyle}
          onClick={() => props.onChange(props.selectedId === p.id ? null : p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  )
}

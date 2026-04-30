'use client'

/**
 * TimeWindowSelector — global time-window dropdown shown at the top of
 * a category view. Per docs/decisions.md D-001 (Q8): one selector applies
 * to every chart in the current category. Default: "All time".
 */

import { TIME_WINDOW_OPTIONS, type TimeWindow } from './helpers'

interface TimeWindowSelectorProps {
  value: TimeWindow
  onChange: (next: TimeWindow) => void
}

export function TimeWindowSelector({ value, onChange }: TimeWindowSelectorProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: '.76rem',
        color: 'var(--color-text-light)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontSize: '.66rem',
          color: 'var(--color-muted)',
        }}
      >
        Window
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TimeWindow)}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '.82rem',
          padding: '6px 10px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-input)',
          background: '#fff',
          color: 'var(--color-text)',
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {TIME_WINDOW_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

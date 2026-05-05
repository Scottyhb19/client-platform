'use client'

import type { Pattern } from '../types'

interface PatternChipsProps {
  patterns: Pattern[]
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function PatternChips({
  patterns,
  selectedId,
  onChange,
}: PatternChipsProps) {
  if (patterns.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <button
        type="button"
        className={`chip ${!selectedId ? 'on' : ''}`}
        onClick={() => onChange(null)}
      >
        All patterns
      </button>
      {patterns.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`chip ${selectedId === p.id ? 'on' : ''}`}
          onClick={() => onChange(selectedId === p.id ? null : p.id)}
        >
          {p.name}
        </button>
      ))}
    </div>
  )
}

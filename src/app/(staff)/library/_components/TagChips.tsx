'use client'

import type { Tag } from '../types'

interface TagChipsProps {
  tags: Tag[]
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function TagChips({ tags, selectedId, onChange }: TagChipsProps) {
  if (tags.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((t) => {
        const on = selectedId === t.id
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(on ? null : t.id)}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-chip)',
              border: '1px solid var(--color-border-subtle)',
              background: on ? 'rgba(45,178,76,.1)' : '#fff',
              color: on ? 'var(--color-primary)' : 'var(--color-text-light)',
              fontSize: '.74rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            #{t.name}
          </button>
        )
      })}
    </div>
  )
}

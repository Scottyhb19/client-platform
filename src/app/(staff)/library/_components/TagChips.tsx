'use client'

import type { Tag } from '../types'

/**
 * Exercise-tag filter chips. Two selection modes (G-7, program-engine
 * polish pass 2026-06-12, Q-C sign-off): single-select (default, the
 * standalone library) and multiSelect (the session builder's Library
 * tab — OR within tags, AND'd against the pattern filter per Q3
 * sign-off 2026-05-07). `dense` tightens sizing for the 320px panel.
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

type TagChipsProps = {
  tags: Tag[]
  dense?: boolean
} & (SingleSelectProps | MultiSelectProps)

export function TagChips(props: TagChipsProps) {
  const { tags, dense } = props
  if (tags.length === 0) return null

  const isOn = (id: string) =>
    props.multiSelect ? props.selectedIds.has(id) : props.selectedId === id

  const handleClick = (id: string) => {
    if (props.multiSelect) props.onToggle(id)
    else props.onChange(props.selectedId === id ? null : id)
  }

  return (
    <div
      role="group"
      aria-label="Filter by tag"
      style={{ display: 'flex', gap: dense ? 4 : 6, flexWrap: 'wrap' }}
    >
      {tags.map((t) => {
        const on = isOn(t.id)
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => handleClick(t.id)}
            style={{
              padding: dense ? '3px 9px' : '4px 10px',
              borderRadius: 'var(--radius-chip)',
              border: '1px solid var(--color-border-subtle)',
              background: on ? 'var(--color-accent-soft)' : 'var(--color-card)',
              color: on ? 'var(--color-primary)' : 'var(--color-text-light)',
              fontSize: dense ? '.7rem' : '.74rem',
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

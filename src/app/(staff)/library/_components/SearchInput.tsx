'use client'

import { Search } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  /** Tightened sizing for the session builder's 320px right panel
   *  (G-7, program-engine polish pass 2026-06-12). */
  dense?: boolean
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search exercises by name…',
  ariaLabel = 'Search exercises',
  dense = false,
}: SearchInputProps) {
  return (
    <div style={{ position: 'relative' }}>
      <Search
        size={dense ? 14 : 16}
        aria-hidden
        style={{
          position: 'absolute',
          left: dense ? 10 : 12,
          top: dense ? 9 : 11,
          color: 'var(--color-muted)',
        }}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={{
          width: '100%',
          height: dense ? 32 : 38,
          padding: dense ? '0 12px 0 30px' : '0 12px 0 36px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-input)',
          background: 'var(--color-card)',
          fontFamily: 'var(--font-sans)',
          fontSize: dense ? '.82rem' : '.86rem',
          outline: 'none',
          color: 'var(--color-text)',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

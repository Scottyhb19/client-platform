'use client'

import { Search } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search exercises by name…',
  ariaLabel = 'Search exercises',
}: SearchInputProps) {
  return (
    <div style={{ position: 'relative' }}>
      <Search
        size={16}
        aria-hidden
        style={{
          position: 'absolute',
          left: 12,
          top: 11,
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
          height: 38,
          padding: '0 12px 0 36px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-input)',
          background: '#fff',
          fontFamily: 'var(--font-sans)',
          fontSize: '.86rem',
          outline: 'none',
          color: 'var(--color-text)',
        }}
      />
    </div>
  )
}

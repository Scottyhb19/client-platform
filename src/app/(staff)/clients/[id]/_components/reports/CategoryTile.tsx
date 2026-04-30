'use client'

/**
 * CategoryTile — top-level summary tile for one category. Renders inside
 * the CategoryGrid. Click to drill into CategoryDetail.
 */

import { ChevronRight } from 'lucide-react'
import type { CategorySummary } from '@/lib/testing/loader-types'
import { timeAgo } from './helpers'

interface CategoryTileProps {
  summary: CategorySummary
  onOpen: (categoryId: string) => void
}

export function CategoryTile({ summary, onOpen }: CategoryTileProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(summary.category_id)}
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        textAlign: 'left',
        padding: 18,
        background: 'var(--color-card)',
        cursor: 'pointer',
        transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
        // Override card's default border colour on hover via inline.
        // Lifted purely by border colour change — design system says no
        // shadow change on hover for cards.
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-charcoal)',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}
        >
          {summary.category_name}
        </div>
        <ChevronRight
          size={16}
          aria-hidden
          style={{ color: 'var(--color-muted)', flexShrink: 0, marginTop: 2 }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          marginTop: 6,
          fontSize: '.76rem',
          color: 'var(--color-text-light)',
        }}
      >
        <span>
          <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            {summary.test_count}
          </strong>{' '}
          test{summary.test_count === 1 ? '' : 's'}
        </span>
        <span style={{ color: 'var(--color-muted)' }}>·</span>
        <span>
          <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>
            {summary.total_sessions}
          </strong>{' '}
          session{summary.total_sessions === 1 ? '' : 's'}
        </span>
      </div>
      <div
        style={{
          fontSize: '.72rem',
          color: 'var(--color-muted)',
          marginTop: 2,
        }}
      >
        last {timeAgo(summary.most_recent_conducted_at)}
      </div>
    </button>
  )
}

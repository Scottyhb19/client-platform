'use client'

/**
 * CategoryGrid — top-level view of the Reports tab.
 *
 * Per docs/decisions.md D-002 (Q5 sign-off): folder model. The Reports
 * tab opens to a grid of category tiles; click a tile to drill into the
 * CategoryDetail view.
 *
 * Empty-state message arrives via the EmptyState component when no test
 * sessions have been captured for this client yet.
 */

import type { CategorySummary } from '@/lib/testing/loader-types'
import { CategoryTile } from './CategoryTile'

interface CategoryGridProps {
  categories: CategorySummary[]
  onOpenCategory: (categoryId: string) => void
}

export function CategoryGrid({ categories, onOpenCategory }: CategoryGridProps) {
  if (categories.length === 0) {
    return <EmptyState />
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 14,
      }}
    >
      {categories.map((c) => (
        <CategoryTile
          key={c.category_id}
          summary={c}
          onOpen={onOpenCategory}
        />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="card"
      style={{
        padding: '40px 32px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        No test sessions yet
      </div>
      <p
        style={{
          fontSize: '.86rem',
          lineHeight: 1.55,
          margin: '0 auto',
          maxWidth: 460,
        }}
      >
        Capture force plate, dynamometry, range of motion, and patient-reported
        outcomes here. Cards and charts populate as sessions accumulate.
      </p>
    </div>
  )
}

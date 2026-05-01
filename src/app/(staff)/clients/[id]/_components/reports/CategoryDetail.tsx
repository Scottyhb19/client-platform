'use client'

/**
 * CategoryDetail — drilled-in view inside a single category.
 *
 * Per docs/decisions.md D-002: subcategory chips at the top to filter,
 * per-test cards below. Time-window selector applies globally to every
 * chart in this view.
 */

import { ChevronLeft } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  ClientTestHistory,
  PublicationRow,
  TestHistory,
} from '@/lib/testing/loader-types'
import { TestCard } from './TestCard'
import { TimeWindowSelector } from './TimeWindowSelector'
import { sortTestsByRecency, type TimeWindow } from './helpers'

interface CategoryDetailProps {
  clientId: string
  categoryName: string
  tests: TestHistory[]
  history: ClientTestHistory
  publications: PublicationRow[]
  window: TimeWindow
  onWindowChange: (next: TimeWindow) => void
  onBack: () => void
}

export function CategoryDetail({
  clientId,
  categoryName,
  tests,
  history,
  publications,
  window,
  onWindowChange,
  onBack,
}: CategoryDetailProps) {
  const subcategories = useMemo(() => {
    const seen = new Map<string, string>()
    for (const t of tests) {
      if (!seen.has(t.subcategory_id)) {
        seen.set(t.subcategory_id, t.subcategory_name)
      }
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [tests])

  const [activeSub, setActiveSub] = useState<string | 'all'>('all')

  const filteredTests = useMemo(() => {
    const list = activeSub === 'all'
      ? tests
      : tests.filter((t) => t.subcategory_id === activeSub)
    return sortTestsByRecency(list)
  }, [tests, activeSub])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button
            type="button"
            onClick={onBack}
            className="btn ghost"
            style={{ padding: '4px 8px', gap: 4 }}
          >
            <ChevronLeft size={14} aria-hidden /> All categories
          </button>
          <span style={{ color: 'var(--color-muted)' }}>·</span>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.1rem',
              color: 'var(--color-charcoal)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            {categoryName}
          </h2>
        </div>
        <TimeWindowSelector value={window} onChange={onWindowChange} />
      </div>

      {subcategories.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          <SubChip
            label="All"
            active={activeSub === 'all'}
            onClick={() => setActiveSub('all')}
          />
          {subcategories.map((s) => (
            <SubChip
              key={s.id}
              label={s.name}
              active={activeSub === s.id}
              onClick={() => setActiveSub(s.id)}
            />
          ))}
        </div>
      )}

      {filteredTests.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 28,
            textAlign: 'center',
            color: 'var(--color-text-light)',
            fontSize: '.86rem',
          }}
        >
          No tests in this filter.
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: 14,
          }}
        >
          {filteredTests.map((t) => (
            <TestCard
              key={t.test_id}
              clientId={clientId}
              test={t}
              history={history}
              publications={publications}
              window={window}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SubChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={active ? 'chip on' : 'chip'}
      style={{ fontSize: '.74rem' }}
    >
      {label}
    </button>
  )
}

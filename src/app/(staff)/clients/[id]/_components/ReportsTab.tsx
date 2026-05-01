'use client'

/**
 * ReportsTab — staff-side view of structured test history for one client.
 *
 * Phase D.2 IA per docs/decisions.md D-002 (folder model):
 *   /clients/[id]?tab=reports
 *     → CategoryGrid (default)
 *       → CategoryDetail (drilled in, subcategory chips + per-test cards)
 *
 * The "+ Record test" button is always visible in the header. After a
 * successful capture the modal triggers router.refresh() so the new
 * session lands in the right test card without a manual reload.
 *
 * Charts use Recharts via the per-metric ChartFactory; baseline +
 * %-change colour-coded by direction_of_good lives in MetricBadge.
 *
 * Per CLAUDE.md the runtime-config rule: rendering hints are read
 * exclusively via resolveMetricSettingsBulk (called server-side inside
 * loadTestHistoryForClient) — this client component never reads schema
 * defaults or overrides directly.
 */

import { GitCompare, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { TestCaptureModal } from './TestCaptureModal'
import { CategoryDetail } from './reports/CategoryDetail'
import { CategoryGrid } from './reports/CategoryGrid'
import { ComparisonOverlay } from './reports/ComparisonOverlay'
import type { TimeWindow } from './reports/helpers'
import type {
  BatteryRow,
  CatalogCategory,
  ClientTestHistory,
  LastUsedBatteryHint,
  PublicationRow,
} from '@/lib/testing/loader-types'

interface ReportsTabProps {
  clientId: string
  clientName: string
  catalog: CatalogCategory[]
  batteries: BatteryRow[]
  lastUsedBattery: LastUsedBatteryHint | null
  testHistory: ClientTestHistory
  publications: PublicationRow[]
}

export function ReportsTab({
  clientId,
  clientName,
  catalog,
  batteries,
  lastUsedBattery,
  testHistory,
  publications,
}: ReportsTabProps) {
  const router = useRouter()
  const history = testHistory ?? { tests: [], categories: [], sessions: [] }
  const cat = catalog ?? []
  const bs = batteries ?? []

  const [open, setOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [window, setWindow] = useState<TimeWindow>('all')

  // Compare button only makes sense when there's at least 2 sessions to
  // diff between. With 0 it's nonsense; with 1 the table is just one
  // column. Hide the button until there's something to compare.
  const canCompare = history.sessions.length >= 2

  const selectedCategory =
    selectedCategoryId !== null
      ? history.categories.find((c) => c.category_id === selectedCategoryId) ?? null
      : null

  const testsForCategory =
    selectedCategoryId !== null
      ? history.tests.filter((t) => t.category_id === selectedCategoryId)
      : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.25rem',
              color: 'var(--color-charcoal)',
              letterSpacing: '-0.01em',
            }}
          >
            Test history
          </div>
          {history.categories.length > 0 && (
            <div
              style={{
                fontSize: '.78rem',
                color: 'var(--color-text-light)',
                marginTop: 2,
              }}
            >
              {history.categories.length} categor
              {history.categories.length === 1 ? 'y' : 'ies'} ·{' '}
              {history.tests.length} test
              {history.tests.length === 1 ? '' : 's'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canCompare && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setCompareOpen(true)}
              style={{ fontSize: '.82rem' }}
            >
              <GitCompare size={14} aria-hidden /> Compare sessions
            </button>
          )}
          <button
            type="button"
            className="btn outline"
            onClick={() => setOpen(true)}
            style={{ fontSize: '.82rem' }}
          >
            <Plus size={14} aria-hidden /> Record test
          </button>
        </div>
      </header>

      {selectedCategory && selectedCategoryId !== null ? (
        <CategoryDetail
          clientId={clientId}
          categoryName={selectedCategory.category_name}
          tests={testsForCategory}
          history={history}
          publications={publications ?? []}
          window={window}
          onWindowChange={setWindow}
          onBack={() => setSelectedCategoryId(null)}
        />
      ) : (
        <CategoryGrid
          categories={history.categories}
          onOpenCategory={(id) => setSelectedCategoryId(id)}
        />
      )}

      <TestCaptureModal
        open={open}
        onClose={() => setOpen(false)}
        clientId={clientId}
        catalog={cat}
        batteries={bs}
        lastUsedBattery={lastUsedBattery}
        onCaptured={() => {
          // Refresh server data so the new session shows up in test history.
          router.refresh()
        }}
      />

      {compareOpen && (
        <ComparisonOverlay
          history={history}
          clientName={clientName}
          onClose={() => setCompareOpen(false)}
        />
      )}
    </div>
  )
}

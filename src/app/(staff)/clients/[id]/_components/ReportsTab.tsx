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
import { BatteryView } from './reports/battery/BatteryView'
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

/**
 * Phase M view-mode toggle (Q-M1 (a) — placed inside the Reports tab
 * header, left of the existing buttons).
 *
 * - `'category'` — existing CategoryGrid → CategoryDetail flow.
 *   Regression-safe default; matches pre-Phase-M behaviour.
 * - `'battery'` — new BatteryView showing one card per saved battery.
 *
 * Per Q-M2 (a) + Q-M3 (c) the state is per-surface and session-only;
 * no URL param, no localStorage, no DB. DB-backed persistence is on
 * the bench for a premortem reconsideration (see project memory
 * `project_premortem_view_mode_persistence`).
 */
type ViewMode = 'category' | 'battery'

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
  const [viewMode, setViewMode] = useState<ViewMode>('category')

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
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />
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

      {viewMode === 'battery' ? (
        <BatteryView
          clientId={clientId}
          history={history}
          batteries={bs}
          publications={publications ?? []}
        />
      ) : selectedCategory && selectedCategoryId !== null ? (
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

/**
 * Segmented control for the Reports tab's Category ↔ Test battery
 * view-mode toggle. File-local — Phase M's Q-M7 refinement removed the
 * rail's equivalent toggle, so there's no second consumer to lift this
 * to a shared component for.
 *
 * Pattern mirrors the comparison toggles in `ReportsPanel.tsx` and
 * `PortalTestCard.tsx`: warm-grey pill background, white active segment
 * with a single subtle shadow per the design system.
 */
function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode
  onChange: (next: ViewMode) => void
}) {
  return (
    <div
      role="group"
      aria-label="View mode"
      style={{
        display: 'inline-flex',
        background: '#EDE8E2',
        borderRadius: 999,
        padding: 2,
        flexShrink: 0,
      }}
    >
      <ModeSegment
        active={mode === 'category'}
        onClick={() => onChange('category')}
        label="Category"
      />
      <ModeSegment
        active={mode === 'battery'}
        onClick={() => onChange('battery')}
        label="Test battery"
      />
    </div>
  )
}

function ModeSegment({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? '#fff' : 'transparent',
        border: 'none',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: '.78rem',
        fontWeight: 600,
        cursor: 'pointer',
        color: active ? 'var(--color-charcoal)' : 'var(--color-muted)',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
        whiteSpace: 'nowrap',
        transition:
          'background 150ms cubic-bezier(0.4, 0, 0.2, 1), color 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {label}
    </button>
  )
}

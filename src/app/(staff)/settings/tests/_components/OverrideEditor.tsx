'use client'

import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type {
  CatalogCategory,
  CatalogTest,
  OverrideMapEntry,
} from '@/lib/testing'
import { OverrideRow } from './OverrideRow'
import {
  resetOverrideRowAction,
  setOverrideFieldAction,
  type OverrideField,
} from '../actions'

const STORAGE_KEY = 'settings.tests.openCategories.v1'

interface Props {
  catalog: CatalogCategory[]
  initialOverrides: Record<string, OverrideMapEntry>
  disabled: string[]
}

export function OverrideEditor({ catalog, initialOverrides, disabled }: Props) {
  const [overrides, setOverrides] =
    useState<Record<string, OverrideMapEntry>>(initialOverrides)
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)
  const [, startTransition] = useTransition()

  // Hydrate openCats from localStorage on mount. Multi-open by design
  // (Q1 sign-off): the EP can compare overrides across categories at once.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) setOpenCats(new Set(arr))
      }
    } catch {
      // Bad JSON or no storage — leave empty.
    }
    setHydrated(true)
  }, [])

  // Persist after every change. Skip the first effect run before hydration
  // so we don't overwrite a real user state with the default empty set.
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...openCats]))
    } catch {
      // ignore
    }
  }, [openCats, hydrated])

  const disabledSet = new Set(disabled)

  function toggleCat(catId: string) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  // Per-cell save: optimistic update, rollback on server error.
  async function handleSetField(
    testId: string,
    metricId: string,
    field: OverrideField,
    value: string | null,
  ) {
    const key = `${testId}::${metricId}`
    const before = overrides[key] ?? null
    const baseline: OverrideMapEntry = before ?? {
      direction_of_good: null,
      default_chart: null,
      comparison_mode: null,
      client_portal_visibility: null,
      client_view_chart: null,
    }
    const next: OverrideMapEntry = { ...baseline, [field]: value }
    const isAllNull =
      next.direction_of_good === null &&
      next.default_chart === null &&
      next.comparison_mode === null &&
      next.client_portal_visibility === null &&
      next.client_view_chart === null

    setOverrides((prev) => {
      const out = { ...prev }
      if (isAllNull) delete out[key]
      else out[key] = next
      return out
    })

    startTransition(async () => {
      const res = await setOverrideFieldAction(testId, metricId, field, value)
      if (res.error) {
        setOverrides((prev) => {
          const rolled = { ...prev }
          if (before) rolled[key] = before
          else delete rolled[key]
          return rolled
        })
        alert(res.error)
      }
    })
  }

  async function handleResetRow(testId: string, metricId: string) {
    const key = `${testId}::${metricId}`
    const before = overrides[key]
    if (!before) return

    setOverrides((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })

    startTransition(async () => {
      const res = await resetOverrideRowAction(testId, metricId)
      if (res.error) {
        setOverrides((prev) => ({ ...prev, [key]: before }))
        alert(res.error)
      }
    })
  }

  return (
    <div style={{ padding: '14px 22px 18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {catalog.map((cat) => {
          const overrideCount = countOverridesIn(cat, overrides)
          const open = openCats.has(cat.id)
          return (
            <div
              key={cat.id}
              style={{
                background: '#fff',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 10,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => toggleCat(cat.id)}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'transparent',
                  border: 'none',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '.95rem',
                  }}
                >
                  {open ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronRight size={16} />
                  )}
                  {cat.name}
                </span>
                <span
                  style={{
                    fontSize: '.74rem',
                    color: overrideCount
                      ? 'var(--color-primary)'
                      : 'var(--color-text-light)',
                    fontWeight: overrideCount ? 600 : 500,
                  }}
                >
                  {overrideCount
                    ? `${overrideCount} override${overrideCount === 1 ? '' : 's'}`
                    : 'no overrides'}
                </span>
              </button>

              {open && (
                <div
                  style={{
                    borderTop: '1px solid var(--color-border-subtle)',
                    padding: '14px 16px',
                    background: 'var(--color-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                  }}
                >
                  {cat.subcategories.map((sub) => (
                    <div key={sub.id}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          fontSize: '.72rem',
                          textTransform: 'uppercase',
                          letterSpacing: '.06em',
                          color: 'var(--color-muted)',
                          marginBottom: 6,
                        }}
                      >
                        {sub.name}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        {sub.tests.map((test) => (
                          <TestBlock
                            key={test.id}
                            test={test}
                            disabledByOrg={disabledSet.has(test.id)}
                            overrides={overrides}
                            onSetField={handleSetField}
                            onResetRow={handleResetRow}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TestBlock({
  test,
  disabledByOrg,
  overrides,
  onSetField,
  onResetRow,
}: {
  test: CatalogTest
  disabledByOrg: boolean
  overrides: Record<string, OverrideMapEntry>
  onSetField: (
    testId: string,
    metricId: string,
    field: OverrideField,
    value: string | null,
  ) => Promise<void>
  onResetRow: (testId: string, metricId: string) => Promise<void>
}) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '10px 12px',
        opacity: disabledByOrg ? 0.55 : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: '.88rem',
            color: 'var(--color-charcoal)',
          }}
        >
          {test.name}
          {test.is_custom && (
            <span
              className="tag new"
              style={{ marginLeft: 8, verticalAlign: 'middle' }}
            >
              Custom
            </span>
          )}
          {disabledByOrg && (
            <span
              className="tag overdue"
              style={{ marginLeft: 8, verticalAlign: 'middle' }}
            >
              Disabled
            </span>
          )}
        </div>
        {test.notes && (
          <div
            style={{
              fontSize: '.72rem',
              color: 'var(--color-text-light)',
              fontStyle: 'italic',
            }}
          >
            {test.notes}
          </div>
        )}
      </div>

      {/* Column headers — same grid as OverrideRow so they line up. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '180px repeat(5, 1fr) 36px',
          gap: 8,
          padding: '0 8px 4px',
          fontFamily: 'var(--font-display)',
          fontSize: '.66rem',
          fontWeight: 700,
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
        }}
      >
        <span></span>
        <span>Direction</span>
        <span>Chart</span>
        <span>Compare</span>
        <span>Visibility</span>
        <span>Client view</span>
        <span></span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {test.metrics.map((metric) => (
          <OverrideRow
            key={metric.id}
            testId={test.id}
            metric={metric}
            override={overrides[`${test.id}::${metric.id}`] ?? null}
            onSetField={onSetField}
            onResetRow={onResetRow}
          />
        ))}
      </div>
    </div>
  )
}

function countOverridesIn(
  cat: CatalogCategory,
  overrides: Record<string, OverrideMapEntry>,
): number {
  let n = 0
  for (const sub of cat.subcategories) {
    for (const test of sub.tests) {
      for (const metric of test.metrics) {
        if (overrides[`${test.id}::${metric.id}`]) n++
      }
    }
  }
  return n
}

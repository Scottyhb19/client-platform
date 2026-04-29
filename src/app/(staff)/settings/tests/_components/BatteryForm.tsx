'use client'

import { useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import type {
  CatalogCategory,
  CatalogMetric,
  CatalogTest,
  EditableBatteryRow,
} from '@/lib/testing'
import {
  createBatteryAction,
  updateBatteryAction,
  type BatteryMetricKey,
} from '../actions'

interface PropsCreate {
  mode: 'create'
  catalog: CatalogCategory[]
  onCancel: () => void
  onSaved: () => void
  initialBattery?: undefined
}

interface PropsEdit {
  mode: 'edit'
  initialBattery: EditableBatteryRow
  catalog: CatalogCategory[]
  onCancel: () => void
  onSaved: () => void
}

type Props = PropsCreate | PropsEdit

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-input)',
  background: '#fff',
  fontFamily: 'var(--font-sans)',
  fontSize: '.84rem',
  color: 'var(--color-text)',
  outline: 'none',
}

/** Map<test_id::metric_id, BatteryMetricKey> — keyed for fast tick/untick. */
type SelectedMap = Map<string, BatteryMetricKey>

function metricKey(testId: string, metricId: string): string {
  return `${testId}::${metricId}`
}

function buildInitialSelection(
  battery: EditableBatteryRow | undefined,
): SelectedMap {
  if (!battery) return new Map()
  const map: SelectedMap = new Map()
  for (const k of battery.metric_keys) {
    map.set(metricKey(k.test_id, k.metric_id), {
      test_id: k.test_id,
      metric_id: k.metric_id,
      side: k.side ?? null,
    })
  }
  return map
}

export function BatteryForm(props: Props) {
  const { mode, catalog, onCancel, onSaved } = props
  const initialBattery = mode === 'edit' ? props.initialBattery : undefined

  const [name, setName] = useState(initialBattery?.name ?? '')
  const [description, setDescription] = useState(
    initialBattery?.description ?? '',
  )
  const [isActive, setIsActive] = useState(initialBattery?.is_active ?? true)
  const [selected, setSelected] = useState<SelectedMap>(() =>
    buildInitialSelection(initialBattery),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggleMetric(testId: string, metricId: string) {
    const k = metricKey(testId, metricId)
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(k)) next.delete(k)
      else next.set(k, { test_id: testId, metric_id: metricId, side: null })
      return next
    })
  }

  function removeMetric(testId: string, metricId: string) {
    const k = metricKey(testId, metricId)
    setSelected((prev) => {
      const next = new Map(prev)
      next.delete(k)
      return next
    })
  }

  // Lookup table for the selected pills row — gives us labels per test_id.
  const metricLabelLookup = useMemo(() => {
    const map = new Map<string, { metricLabel: string; testName: string }>()
    for (const cat of catalog) {
      for (const sub of cat.subcategories) {
        for (const test of sub.tests) {
          for (const metric of test.metrics) {
            map.set(metricKey(test.id, metric.id), {
              metricLabel: metric.label,
              testName: test.name,
            })
          }
        }
      }
    }
    return map
  }, [catalog])

  async function handleSubmit() {
    setError(null)
    if (!name.trim()) return setError('Name is required.')
    if (selected.size === 0) return setError('Pick at least one metric.')

    const metricKeys: BatteryMetricKey[] = Array.from(selected.values())

    startTransition(async () => {
      if (mode === 'create') {
        const res = await createBatteryAction({
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          is_active: isActive,
          metric_keys: metricKeys,
        })
        if (res.error) {
          setError(res.error)
          return
        }
        onSaved()
      } else {
        const res = await updateBatteryAction(props.initialBattery.id, {
          name: name.trim(),
          description: description.trim() ? description.trim() : null,
          is_active: isActive,
          metric_keys: metricKeys,
        })
        if (res.error) {
          setError(res.error)
          return
        }
        onSaved()
      }
    })
  }

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-primary)',
        borderRadius: 10,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.95rem',
        }}
      >
        {mode === 'create' ? 'New battery' : `Edit ${initialBattery?.name}`}
      </div>

      {error && (
        <div
          style={{
            padding: '8px 12px',
            background: 'rgba(214, 64, 69, 0.06)',
            border: '1px solid rgba(214, 64, 69, 0.25)',
            borderRadius: 6,
            color: 'var(--color-alert)',
            fontSize: '.82rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Identity */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr',
          gap: 14,
        }}
      >
        <FieldLabel label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ACL Phase 2 reassessment"
            style={inputStyle}
            disabled={pending}
            maxLength={200}
          />
        </FieldLabel>
        <FieldLabel label="Status">
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              fontSize: '.84rem',
              color: 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={pending}
            />
            Active (appears in capture picker)
          </label>
        </FieldLabel>
      </div>

      <FieldLabel
        label="Description"
        hint="Optional. A one-line note for your own reference."
      >
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. ACL graft 12-week reassessment battery"
          style={inputStyle}
          disabled={pending}
          maxLength={2000}
        />
      </FieldLabel>

      {/* Picker */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.72rem',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              color: 'var(--color-muted)',
            }}
          >
            Metrics ({selected.size})
          </div>
          {selected.size > 0 && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setSelected(new Map())}
              disabled={pending}
              style={{ fontSize: '.74rem' }}
            >
              Clear all
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <SelectedPills
            selected={selected}
            labelLookup={metricLabelLookup}
            onRemove={removeMetric}
            disabled={pending}
          />
        )}

        <MetricPicker
          catalog={catalog}
          selected={selected}
          onToggle={toggleMetric}
          disabled={pending}
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 4,
          borderTop: '1px solid var(--color-border-subtle)',
          paddingTop: 14,
        }}
      >
        <button
          type="button"
          className="btn outline"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={handleSubmit}
          disabled={pending}
        >
          {pending
            ? 'Saving…'
            : mode === 'create'
              ? 'Create battery'
              : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function SelectedPills({
  selected,
  labelLookup,
  onRemove,
  disabled,
}: {
  selected: SelectedMap
  labelLookup: Map<string, { metricLabel: string; testName: string }>
  onRemove: (testId: string, metricId: string) => void
  disabled: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '8px 10px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        marginBottom: 8,
        maxHeight: 96,
        overflowY: 'auto',
      }}
    >
      {Array.from(selected.values()).map((k) => {
        const labels = labelLookup.get(metricKey(k.test_id, k.metric_id))
        return (
          <button
            key={`${k.test_id}::${k.metric_id}`}
            type="button"
            onClick={() => onRemove(k.test_id, k.metric_id)}
            disabled={disabled}
            title="Remove"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 8px 3px 10px',
              border: '1px solid var(--color-primary)',
              borderRadius: 999,
              background: 'var(--color-primary)',
              color: '#fff',
              fontSize: '.74rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <span>
              {labels
                ? `${labels.testName} · ${labels.metricLabel}`
                : `${k.test_id} / ${k.metric_id}`}
            </span>
            <X size={12} />
          </button>
        )
      })}
    </div>
  )
}

function MetricPicker({
  catalog,
  selected,
  onToggle,
  disabled,
}: {
  catalog: CatalogCategory[]
  selected: SelectedMap
  onToggle: (testId: string, metricId: string) => void
  disabled: boolean
}) {
  const [search, setSearch] = useState('')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())

  const searchLower = search.trim().toLowerCase()
  const filtering = searchLower.length > 0

  function matchesMetric(test: CatalogTest, metric: CatalogMetric): boolean {
    if (!filtering) return true
    return (
      metric.label.toLowerCase().includes(searchLower) ||
      test.name.toLowerCase().includes(searchLower) ||
      metric.id.toLowerCase().includes(searchLower) ||
      test.id.toLowerCase().includes(searchLower)
    )
  }

  function toggleCat(catId: string) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  function countMatches(cat: CatalogCategory): {
    selectedCount: number
    matchCount: number
  } {
    let selectedCount = 0
    let matchCount = 0
    for (const sub of cat.subcategories) {
      for (const test of sub.tests) {
        for (const metric of test.metrics) {
          if (selected.has(metricKey(test.id, metric.id))) selectedCount++
          if (matchesMetric(test, metric)) matchCount++
        }
      }
    }
    return { selectedCount, matchCount }
  }

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        padding: 12,
        maxHeight: 460,
        overflowY: 'auto',
      }}
    >
      {/* Search */}
      <div
        style={{
          position: 'relative',
          marginBottom: 12,
        }}
      >
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-text-light)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search metrics, tests, or ids…"
          style={{ ...inputStyle, paddingLeft: 32 }}
          disabled={disabled}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {catalog.map((cat) => {
          const { selectedCount, matchCount } = countMatches(cat)
          if (filtering && matchCount === 0) return null
          // When searching, force-open every category so all matches are visible.
          const open = filtering ? true : openCats.has(cat.id)
          return (
            <div
              key={cat.id}
              style={{
                background: '#fff',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => !filtering && toggleCat(cat.id)}
                disabled={disabled || filtering}
                style={{
                  display: 'flex',
                  width: '100%',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'transparent',
                  border: 'none',
                  padding: '10px 14px',
                  cursor: filtering ? 'default' : 'pointer',
                  textAlign: 'left',
                }}
              >
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '.9rem',
                  }}
                >
                  {open ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  {cat.name}
                </span>
                <span
                  style={{
                    fontSize: '.72rem',
                    color: selectedCount
                      ? 'var(--color-primary)'
                      : 'var(--color-text-light)',
                    fontWeight: selectedCount ? 600 : 500,
                  }}
                >
                  {selectedCount > 0
                    ? `${selectedCount} selected`
                    : 'none selected'}
                </span>
              </button>

              {open && (
                <div
                  style={{
                    borderTop: '1px solid var(--color-border-subtle)',
                    padding: '10px 14px',
                    background: 'var(--color-surface)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  {cat.subcategories.map((sub) => {
                    const visibleTests = sub.tests.filter((test) =>
                      test.metrics.some((m) => matchesMetric(test, m)),
                    )
                    if (visibleTests.length === 0) return null
                    return (
                      <div key={sub.id}>
                        <div
                          style={{
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: '.66rem',
                            textTransform: 'uppercase',
                            letterSpacing: '.06em',
                            color: 'var(--color-muted)',
                            marginBottom: 4,
                          }}
                        >
                          {sub.name}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                          }}
                        >
                          {visibleTests.map((test) => {
                            const visibleMetrics = test.metrics.filter((m) =>
                              matchesMetric(test, m),
                            )
                            return (
                              <div key={test.id}>
                                <div
                                  style={{
                                    fontSize: '.78rem',
                                    fontWeight: 600,
                                    color: 'var(--color-charcoal)',
                                    padding: '4px 4px 2px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                >
                                  {test.name}
                                  {test.is_custom && (
                                    <span
                                      className="tag new"
                                      style={{ fontSize: '.6rem' }}
                                    >
                                      Custom
                                    </span>
                                  )}
                                </div>
                                {visibleMetrics.map((metric) => {
                                  const k = metricKey(test.id, metric.id)
                                  const checked = selected.has(k)
                                  return (
                                    <label
                                      key={metric.id}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                        padding: '5px 4px 5px 16px',
                                        cursor: 'pointer',
                                        background: checked
                                          ? 'rgba(45, 178, 76, 0.06)'
                                          : 'transparent',
                                        borderRadius: 4,
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          onToggle(test.id, metric.id)
                                        }
                                        disabled={disabled}
                                      />
                                      <span
                                        style={{
                                          fontSize: '.82rem',
                                          color: 'var(--color-text)',
                                        }}
                                      >
                                        {metric.label}
                                      </span>
                                      <span
                                        style={{
                                          fontSize: '.7rem',
                                          color: 'var(--color-text-light)',
                                        }}
                                      >
                                        {metric.unit}
                                        {metric.side_left_right ? ' · L/R' : ''}
                                      </span>
                                    </label>
                                  )
                                })}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FieldLabel({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.66rem',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          color: 'var(--color-muted)',
        }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--color-alert)', marginLeft: 4 }}>*</span>
        )}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: '.7rem', color: 'var(--color-text-light)' }}>
          {hint}
        </div>
      )}
    </div>
  )
}

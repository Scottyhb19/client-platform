'use client'

/**
 * TestCaptureModal — three-state capture flow per brief §4.1.
 *
 *   pick → enter → confirm
 *
 * The picker offers (a) category accordions, (b) a saved-battery
 * dropdown with a per-client "last used" hint, and (c) a flat search
 * box. The enter step renders one input row per (test, metric, side),
 * with bilateral metrics shown as Left | Right side by side. The
 * confirm step is a quiet summary with a date/time + free-text notes
 * and a single Save button.
 *
 * Submission goes through createTestSessionAction which validates each
 * value via validateMetricValue (hard bounds reject; soft bounds raise
 * a confirm dialog). The atomic create_test_session RPC writes the
 * session and N results in one transaction under the caller's RLS.
 *
 * Per /docs/testing-module-schema.md §14 Q4 — capture writes; the
 * publish flow is a Phase D follow-up. For now there's a single Save
 * button (= "save and publish later"). Phase D will add the "review
 * for publishing" branch.
 */

import { ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react'
import {
  useMemo,
  useState,
  useTransition,
  type CSSProperties,
} from 'react'
import {
  createTestSessionAction,
  type TestResultInput,
} from '../test-actions'
import type {
  BatteryRow,
  CatalogCategory,
  CatalogMetric,
  LastUsedBatteryHint,
} from '@/lib/testing'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = 'pick' | 'enter' | 'confirm'

interface SelectedMetric {
  key: string // testId::metricId::side  (side = '' for non-bilateral)
  testId: string
  metricId: string
  testName: string
  metricLabel: string
  unit: string
  inputType: 'decimal' | 'integer' | 'text' | 'file'
  side: 'left' | 'right' | null
  isCustom: boolean
}

interface CaptureProps {
  open: boolean
  onClose: () => void
  clientId: string
  catalog: CatalogCategory[]
  batteries: BatteryRow[]
  lastUsedBattery: LastUsedBatteryHint | null
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

function selectionKey(
  testId: string,
  metricId: string,
  side: 'left' | 'right' | null,
): string {
  return `${testId}::${metricId}::${side ?? ''}`
}

function metricToSelections(
  testId: string,
  testName: string,
  isCustom: boolean,
  metric: CatalogMetric,
): SelectedMetric[] {
  if (metric.input_type === 'file') return [] // File uploads aren't captured here
  if (metric.side_left_right) {
    return (['left', 'right'] as const).map((side) => ({
      key: selectionKey(testId, metric.id, side),
      testId,
      metricId: metric.id,
      testName,
      metricLabel: metric.label,
      unit: metric.unit,
      inputType: metric.input_type,
      side,
      isCustom,
    }))
  }
  return [
    {
      key: selectionKey(testId, metric.id, null),
      testId,
      metricId: metric.id,
      testName,
      metricLabel: metric.label,
      unit: metric.unit,
      inputType: metric.input_type,
      side: null,
      isCustom,
    },
  ]
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function TestCaptureModal({
  open,
  onClose,
  clientId,
  catalog,
  batteries,
  lastUsedBattery,
}: CaptureProps) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [selected, setSelected] = useState<SelectedMetric[]>([])
  const [appliedBatteryId, setAppliedBatteryId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [conductedAt, setConductedAt] = useState<string>(() => localNowIso())
  const [notes, setNotes] = useState<string>('')
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [showWarnings, setShowWarnings] = useState(false)
  const [isSaving, startSave] = useTransition()

  // Index by metric id → metric (for battery resolution).
  const metricIndex = useMemo(() => buildMetricIndex(catalog), [catalog])

  function reset() {
    setPhase('pick')
    setSelected([])
    setAppliedBatteryId(null)
    setValues({})
    setConductedAt(localNowIso())
    setNotes('')
    setSearchTerm('')
    setError(null)
    setWarnings([])
    setShowWarnings(false)
  }

  function close() {
    reset()
    onClose()
  }

  function toggleMetric(
    testId: string,
    testName: string,
    isCustom: boolean,
    metric: CatalogMetric,
  ) {
    const additions = metricToSelections(testId, testName, isCustom, metric)
    setSelected((prev) => {
      const additionKeys = new Set(additions.map((a) => a.key))
      const allPresent = additions.every((a) => prev.some((p) => p.key === a.key))
      if (allPresent) return prev.filter((p) => !additionKeys.has(p.key))
      // Add the missing ones; preserve existing order
      const missing = additions.filter((a) => !prev.some((p) => p.key === a.key))
      return [...prev, ...missing]
    })
    setAppliedBatteryId(null) // user-edited; battery hint cleared
  }

  function applyBattery(batteryId: string) {
    const battery = batteries.find((b) => b.id === batteryId)
    if (!battery) return

    const next: SelectedMetric[] = []
    for (const k of battery.metric_keys) {
      const m = metricIndex.get(`${k.test_id}::${k.metric_id}`)
      if (!m) continue
      // Battery side may target one specific side; null/undefined means
      // "both for bilateral, or just the non-sided one."
      if (k.side === 'left' || k.side === 'right') {
        if (!m.metric.side_left_right) continue // nonsensical: non-bilateral with side
        next.push(...metricToSelections(m.testId, m.testName, m.isCustom, m.metric).filter((s) => s.side === k.side))
      } else {
        next.push(...metricToSelections(m.testId, m.testName, m.isCustom, m.metric))
      }
    }
    setSelected(next)
    setAppliedBatteryId(batteryId)
  }

  async function submit(acceptedWarnings: boolean) {
    setError(null)

    // Pull values out for each selected metric, coerce to numbers, hand
    // off to the server action.
    const results: TestResultInput[] = []
    for (const s of selected) {
      const raw = values[s.key]
      if (raw === undefined || raw.trim() === '') {
        setError(`${s.metricLabel}${s.side ? ` (${s.side})` : ''}: enter a value.`)
        setPhase('enter')
        return
      }
      const num = Number(raw)
      results.push({
        testId: s.testId,
        metricId: s.metricId,
        side: s.side,
        value: num,
        unit: s.unit,
      })
    }

    startSave(async () => {
      const res = await createTestSessionAction({
        clientId,
        conductedAt: new Date(conductedAt).toISOString(),
        source: 'manual',
        notes: notes.trim() || null,
        appliedBatteryId,
        results,
        acceptedWarnings,
      })

      if (res.error) {
        if (res.warnings && res.warnings.length > 0) {
          setWarnings(res.warnings)
          setShowWarnings(true)
          return
        }
        setError(res.error)
        return
      }
      close()
    })
  }

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="capture-heading" style={overlayStyle} onClick={close}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>{phaseLabel(phase)}</div>
            <h2 id="capture-heading" style={titleStyle}>
              Record test
            </h2>
          </div>
          <button type="button" aria-label="Close" onClick={close} style={iconBtnStyle}>
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={bodyStyle}>
          {phase === 'pick' && (
            <PickPanel
              catalog={catalog}
              selected={selected}
              batteries={batteries}
              lastUsedBattery={lastUsedBattery}
              appliedBatteryId={appliedBatteryId}
              searchTerm={searchTerm}
              onSearchTerm={setSearchTerm}
              onToggleMetric={toggleMetric}
              onApplyBattery={applyBattery}
              onClearBattery={() => {
                setAppliedBatteryId(null)
                setSelected([])
              }}
            />
          )}
          {phase === 'enter' && (
            <EnterPanel
              selected={selected}
              values={values}
              onValueChange={(key, v) => setValues((prev) => ({ ...prev, [key]: v }))}
            />
          )}
          {phase === 'confirm' && (
            <ConfirmPanel
              selected={selected}
              values={values}
              conductedAt={conductedAt}
              onConductedAt={setConductedAt}
              notes={notes}
              onNotes={setNotes}
            />
          )}
          {error && (
            <div role="alert" style={errorBoxStyle}>
              {error}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={actionBarStyle}>
          <div style={{ fontSize: '.78rem', color: 'var(--color-text-light)' }}>
            {selected.length === 0
              ? 'No metrics selected.'
              : `${selected.length} metric${selected.length === 1 ? '' : 's'} selected`}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {phase !== 'pick' && (
              <button
                type="button"
                className="btn outline"
                onClick={() => setPhase(phase === 'confirm' ? 'enter' : 'pick')}
                disabled={isSaving}
              >
                <ChevronLeft size={14} aria-hidden /> Back
              </button>
            )}
            {phase === 'pick' && (
              <button
                type="button"
                className="btn primary"
                disabled={selected.length === 0}
                onClick={() => setPhase('enter')}
              >
                Continue <ChevronRight size={14} aria-hidden />
              </button>
            )}
            {phase === 'enter' && (
              <button
                type="button"
                className="btn primary"
                disabled={!allValuesEntered(selected, values)}
                onClick={() => setPhase('confirm')}
              >
                Continue <ChevronRight size={14} aria-hidden />
              </button>
            )}
            {phase === 'confirm' && (
              <button
                type="button"
                className="btn primary"
                disabled={isSaving}
                onClick={() => submit(false)}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>

        {/* Warnings confirm sheet */}
        {showWarnings && (
          <WarningsSheet
            warnings={warnings}
            onCancel={() => {
              setShowWarnings(false)
              setWarnings([])
            }}
            onConfirm={() => {
              setShowWarnings(false)
              submit(true)
            }}
            isSaving={isSaving}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pick step
// ---------------------------------------------------------------------------

function PickPanel({
  catalog,
  selected,
  batteries,
  lastUsedBattery,
  appliedBatteryId,
  searchTerm,
  onSearchTerm,
  onToggleMetric,
  onApplyBattery,
  onClearBattery,
}: {
  catalog: CatalogCategory[]
  selected: SelectedMetric[]
  batteries: BatteryRow[]
  lastUsedBattery: LastUsedBatteryHint | null
  appliedBatteryId: string | null
  searchTerm: string
  onSearchTerm: (s: string) => void
  onToggleMetric: (
    testId: string,
    testName: string,
    isCustom: boolean,
    metric: CatalogMetric,
  ) => void
  onApplyBattery: (id: string) => void
  onClearBattery: () => void
}) {
  const filtered = useMemo(() => filterCatalog(catalog, searchTerm), [catalog, searchTerm])
  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Battery row */}
      <div style={panelStyle}>
        <div style={panelHeadStyle}>
          <div style={panelTitleStyle}>Apply a saved battery</div>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {batteries.length === 0 ? (
            <div style={{ fontSize: '.84rem', color: 'var(--color-muted)' }}>
              No saved batteries yet. Pick metrics individually below, or build a battery in Settings.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lastUsedBattery && (
                <div
                  style={{
                    fontSize: '.78rem',
                    color: 'var(--color-text-light)',
                  }}
                >
                  Last used for this client:{' '}
                  <button
                    type="button"
                    onClick={() => onApplyBattery(lastUsedBattery.id)}
                    style={inlineLinkStyle}
                  >
                    {lastUsedBattery.name}
                  </button>
                  <span style={{ color: 'var(--color-muted)' }}>
                    {' '}— {formatShortDate(lastUsedBattery.conducted_at)}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={appliedBatteryId ?? ''}
                  onChange={(e) => {
                    if (e.target.value === '') onClearBattery()
                    else onApplyBattery(e.target.value)
                  }}
                  style={selectStyle}
                >
                  <option value="">— Pick a battery —</option>
                  {batteries.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.metric_keys.length} metrics)
                    </option>
                  ))}
                </select>
                {appliedBatteryId && (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onClearBattery}
                    style={{ fontSize: '.78rem', padding: '4px 10px' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search + catalog */}
      <div style={panelStyle}>
        <div style={panelHeadStyle}>
          <div style={panelTitleStyle}>Or pick individual tests</div>
        </div>
        <div style={{ padding: '14px 18px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 7,
              background: 'var(--color-surface)',
              marginBottom: 14,
            }}
          >
            <Search size={14} aria-hidden style={{ color: 'var(--color-muted)' }} />
            <input
              type="text"
              placeholder="Search tests or metrics"
              value={searchTerm}
              onChange={(e) => onSearchTerm(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                fontFamily: 'var(--font-sans)',
                fontSize: '.86rem',
                color: 'var(--color-text)',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((cat) => (
              <CategorySection
                key={cat.id}
                category={cat}
                selectedKeys={selectedKeys}
                onToggleMetric={onToggleMetric}
                forceOpen={searchTerm.length > 0}
              />
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: '.84rem', color: 'var(--color-muted)', padding: '8px 0' }}>
                No matches.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CategorySection({
  category,
  selectedKeys,
  onToggleMetric,
  forceOpen,
}: {
  category: CatalogCategory
  selectedKeys: Set<string>
  onToggleMetric: (
    testId: string,
    testName: string,
    isCustom: boolean,
    metric: CatalogMetric,
  ) => void
  forceOpen: boolean
}) {
  const [open, setOpen] = useState(false)
  const isOpen = forceOpen || open

  return (
    <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 10 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: '.88rem',
          color: 'var(--color-text)',
          textAlign: 'left',
        }}
      >
        <span>{category.name}</span>
        <ChevronRight
          size={14}
          aria-hidden
          style={{
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 150ms cubic-bezier(0.4,0,0.2,1)',
            color: 'var(--color-muted)',
          }}
        />
      </button>
      {isOpen && (
        <div style={{ padding: '4px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {category.subcategories.map((sub) => (
            <div key={sub.id}>
              <div
                style={{
                  fontSize: '.7rem',
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                  color: 'var(--color-muted)',
                  marginBottom: 6,
                }}
              >
                {sub.name}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {sub.tests.map((test) => (
                  <div key={test.id} style={{ paddingBottom: 4 }}>
                    <div
                      style={{
                        fontSize: '.82rem',
                        fontWeight: 500,
                        color: 'var(--color-text)',
                        marginBottom: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {test.name}
                      {test.is_custom && (
                        <span className="tag muted" style={{ fontSize: '.66rem' }}>
                          Custom
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                        gap: 4,
                      }}
                    >
                      {test.metrics.map((metric) => {
                        const allKeys = metric.side_left_right
                          ? [
                              selectionKey(test.id, metric.id, 'left'),
                              selectionKey(test.id, metric.id, 'right'),
                            ]
                          : [selectionKey(test.id, metric.id, null)]
                        const allSelected = allKeys.every((k) => selectedKeys.has(k))
                        return (
                          <label
                            key={metric.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '4px 8px',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: '.8rem',
                              color: 'var(--color-text)',
                              background: allSelected ? 'rgba(56,142,60,.06)' : 'transparent',
                              transition: 'background 150ms',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={() =>
                                onToggleMetric(test.id, test.name, test.is_custom, metric)
                              }
                              style={{ margin: 0 }}
                            />
                            <span>{metric.label}</span>
                            <span
                              style={{
                                marginLeft: 'auto',
                                fontSize: '.7rem',
                                color: 'var(--color-muted)',
                              }}
                            >
                              {metric.unit}
                              {metric.side_left_right ? ' · L/R' : ''}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Enter step
// ---------------------------------------------------------------------------

function EnterPanel({
  selected,
  values,
  onValueChange,
}: {
  selected: SelectedMetric[]
  values: Record<string, string>
  onValueChange: (key: string, v: string) => void
}) {
  // Group bilateral pairs together for visual presentation.
  const groups = useMemo(() => groupForEntry(selected), [selected])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map((g) => (
        <div key={g.testId + '::' + g.metricId} style={panelStyle}>
          <div style={panelHeadStyle}>
            <div style={panelTitleStyle}>
              {g.testName}
              <span
                style={{
                  fontWeight: 400,
                  fontSize: '.78rem',
                  color: 'var(--color-text-light)',
                  marginLeft: 8,
                }}
              >
                · {g.metricLabel}
              </span>
            </div>
          </div>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {g.entries.map((s) => (
                <div key={s.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {s.side && (
                    <span
                      style={{
                        fontSize: '.7rem',
                        letterSpacing: '.04em',
                        textTransform: 'uppercase',
                        fontWeight: 500,
                        color: 'var(--color-muted)',
                      }}
                    >
                      {s.side === 'left' ? 'Left' : 'Right'}
                    </span>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 7,
                      padding: '4px 10px',
                      background: '#fff',
                    }}
                  >
                    <input
                      type="number"
                      inputMode={s.inputType === 'integer' ? 'numeric' : 'decimal'}
                      step={s.inputType === 'integer' ? 1 : 'any'}
                      value={values[s.key] ?? ''}
                      onChange={(e) => onValueChange(s.key, e.target.value)}
                      style={{
                        width: 110,
                        border: 'none',
                        outline: 'none',
                        fontFamily: 'var(--font-sans)',
                        fontSize: '.92rem',
                        fontWeight: 500,
                        color: 'var(--color-text)',
                        background: 'transparent',
                        padding: '4px 0',
                      }}
                    />
                    <span style={{ fontSize: '.78rem', color: 'var(--color-muted)' }}>
                      {s.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confirm step
// ---------------------------------------------------------------------------

function ConfirmPanel({
  selected,
  values,
  conductedAt,
  onConductedAt,
  notes,
  onNotes,
}: {
  selected: SelectedMetric[]
  values: Record<string, string>
  conductedAt: string
  onConductedAt: (s: string) => void
  notes: string
  onNotes: (s: string) => void
}) {
  const groups = useMemo(() => groupForEntry(selected), [selected])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={panelStyle}>
        <div style={panelHeadStyle}>
          <div style={panelTitleStyle}>When and notes</div>
        </div>
        <div
          style={{
            padding: '14px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={subEyebrowStyle}>Conducted at</span>
            <input
              type="datetime-local"
              value={conductedAt}
              onChange={(e) => onConductedAt(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={subEyebrowStyle}>Notes (optional)</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => onNotes(e.target.value)}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
            />
          </label>
        </div>
      </div>
      <div style={panelStyle}>
        <div style={panelHeadStyle}>
          <div style={panelTitleStyle}>Summary · {groups.length} test{groups.length === 1 ? '' : 's'}</div>
        </div>
        <div style={{ padding: '8px 18px 14px' }}>
          <table style={{ width: '100%', fontSize: '.84rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--color-muted)', textAlign: 'left' }}>
                <th style={thStyle}>Test</th>
                <th style={thStyle}>Metric</th>
                <th style={thStyle}>Side</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Value</th>
                <th style={thStyle}>Unit</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap((g) =>
                g.entries.map((s) => (
                  <tr key={s.key} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                    <td style={tdStyle}>{s.testName}</td>
                    <td style={tdStyle}>{s.metricLabel}</td>
                    <td style={tdStyle}>
                      {s.side ? (s.side === 'left' ? 'Left' : 'Right') : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {values[s.key] ?? '—'}
                    </td>
                    <td style={tdStyle}>{s.unit}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Warnings sheet
// ---------------------------------------------------------------------------

function WarningsSheet({
  warnings,
  onCancel,
  onConfirm,
  isSaving,
}: {
  warnings: string[]
  onCancel: () => void
  onConfirm: () => void
  isSaving: boolean
}) {
  return (
    <div role="alertdialog" aria-modal="true" style={overlayStyle} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          ...modalStyle,
          maxWidth: 460,
          maxHeight: 'unset',
        }}
      >
        <div style={{ padding: '24px 26px 18px' }}>
          <h3
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.2rem',
              margin: '0 0 10px',
              color: 'var(--color-charcoal)',
            }}
          >
            Some values look unusual
          </h3>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: '.86rem',
              color: 'var(--color-text)',
              lineHeight: 1.55,
            }}
          >
            {warnings.map((w, i) => (
              <li key={i} style={{ marginBottom: 6 }}>
                {w}
              </li>
            ))}
          </ul>
          <p
            style={{
              fontSize: '.82rem',
              color: 'var(--color-text-light)',
              marginTop: 12,
              marginBottom: 0,
            }}
          >
            Confirm to save anyway, or back out to fix.
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '14px 22px 22px',
          }}
        >
          <button type="button" className="btn outline" onClick={onCancel} disabled={isSaving}>
            Back
          </button>
          <button type="button" className="btn primary" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save anyway'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMetricIndex(catalog: CatalogCategory[]): Map<
  string,
  { metric: CatalogMetric; testId: string; testName: string; isCustom: boolean }
> {
  const map = new Map<string, { metric: CatalogMetric; testId: string; testName: string; isCustom: boolean }>()
  for (const cat of catalog) {
    for (const sub of cat.subcategories) {
      for (const test of sub.tests) {
        for (const metric of test.metrics) {
          map.set(`${test.id}::${metric.id}`, {
            metric,
            testId: test.id,
            testName: test.name,
            isCustom: test.is_custom,
          })
        }
      }
    }
  }
  return map
}

function filterCatalog(catalog: CatalogCategory[], term: string): CatalogCategory[] {
  if (!term.trim()) return catalog
  const needle = term.trim().toLowerCase()
  const matches = (s: string) => s.toLowerCase().includes(needle)
  return catalog
    .map((cat) => ({
      ...cat,
      subcategories: cat.subcategories
        .map((sub) => ({
          ...sub,
          tests: sub.tests
            .map((test) => ({
              ...test,
              metrics: matches(test.name) || matches(sub.name) || matches(cat.name)
                ? test.metrics
                : test.metrics.filter((m) => matches(m.label)),
            }))
            .filter((t) => t.metrics.length > 0),
        }))
        .filter((s) => s.tests.length > 0),
    }))
    .filter((c) => c.subcategories.length > 0)
}

interface EntryGroup {
  testId: string
  metricId: string
  testName: string
  metricLabel: string
  entries: SelectedMetric[]
}

function groupForEntry(selected: SelectedMetric[]): EntryGroup[] {
  const map = new Map<string, EntryGroup>()
  for (const s of selected) {
    const key = `${s.testId}::${s.metricId}`
    let g = map.get(key)
    if (!g) {
      g = {
        testId: s.testId,
        metricId: s.metricId,
        testName: s.testName,
        metricLabel: s.metricLabel,
        entries: [],
      }
      map.set(key, g)
    }
    g.entries.push(s)
  }
  // Order: left before right, non-sided alone
  const sortedGroups = Array.from(map.values())
  for (const g of sortedGroups) {
    g.entries.sort((a, b) => {
      const order = (s: 'left' | 'right' | null) => (s === 'left' ? 0 : s === 'right' ? 1 : 2)
      return order(a.side) - order(b.side)
    })
  }
  return sortedGroups
}

function allValuesEntered(selected: SelectedMetric[], values: Record<string, string>): boolean {
  return selected.every((s) => {
    const v = values[s.key]
    if (v === undefined || v.trim() === '') return false
    return Number.isFinite(Number(v))
  })
}

function localNowIso(): string {
  // datetime-local expects YYYY-MM-DDTHH:mm in local time
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function phaseLabel(phase: Phase): string {
  if (phase === 'pick') return 'Step 1 of 3 · Pick metrics'
  if (phase === 'enter') return 'Step 2 of 3 · Enter values'
  return 'Step 3 of 3 · Confirm and save'
}

// ---------------------------------------------------------------------------
// Styles (inline — matches the rest of this app's pattern)
// ---------------------------------------------------------------------------

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(28, 25, 23, .55)',
  display: 'grid',
  placeItems: 'center',
  zIndex: 100,
  padding: 16,
}

const modalStyle: CSSProperties = {
  width: '100%',
  maxWidth: 980,
  maxHeight: '88vh',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-card)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 14,
  boxShadow: '0 12px 40px rgba(0,0,0,.18)',
  overflow: 'hidden',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '20px 26px 14px',
  borderBottom: '1px solid var(--color-border-subtle)',
}

const eyebrowStyle: CSSProperties = {
  fontSize: '.7rem',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  fontWeight: 500,
  color: 'var(--color-muted)',
  marginBottom: 4,
}

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: '1.4rem',
  margin: 0,
  color: 'var(--color-charcoal)',
  letterSpacing: '-.005em',
}

const iconBtnStyle: CSSProperties = {
  width: 30,
  height: 30,
  display: 'inline-grid',
  placeItems: 'center',
  borderRadius: 6,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--color-text-light)',
}

const bodyStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '18px 26px',
}

const actionBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '14px 22px',
  borderTop: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
}

const panelStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 10,
  overflow: 'hidden',
}

const panelHeadStyle: CSSProperties = {
  padding: '10px 18px',
  borderBottom: '1px solid var(--color-border-subtle)',
  background: 'var(--color-surface)',
}

const panelTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  fontSize: '.86rem',
  color: 'var(--color-text)',
}

const subEyebrowStyle: CSSProperties = {
  fontSize: '.7rem',
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  fontWeight: 500,
  color: 'var(--color-muted)',
}

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: '.86rem',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  padding: '6px 10px',
  background: '#fff',
  outline: 'none',
}

const selectStyle: CSSProperties = {
  ...inputStyle,
  minWidth: 260,
}

const inlineLinkStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: '.78rem',
  fontWeight: 600,
  color: 'var(--color-primary)',
  cursor: 'pointer',
  textDecoration: 'underline',
}

const errorBoxStyle: CSSProperties = {
  marginTop: 14,
  padding: '10px 12px',
  background: 'rgba(214,64,69,.08)',
  border: '1px solid rgba(214,64,69,.25)',
  borderRadius: 8,
  color: 'var(--color-alert)',
  fontSize: '.84rem',
}

const thStyle: CSSProperties = {
  fontSize: '.7rem',
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  fontWeight: 500,
  padding: '6px 8px',
}

const tdStyle: CSSProperties = {
  padding: '8px',
  color: 'var(--color-text)',
}

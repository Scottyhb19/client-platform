'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { CatalogCategory, PracticeCustomTest } from '@/lib/testing'
import {
  createCustomTestAction,
  updateCustomTestAction,
  type CustomTestMetricInput,
} from '../actions'
import { slugifyMetricId, slugifyTestId } from '../_lib/slugify'

type Mode = 'create' | 'edit'

interface PropsCreate {
  mode: 'create'
  existingTestIds: ReadonlySet<string>
  catalog: CatalogCategory[]
  onCancel: () => void
  onSaved: () => void
  initialTest?: undefined
}

interface PropsEdit {
  mode: 'edit'
  initialTest: PracticeCustomTest
  existingTestIds: ReadonlySet<string>
  catalog: CatalogCategory[]
  onCancel: () => void
  onSaved: () => void
}

type Props = PropsCreate | PropsEdit

interface MetricRow {
  rowKey: string
  id: string
  idEditedManually: boolean
  label: string
  unit: string
  inputType: 'decimal' | 'integer'
  bilateral: boolean
  directionOfGood: string
  defaultChart: string
  comparisonMode: string
  clientPortalVisibility: string
  clientViewChart: string
  isExisting: boolean // metric was in the test before edit (id is locked)
}

const DEFAULT_METRIC_HINTS = {
  directionOfGood: 'higher',
  defaultChart: 'bar',
  comparisonMode: 'absolute',
  clientPortalVisibility: 'on_publish',
  clientViewChart: 'milestone',
} as const

function newRowKey(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`
}

function buildInitialMetrics(test: PracticeCustomTest | undefined): MetricRow[] {
  if (!test) {
    return [emptyMetric()]
  }
  return test.metrics.map((m) => ({
    rowKey: newRowKey(),
    id: m.id,
    idEditedManually: true, // existing — never auto-update from label
    label: m.label,
    unit: m.unit,
    inputType: (m.input_type === 'integer' ? 'integer' : 'decimal') as
      | 'decimal'
      | 'integer',
    bilateral: Array.isArray(m.side),
    directionOfGood: m.direction_of_good,
    defaultChart: m.default_chart,
    comparisonMode: m.comparison_mode,
    clientPortalVisibility: m.client_portal_visibility,
    clientViewChart: m.client_view_chart,
    isExisting: true,
  }))
}

function emptyMetric(): MetricRow {
  return {
    rowKey: newRowKey(),
    id: '',
    idEditedManually: false,
    label: '',
    unit: '',
    inputType: 'decimal',
    bilateral: false,
    directionOfGood: DEFAULT_METRIC_HINTS.directionOfGood,
    defaultChart: DEFAULT_METRIC_HINTS.defaultChart,
    comparisonMode: DEFAULT_METRIC_HINTS.comparisonMode,
    clientPortalVisibility: DEFAULT_METRIC_HINTS.clientPortalVisibility,
    clientViewChart: DEFAULT_METRIC_HINTS.clientViewChart,
    isExisting: false,
  }
}

export function CustomTestForm(props: Props) {
  const { mode, catalog, existingTestIds, onCancel, onSaved } = props
  const initialTest = props.mode === 'edit' ? props.initialTest : undefined

  const [name, setName] = useState(initialTest?.name ?? '')
  const [testId, setTestId] = useState(initialTest?.test_id ?? '')
  const [testIdEdited, setTestIdEdited] = useState(false)
  const [categoryId, setCategoryId] = useState(initialTest?.category_id ?? '')
  const [subcategoryId, setSubcategoryId] = useState(
    initialTest?.subcategory_id ?? '',
  )
  const [metrics, setMetrics] = useState<MetricRow[]>(() =>
    buildInitialMetrics(initialTest),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Auto-slugify test_id from name during create (but not after the user
  // has manually edited the id). Edit mode never updates the id.
  useEffect(() => {
    if (mode === 'edit') return
    if (testIdEdited) return
    if (name.trim().length === 0) {
      setTestId('')
      return
    }
    const slug = slugifyTestId(name, existingTestIds)
    setTestId(slug)
  }, [name, mode, testIdEdited, existingTestIds])

  // Datalist of category and subcategory options across the catalog tree.
  const categoryOptions = useMemo(
    () => catalog.map((c) => ({ id: c.id, name: c.name })),
    [catalog],
  )
  const subcategoryOptions = useMemo(() => {
    const cat = catalog.find((c) => c.id === categoryId)
    if (!cat) return []
    return cat.subcategories.map((s) => ({ id: s.id, name: s.name }))
  }, [catalog, categoryId])

  function updateMetric(rowKey: string, updates: Partial<MetricRow>) {
    setMetrics((prev) =>
      prev.map((m) => (m.rowKey === rowKey ? { ...m, ...updates } : m)),
    )
  }

  function autoSlugMetricFromLabel(rowKey: string, label: string) {
    const otherIds = new Set(
      metrics.filter((m) => m.rowKey !== rowKey).map((m) => m.id),
    )
    const slug = label.trim().length === 0 ? '' : slugifyMetricId(label, otherIds)
    updateMetric(rowKey, { label, id: slug })
  }

  function addMetric() {
    setMetrics((prev) => [...prev, emptyMetric()])
  }

  function removeMetric(rowKey: string) {
    setMetrics((prev) =>
      prev.length === 1 ? prev : prev.filter((m) => m.rowKey !== rowKey),
    )
  }

  async function handleSubmit() {
    setError(null)

    if (!name.trim()) return setError('Name is required.')
    if (!categoryId.trim()) return setError('Category is required.')
    if (!subcategoryId.trim()) return setError('Subcategory is required.')
    if (mode === 'create' && !testId.trim()) {
      return setError('Test id could not be generated. Try a different name.')
    }
    if (metrics.length === 0) return setError('At least one metric is required.')

    const metricInputs: CustomTestMetricInput[] = metrics.map((m) => ({
      id: m.id,
      label: m.label,
      unit: m.unit,
      input_type: m.inputType,
      bilateral: m.bilateral,
      direction_of_good: m.directionOfGood,
      default_chart: m.defaultChart,
      comparison_mode: m.comparisonMode,
      client_portal_visibility: m.clientPortalVisibility,
      client_view_chart: m.clientViewChart,
    }))

    startTransition(async () => {
      if (mode === 'create') {
        const res = await createCustomTestAction({
          category_id: categoryId.trim(),
          subcategory_id: subcategoryId.trim(),
          test_id: testId.trim(),
          name: name.trim(),
          display_order: 0,
          metrics: metricInputs,
        })
        if (res.error) {
          setError(res.error)
          return
        }
        onSaved()
      } else {
        const res = await updateCustomTestAction(props.initialTest.id, {
          category_id: categoryId.trim(),
          subcategory_id: subcategoryId.trim(),
          name: name.trim(),
          display_order: initialTest?.display_order ?? 0,
          metrics: metricInputs,
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
        {mode === 'create' ? 'New custom test' : `Edit ${initialTest?.name}`}
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
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <Field label="Test name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ACL Phase 2 reassessment"
            style={inputStyle}
            disabled={pending}
          />
        </Field>
        <Field
          label="Test ID"
          hint={
            mode === 'edit'
              ? 'Locked — past results reference this id.'
              : testIdEdited
                ? 'Manually edited.'
                : 'Auto-generated from name. Click Edit ID to override.'
          }
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={testId}
              onChange={(e) => setTestId(e.target.value)}
              readOnly={mode === 'edit' || !testIdEdited}
              style={{
                ...inputStyle,
                fontFamily: 'var(--font-sans)',
                color:
                  mode === 'edit' || !testIdEdited
                    ? 'var(--color-text-light)'
                    : 'var(--color-text)',
                background:
                  mode === 'edit' || !testIdEdited
                    ? 'var(--color-surface)'
                    : '#fff',
              }}
              disabled={pending}
            />
            {mode === 'create' && !testIdEdited && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setTestIdEdited(true)}
                style={{ flexShrink: 0, fontSize: '.74rem' }}
                disabled={pending}
              >
                Edit ID
              </button>
            )}
          </div>
        </Field>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <Field label="Category" required hint="Pick from the schema or switch to a new id.">
          <CategoryPicker
            value={categoryId}
            onChange={setCategoryId}
            options={categoryOptions}
            placeholder="Select category"
            newPlaceholder="New category id (lowercase + underscores)"
            disabled={pending}
          />
        </Field>
        <Field label="Subcategory" required hint="Pick from the schema or switch to a new id.">
          <CategoryPicker
            value={subcategoryId}
            onChange={setSubcategoryId}
            options={subcategoryOptions}
            placeholder="Select subcategory"
            newPlaceholder="New subcategory id"
            disabled={pending}
          />
        </Field>
      </div>

      {/* Metrics */}
      <div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--color-muted)',
            marginBottom: 8,
          }}
        >
          Metrics ({metrics.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {metrics.map((m, idx) => (
            <MetricRowEditor
              key={m.rowKey}
              row={m}
              index={idx}
              onChange={(updates) => updateMetric(m.rowKey, updates)}
              onLabelChange={(label) => autoSlugMetricFromLabel(m.rowKey, label)}
              onRemove={() => removeMetric(m.rowKey)}
              canRemove={metrics.length > 1}
              disabled={pending}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn outline"
          onClick={addMetric}
          style={{ marginTop: 10 }}
          disabled={pending}
        >
          <Plus size={14} /> Add metric
        </button>
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
          {pending ? 'Saving…' : mode === 'create' ? 'Create test' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function MetricRowEditor({
  row,
  index,
  onChange,
  onLabelChange,
  onRemove,
  canRemove,
  disabled,
}: {
  row: MetricRow
  index: number
  onChange: (updates: Partial<MetricRow>) => void
  onLabelChange: (label: string) => void
  onRemove: () => void
  canRemove: boolean
  disabled: boolean
}) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.7rem',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            color: 'var(--color-muted)',
          }}
        >
          Metric {index + 1}
        </div>
        {canRemove && (
          <button
            type="button"
            className="btn ghost"
            onClick={onRemove}
            disabled={disabled}
            title="Remove metric"
            style={{ color: 'var(--color-alert)', padding: '2px 6px' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr 1fr',
          gap: 10,
        }}
      >
        <Field label="Label" required>
          <input
            type="text"
            value={row.label}
            onChange={(e) => {
              if (row.isExisting) {
                onChange({ label: e.target.value })
              } else {
                onLabelChange(e.target.value)
              }
            }}
            placeholder="e.g. Peak force"
            style={inputStyle}
            disabled={disabled}
          />
        </Field>
        <Field label="Unit" required>
          <input
            type="text"
            value={row.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
            placeholder="e.g. N"
            style={inputStyle}
            disabled={disabled}
            maxLength={30}
          />
        </Field>
        <Field
          label="Metric ID"
          hint={row.isExisting ? 'Locked.' : 'Auto from label.'}
        >
          <input
            type="text"
            value={row.id}
            readOnly={row.isExisting}
            onChange={(e) => onChange({ id: e.target.value })}
            style={{
              ...inputStyle,
              color: 'var(--color-text-light)',
              background: 'var(--color-surface)',
            }}
            disabled={disabled}
          />
        </Field>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 10,
        }}
      >
        <Field label="Input type">
          <Select
            value={row.inputType}
            onChange={(v) =>
              onChange({ inputType: v as 'decimal' | 'integer' })
            }
            disabled={disabled}
            options={[
              ['decimal', 'Decimal'],
              ['integer', 'Integer'],
            ]}
          />
        </Field>
        <Field label="Bilateral">
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: '.84rem',
              color: 'var(--color-text)',
              padding: '5px 8px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={row.bilateral}
              onChange={(e) => onChange({ bilateral: e.target.checked })}
              disabled={disabled}
            />
            L / R sides
          </label>
        </Field>
        <span />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 10,
        }}
      >
        <Field label="Direction">
          <Select
            value={row.directionOfGood}
            onChange={(v) => onChange({ directionOfGood: v })}
            disabled={disabled}
            options={[
              ['higher', 'higher = good'],
              ['lower', 'lower = good'],
              ['target_range', 'target band'],
              ['context_dependent', 'context'],
            ]}
          />
        </Field>
        <Field label="Chart">
          <Select
            value={row.defaultChart}
            onChange={(v) => onChange({ defaultChart: v })}
            disabled={disabled}
            options={[
              ['line', 'line'],
              ['bar', 'bar'],
              ['radar', 'radar'],
              ['asymmetry_bar', 'asymmetry'],
              ['target_zone', 'target zone'],
            ]}
          />
        </Field>
        <Field label="Compare">
          <Select
            value={row.comparisonMode}
            onChange={(v) => onChange({ comparisonMode: v })}
            disabled={disabled}
            options={[
              ['absolute', 'absolute'],
              ['bilateral_lsi', 'bilateral LSI'],
              ['vs_baseline', 'vs baseline'],
              ['vs_normative', 'vs normative'],
            ]}
          />
        </Field>
        <Field label="Visibility">
          <Select
            value={row.clientPortalVisibility}
            onChange={(v) => onChange({ clientPortalVisibility: v })}
            disabled={disabled}
            options={[
              ['auto', 'auto'],
              ['on_publish', 'on publish'],
              ['never', 'never'],
            ]}
          />
        </Field>
        <Field label="Client view">
          <Select
            value={row.clientViewChart}
            onChange={(v) => onChange({ clientViewChart: v })}
            disabled={disabled}
            options={[
              ['line', 'line'],
              ['milestone', 'milestone'],
              ['bar', 'bar'],
              ['narrative_only', 'narrative'],
              ['hidden', 'hidden'],
            ]}
          />
        </Field>
      </div>
    </div>
  )
}

function Field({
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

/**
 * Picker for category/subcategory ids. Default mode shows a styled
 * <select> populated from the schema; the last option is a sentinel
 * "＋ Type a new id…" that morphs the control into a free-text input.
 *
 * If options arrive empty (e.g. subcategory list when the user has
 * picked a brand-new category that doesn't exist in the schema), the
 * picker boots in free-text mode automatically.
 */
function CategoryPicker({
  value,
  onChange,
  options,
  placeholder,
  newPlaceholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ id: string; name: string }>
  placeholder: string
  newPlaceholder: string
  disabled: boolean
}) {
  const optionIds = useMemo(
    () => new Set(options.map((o) => o.id)),
    [options],
  )
  const [mode, setMode] = useState<'list' | 'free'>(() =>
    value !== '' && !optionIds.has(value) ? 'free' : 'list',
  )

  // If the value drifts out of the option set (or options become empty),
  // flip to free-text. Don't auto-flip back — the user uses the "Use
  // list" button when they want to.
  useEffect(() => {
    if (options.length === 0 && mode === 'list') setMode('free')
    else if (value !== '' && !optionIds.has(value) && mode === 'list') {
      setMode('free')
    }
  }, [options.length, optionIds, value, mode])

  if (mode === 'free') {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={newPlaceholder}
          style={{ ...inputStyle, flex: 1 }}
          disabled={disabled}
          autoFocus
        />
        {options.length > 0 && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setMode('list')
              onChange('')
            }}
            disabled={disabled}
            style={{ flexShrink: 0, fontSize: '.74rem' }}
          >
            Use list
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__new__') {
            setMode('free')
            onChange('')
          } else {
            onChange(e.target.value)
          }
        }}
        disabled={disabled}
        style={{
          ...inputStyle,
          paddingRight: 28,
          appearance: 'none',
          WebkitAppearance: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="">— {placeholder} —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        <option disabled>──────────</option>
        <option value="__new__">＋ Type a new id…</option>
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--color-text-light)',
        }}
      />
    </div>
  )
}

function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (newValue: string) => void
  options: ReadonlyArray<readonly [string, string]>
  disabled: boolean
}) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          ...inputStyle,
          paddingRight: 24,
          appearance: 'none',
          WebkitAppearance: 'none',
          cursor: 'pointer',
        }}
      >
        {options.map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'var(--color-text-light)',
        }}
      />
    </div>
  )
}

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

'use client'

import { RotateCcw } from 'lucide-react'
import type { CatalogMetric, OverrideMapEntry } from '@/lib/testing'
import type { OverrideField } from '../actions'

const FIELD_OPTIONS: Record<
  OverrideField,
  ReadonlyArray<readonly [string, string]>
> = {
  direction_of_good: [
    ['higher', 'higher = good'],
    ['lower', 'lower = good'],
    ['target_range', 'target band'],
    ['context_dependent', 'context'],
  ],
  default_chart: [
    ['line', 'line'],
    ['bar', 'bar'],
    ['radar', 'radar'],
    ['asymmetry_bar', 'asymmetry'],
    ['target_zone', 'target zone'],
  ],
  comparison_mode: [
    ['absolute', 'absolute'],
    ['bilateral_lsi', 'bilateral LSI'],
    ['vs_baseline', 'vs baseline'],
    ['vs_normative', 'vs normative'],
  ],
  client_view_chart: [
    ['line', 'line'],
    ['milestone', 'milestone'],
    ['bar', 'bar'],
    ['narrative_only', 'narrative'],
    ['hidden', 'hidden'],
  ],
}

interface Props {
  testId: string
  metric: CatalogMetric
  override: OverrideMapEntry | null
  onSetField: (
    testId: string,
    metricId: string,
    field: OverrideField,
    value: string | null,
  ) => Promise<void>
  onResetRow: (testId: string, metricId: string) => Promise<void>
}

export function OverrideRow({
  testId,
  metric,
  override,
  onSetField,
  onResetRow,
}: Props) {
  const hasAnyOverride = !!override

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px repeat(4, 1fr) 36px',
        gap: 8,
        alignItems: 'center',
        padding: '4px 8px',
        background: hasAnyOverride
          ? 'rgba(45, 178, 76, 0.04)'
          : 'transparent',
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: '.82rem',
          color: 'var(--color-text)',
          minWidth: 0,
        }}
      >
        <div
          style={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {metric.label}
        </div>
        <div
          style={{
            fontSize: '.7rem',
            color: 'var(--color-text-light)',
            marginTop: 1,
          }}
        >
          {metric.unit}
          {metric.side_left_right ? ' · L/R' : ''}
        </div>
      </div>

      <Cell
        field="direction_of_good"
        value={override?.direction_of_good ?? null}
        defaultValue={metric.direction_of_good}
        onChange={(v) => onSetField(testId, metric.id, 'direction_of_good', v)}
      />
      <Cell
        field="default_chart"
        value={override?.default_chart ?? null}
        defaultValue={metric.default_chart}
        onChange={(v) => onSetField(testId, metric.id, 'default_chart', v)}
      />
      <Cell
        field="comparison_mode"
        value={override?.comparison_mode ?? null}
        defaultValue={metric.comparison_mode}
        onChange={(v) => onSetField(testId, metric.id, 'comparison_mode', v)}
      />
      <Cell
        field="client_view_chart"
        value={override?.client_view_chart ?? null}
        defaultValue={metric.client_view_chart}
        onChange={(v) => onSetField(testId, metric.id, 'client_view_chart', v)}
      />

      <button
        type="button"
        onClick={() => onResetRow(testId, metric.id)}
        title={hasAnyOverride ? 'Reset all four fields' : 'No overrides set'}
        disabled={!hasAnyOverride}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: hasAnyOverride ? 'pointer' : 'default',
          color: hasAnyOverride
            ? 'var(--color-text-light)'
            : 'var(--color-border)',
          padding: 4,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <RotateCcw size={14} />
      </button>
    </div>
  )
}

function Cell({
  field,
  value,
  defaultValue,
  onChange,
}: {
  field: OverrideField
  value: string | null
  defaultValue: string
  onChange: (newValue: string | null) => void
}) {
  const overridden = value !== null
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value
          onChange(v === '' ? null : v)
        }}
        title={
          overridden
            ? `Override · default is "${defaultValue}"`
            : `Default: ${defaultValue}`
        }
        style={{
          width: '100%',
          padding: '5px 22px 5px 8px',
          border: `1px solid ${
            overridden ? 'var(--color-accent)' : 'var(--color-border-subtle)'
          }`,
          borderRadius: 'var(--radius-input)',
          background: '#fff',
          fontFamily: 'var(--font-sans)',
          fontSize: '.78rem',
          fontWeight: overridden ? 600 : 400,
          color: 'var(--color-text)',
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
        }}
      >
        <option value="">Default ({labelOf(field, defaultValue)})</option>
        {FIELD_OPTIONS[field].map(([val, label]) => (
          <option key={val} value={val}>
            {label}
          </option>
        ))}
      </select>
      {overridden && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 22,
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-accent)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

function labelOf(field: OverrideField, value: string): string {
  const opts = FIELD_OPTIONS[field]
  for (const [val, label] of opts) {
    if (val === value) return label
  }
  return value
}

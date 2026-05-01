'use client'

/**
 * ComparisonTable — pivot of metrics × selected sessions.
 *
 * Per docs/decisions.md D-005 (Q4/Q9 sign-off):
 * - Rows: one per (test, metric, side) — bilateral metrics produce
 *   two rows
 * - Columns: selected sessions chronologically left-to-right
 * - Rightmost column: total %-change from baseline (earliest selected
 *   session with a value) to latest (latest selected session with a
 *   value), colour-coded by direction_of_good
 *
 * Cells with no captured value render an em-dash. Per-cell deltas are
 * NOT shown — the table optimises for legibility of the absolute
 * values across time. The %-change column carries the headline movement.
 *
 * Horizontal overflow: with many sessions the column count grows past
 * the viewport. The table is wrapped in a horizontal scroller; the
 * left columns aren't position-stuck in v1 — adding a sticky frozen-
 * column treatment is a follow-up if it's actually needed.
 */

import { ArrowDown, ArrowUp } from 'lucide-react'
import { useMemo } from 'react'
import { colourFor, formatPctChange } from '@/lib/testing/direction'
import {
  rowBaselineLatest,
  formatCompactDate,
  type ComparisonView,
  type ComparisonRow,
} from './helpers'

interface ComparisonTableProps {
  view: ComparisonView
}

export function ComparisonTable({ view }: ComparisonTableProps) {
  if (view.sessions.length === 0) {
    return <Empty label="Select at least one session to compare." />
  }
  if (view.rows.length === 0) {
    return <Empty label="No metrics captured in the selected sessions." />
  }

  // Group rows by test for visual separation.
  const grouped = useMemo(() => groupByTest(view.rows), [view.rows])

  return (
    <section
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontFamily: 'var(--font-sans)',
            fontSize: '.84rem',
          }}
        >
          <thead>
            <tr
              style={{
                background: 'var(--color-surface-2)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <Th first>Test</Th>
              <Th>Metric</Th>
              <Th narrow>Side</Th>
              {view.sessions.map((s) => (
                <Th key={s.session_id} numeric>
                  {formatCompactDate(s.conducted_at)}
                </Th>
              ))}
              <Th numeric trailing>
                Δ baseline → latest
              </Th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => (
              <TestRowGroup key={g.test_id} group={g} view={view} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

interface TestGroup {
  test_id: string
  test_name: string
  is_custom: boolean
  rows: ComparisonRow[]
}

function groupByTest(rows: ComparisonRow[]): TestGroup[] {
  const buckets = new Map<string, TestGroup>()
  for (const r of rows) {
    let g = buckets.get(r.test_id)
    if (!g) {
      g = {
        test_id: r.test_id,
        test_name: r.test_name,
        is_custom: r.is_custom,
        rows: [],
      }
      buckets.set(r.test_id, g)
    }
    g.rows.push(r)
  }
  return Array.from(buckets.values())
}

function TestRowGroup({
  group,
  view,
}: {
  group: TestGroup
  view: ComparisonView
}) {
  return (
    <>
      {group.rows.map((row, i) => {
        const showTestName = i === 0
        const { baseline, latest } = rowBaselineLatest(row, view.sessions)
        const pct =
          baseline !== null && latest !== null
            ? formatPctChange(baseline, latest)
            : '—'
        const colour =
          baseline !== null && latest !== null
            ? colourFor(row.direction_of_good, baseline, latest)
            : 'var(--color-muted)'
        const direction =
          baseline !== null && latest !== null && baseline !== latest
            ? latest > baseline
              ? 'up'
              : 'down'
            : null
        const sideLabel =
          row.side === 'left' ? 'L' : row.side === 'right' ? 'R' : ''

        return (
          <tr
            key={`${row.test_id}::${row.metric_id}::${row.side ?? 'uni'}`}
            style={{
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <Td first muted={!showTestName}>
              {showTestName ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {group.test_name}
                  {group.is_custom && (
                    <span
                      className="tag new"
                      style={{
                        fontSize: '.58rem',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Custom
                    </span>
                  )}
                </span>
              ) : (
                ''
              )}
            </Td>
            <Td>{row.metric_label}</Td>
            <Td narrow muted>
              {sideLabel}
            </Td>
            {view.sessions.map((s) => {
              const v = row.values[s.session_id]
              return (
                <Td key={s.session_id} numeric>
                  {v !== undefined ? (
                    <>
                      {formatNumber(v)}
                      <span
                        style={{
                          fontSize: '.7rem',
                          color: 'var(--color-muted)',
                          marginLeft: 3,
                        }}
                      >
                        {row.unit}
                      </span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--color-muted)' }}>—</span>
                  )}
                </Td>
              )
            })}
            <Td numeric trailing>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 600,
                  color: colour,
                  whiteSpace: 'nowrap',
                }}
              >
                {direction === 'up' && <ArrowUp size={11} aria-hidden />}
                {direction === 'down' && <ArrowDown size={11} aria-hidden />}
                {pct}
              </span>
            </Td>
          </tr>
        )
      })}
    </>
  )
}

function Th({
  children,
  first,
  trailing,
  narrow,
  numeric,
}: {
  children: React.ReactNode
  first?: boolean
  trailing?: boolean
  narrow?: boolean
  numeric?: boolean
}) {
  return (
    <th
      style={{
        textAlign: numeric ? 'right' : 'left',
        padding: '10px 12px',
        fontFamily: 'var(--font-display)',
        fontSize: '.66rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-muted)',
        paddingLeft: first ? 18 : 12,
        paddingRight: trailing ? 18 : 12,
        whiteSpace: narrow ? 'nowrap' : undefined,
        width: narrow ? 1 : undefined,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  first,
  trailing,
  narrow,
  numeric,
  muted,
}: {
  children: React.ReactNode
  first?: boolean
  trailing?: boolean
  narrow?: boolean
  numeric?: boolean
  muted?: boolean
}) {
  return (
    <td
      style={{
        textAlign: numeric ? 'right' : 'left',
        padding: '8px 12px',
        paddingLeft: first ? 18 : 12,
        paddingRight: trailing ? 18 : 12,
        whiteSpace: narrow ? 'nowrap' : undefined,
        color: muted ? 'var(--color-muted)' : 'var(--color-text)',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </td>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <section
      className="card"
      style={{
        padding: 28,
        textAlign: 'center',
        color: 'var(--color-text-light)',
        fontSize: '.86rem',
      }}
    >
      {label}
    </section>
  )
}

function formatNumber(value: number): string {
  // Match the precision the EP actually entered: integers stay integer,
  // decimals show up to 2 dp.
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

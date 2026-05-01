'use client'

/**
 * TestCard — one card per test, showing per-metric charts inside.
 *
 * Per docs/decisions.md D-003:
 * - One card per test
 * - Inside: one chart per metric, EXCEPT when metrics share render shape
 *   (same default_chart + unit + direction + side flag), they render as
 *   one combined chart. KOOS-style PROMs are the canonical case.
 * - Above each chart: MetricBadge with baseline + %-change colour-coded
 *   per direction_of_good
 */

import type {
  ClientTestHistory,
  MetricHistory,
  PublicationRow,
  TestHistory,
} from '@/lib/testing/loader-types'
import { ChartFactory } from './charts/ChartFactory'
import { MetricBadge } from './MetricBadge'
import { TestPublishButton } from './TestPublishButton'
import {
  groupMetricsByShape,
  timeAgo,
  type TimeWindow,
} from './helpers'

interface TestCardProps {
  clientId: string
  test: TestHistory
  history: ClientTestHistory
  publications: PublicationRow[]
  window: TimeWindow
}

export function TestCard({
  clientId,
  test,
  history,
  publications,
  window,
}: TestCardProps) {
  const groups = groupMetricsByShape(test.metrics)

  return (
    <article
      className="card"
      style={{
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
              letterSpacing: '-0.01em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span>{test.test_name}</span>
            {test.is_custom && (
              <span
                className="tag new"
                style={{
                  fontSize: '.62rem',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                Custom
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: '.76rem',
              color: 'var(--color-text-light)',
              marginTop: 2,
            }}
          >
            {test.subcategory_name} · {test.total_sessions} session
            {test.total_sessions === 1 ? '' : 's'} · last {timeAgo(test.most_recent_conducted_at)}
          </div>
        </div>
        <TestPublishButton
          clientId={clientId}
          test={test}
          history={history}
          publications={publications}
        />
      </header>

      {groups.map((group) => {
        return (
          <div
            key={group.key + ':' + group.metrics.map((m) => m.settings.metric_id).join(',')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              borderTop: '1px solid var(--color-border-subtle)',
              paddingTop: 14,
            }}
          >
            {group.combined ? (
              <CombinedHeader metrics={group.metrics} />
            ) : (
              <SingleMetricBadgeRow metric={group.metrics[0]} window={window} />
            )}
            <ChartFactory metrics={group.metrics} window={window} />
            {group.combined && (
              <CombinedLegend metrics={group.metrics} window={window} />
            )}
          </div>
        )
      })}
    </article>
  )
}

function SingleMetricBadgeRow({
  metric,
  window,
}: {
  metric: MetricHistory
  window: TimeWindow
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '.74rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            fontWeight: 700,
            marginBottom: 6,
          }}
        >
          {metric.settings.metric_label}
        </div>
        <MetricBadge metric={metric} window={window} />
      </div>
    </div>
  )
}

function CombinedHeader({ metrics }: { metrics: MetricHistory[] }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: '.74rem',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color: 'var(--color-muted)',
        fontWeight: 700,
      }}
    >
      {metrics.length} subscales · {metrics[0].settings.unit}
    </div>
  )
}

function CombinedLegend({
  metrics,
  window,
}: {
  metrics: MetricHistory[]
  window: TimeWindow
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 10,
        marginTop: 4,
      }}
    >
      {metrics.map((m) => (
        <div
          key={m.settings.metric_id}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            paddingLeft: 8,
            borderLeft: '2px solid var(--color-border-subtle)',
          }}
        >
          <div
            style={{
              fontSize: '.72rem',
              fontWeight: 600,
              color: 'var(--color-text)',
            }}
          >
            {m.settings.metric_label}
          </div>
          <MetricBadge metric={m} window={window} />
        </div>
      ))}
    </div>
  )
}

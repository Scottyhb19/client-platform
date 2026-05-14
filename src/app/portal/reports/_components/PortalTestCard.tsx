import type {
  MetricHistory,
  TestHistory,
} from '@/lib/testing/loader-types'
import { valuesAtSession } from '@/lib/testing/comparison'
import { ClientChartFactory } from '@/app/(staff)/clients/[id]/_components/reports/client-charts/ClientChartFactory'
import { PortalFramingBlock } from './PortalFramingBlock'

interface Props {
  test: TestHistory
  /** The session-group's anchor session_id. Per Q-J5 (revised
   *  2026-05-14): each card is a frozen snapshot of THIS session, not
   *  the test's latest capture. */
  sessionId: string
  /** Anchor session's conducted_at — passed to ClientChartFactory as
   *  thisSessionDate, used by MilestoneChart to decide first-capture
   *  vs baseline → latest rendering. */
  sessionConductedAt: string
  /** Framing text from the live publication for (sessionId, test_id),
   *  null when the EP wrote no framing for this publication. Phase E
   *  Q3's "latest publication's framing" rule revised by Q-J5 — each
   *  publication carries its own framing. */
  framing: string | null
}

/**
 * One test card inside a PortalSessionGroup. Renders per-metric via
 * ClientChartFactory, anchoring all metric values on the group's
 * session_id. Framing block (when present) sits above the metrics.
 *
 * Metrics where this session captured no value (defensive — the
 * per-publication grouping already filters at the test level) render
 * nothing. Metrics with client_view_chart = 'hidden' render nothing
 * via ClientChartFactory's dispatch.
 */
export function PortalTestCard({
  test,
  sessionId,
  sessionConductedAt,
  framing,
}: Props) {
  return (
    <article
      className="portal-card is-compact"
      style={{
        padding: '14px 14px 16px',
        marginBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <header
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.05rem',
            letterSpacing: '-.005em',
            color: 'var(--color-charcoal)',
          }}
        >
          {test.test_name}
        </h3>
      </header>

      {framing && <PortalFramingBlock text={framing} />}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {test.metrics.map((metric) => (
          <MetricBlock
            key={metric.settings.metric_id}
            metric={metric}
            sessionId={sessionId}
            sessionConductedAt={sessionConductedAt}
          />
        ))}
      </div>
    </article>
  )
}

function MetricBlock({
  metric,
  sessionId,
  sessionConductedAt,
}: {
  metric: MetricHistory
  sessionId: string
  sessionConductedAt: string
}) {
  const values = valuesAtSession(metric, sessionId)
  if (!values) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '.66rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          fontWeight: 700,
        }}
      >
        {metric.settings.metric_label}
      </div>
      <ClientChartFactory
        metric={metric}
        thisSessionValues={values}
        thisSessionDate={sessionConductedAt}
        framingText={null}
      />
    </div>
  )
}

import type {
  MetricHistory,
  PublicationRow,
  TestHistory,
} from '@/lib/testing/loader-types'
import { ClientChartFactory } from '@/app/(staff)/clients/[id]/_components/reports/client-charts/ClientChartFactory'
import { PortalFramingBlock } from './PortalFramingBlock'

interface Props {
  test: TestHistory
  publications: PublicationRow[]
}

/**
 * One card per test, sorted into the page by most-recent activity (see
 * DataView). Per Q3 sign-off, framing text is drawn from the most
 * recent live publication for this test and shown once at the top —
 * not repeated per metric.
 *
 * Each metric inside the card dispatches via ClientChartFactory on the
 * resolved `client_view_chart`. Metrics with `client_view_chart =
 * 'hidden'` render nothing; if every metric is hidden, DataView upstream
 * filters the test out so the card never appears.
 */
export function PortalTestCard({ test, publications }: Props) {
  const framing = pickLatestFramingForTest(test.test_id, publications)

  return (
    <article
      style={{
        background: '#fff',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
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
        {test.metrics.map((metric) => {
          const latest = pickLatestSession(metric)
          if (!latest) return null
          return (
            <MetricBlock
              key={metric.settings.metric_id}
              metric={metric}
              latest={latest}
            />
          )
        })}
      </div>
    </article>
  )
}

function MetricBlock({
  metric,
  latest,
}: {
  metric: MetricHistory
  latest: LatestSession
}) {
  // Multi-metric tests (KOOS, CMJ) want a per-metric label so the client
  // knows which subscale is which. Single-metric tests (most ROM) skip
  // it — the card header carries the test name and there's nothing to
  // disambiguate.
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
        thisSessionValues={{
          left: latest.left,
          right: latest.right,
          unilateral: latest.unilateral,
        }}
        thisSessionDate={latest.date}
        framingText={null}
      />
    </div>
  )
}

interface LatestSession {
  date: string
  left?: number
  right?: number
  unilateral?: number
}

/**
 * Find the latest session for this metric and pull every side captured
 * in that session. Bilateral metrics record both sides at the same
 * conducted_at, so this groups them correctly.
 */
function pickLatestSession(metric: MetricHistory): LatestSession | null {
  if (metric.points.length === 0) return null
  let latestSessionId: string | null = null
  let latestDate: string | null = null
  for (const p of metric.points) {
    if (latestDate === null || p.conducted_at > latestDate) {
      latestDate = p.conducted_at
      latestSessionId = p.session_id
    }
  }
  if (!latestSessionId || !latestDate) return null

  const result: LatestSession = { date: latestDate }
  for (const p of metric.points) {
    if (p.session_id !== latestSessionId) continue
    if (p.side === 'left') result.left = p.value
    else if (p.side === 'right') result.right = p.value
    else if (p.side === null) result.unilateral = p.value
  }
  return result
}

/**
 * Most recent live publication for this test. Per Q3 sign-off, the
 * framing on the latest publication is the one shown — earlier
 * publications' framing is superseded.
 */
function pickLatestFramingForTest(
  testId: string,
  publications: PublicationRow[],
): string | null {
  let latest: PublicationRow | null = null
  for (const p of publications) {
    if (p.test_id !== testId) continue
    if (latest === null || p.published_at > latest.published_at) {
      latest = p
    }
  }
  if (!latest) return null
  if (!latest.framing_text || latest.framing_text.trim() === '') return null
  return latest.framing_text
}

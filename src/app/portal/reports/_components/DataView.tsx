import type {
  ClientTestHistory,
  PublicationRow,
} from '@/lib/testing/loader-types'
import { PortalEmpty } from '../../_components/PortalTop'
import { PortalTestCard } from './PortalTestCard'

interface Props {
  history: ClientTestHistory
  publications: PublicationRow[]
}

/**
 * Per Q2 sign-off: flat list of test cards, sorted by
 * `most_recent_conducted_at` descending. Tests where every metric is
 * `client_view_chart = 'hidden'` are filtered out — they would render
 * an empty card.
 *
 * The loader's `tests` array is already filtered by RLS to publish-
 * visible content. The visibility filter here is a UI cosmetic on top
 * (post-D.6 no schema metric is `hidden`, but the dispatch supports it).
 */
export function DataView({ history, publications }: Props) {
  const visibleTests = history.tests.filter((t) =>
    t.metrics.some((m) => m.settings.client_view_chart !== 'hidden'),
  )

  if (visibleTests.length === 0) {
    return (
      <PortalEmpty
        title="No data yet"
        message="Your testing data will appear here once your EP shares a result."
      />
    )
  }

  const ordered = [...visibleTests].sort((a, b) =>
    b.most_recent_conducted_at.localeCompare(a.most_recent_conducted_at),
  )

  return (
    <div style={{ padding: '0 16px 24px' }}>
      {ordered.map((test) => (
        <PortalTestCard
          key={test.test_id}
          test={test}
          publications={publications}
        />
      ))}
    </div>
  )
}

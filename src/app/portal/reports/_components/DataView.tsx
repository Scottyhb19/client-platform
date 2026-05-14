import type {
  ClientTestHistory,
  PublicationRow,
} from '@/lib/testing/loader-types'
import { groupHistoryBySession } from '@/lib/testing/comparison'
import { PortalEmpty } from '../../_components/PortalTop'
import { PortalSessionGroup } from './PortalSessionGroup'

interface Props {
  history: ClientTestHistory
  publications: PublicationRow[]
}

/**
 * Portal Data tab — session-grouped tests, newest first.
 *
 * Per Q-J1 + Q-J5 sign-off (revised 2026-05-14): one group per session
 * with at least one live publication. A test with N live publications
 * appears in N groups — each is a "what was tested in this session"
 * snapshot. Standalone captures (battery_name === null) render as
 * one-test groups with no special bucket (Q-J6 (a)).
 *
 * Empty-state (Q-J7 (a)) covers all three empty paths uniformly: no
 * captures yet / captures but no live publications / captures with
 * all-hidden metrics. The factual copy keeps clients on §02 voice
 * without leaking staff-side workflow detail.
 */
export function DataView({ history, publications }: Props) {
  const groups = groupHistoryBySession(history, publications)

  if (groups.length === 0) {
    return (
      <PortalEmpty
        title="No data yet"
        message="Your testing data will appear here once your EP shares a result."
      />
    )
  }

  return (
    <div style={{ padding: '0 16px 24px' }}>
      {groups.map((group, index) => (
        <PortalSessionGroup
          key={group.session_id}
          group={group}
          // Newest group expanded by default per Q-J9a; others collapsed.
          defaultExpanded={index === 0}
        />
      ))}
    </div>
  )
}

'use client'

/**
 * BatteryView — top-level view for the Reports tab's Test Battery mode
 * (Phase M Q-M1 (a) — toggle lives in the Reports tab header; this is
 * the body the toggle renders when mode is `'battery'`).
 *
 * Pivots the client's test history into one card per saved battery via
 * `groupHistoryByBattery`. Order is:
 *   1. Active saved batteries from `batteries[]` (Q-M9 (a) — even zero-
 *      applied ones render with the muted "Not yet applied" state).
 *   2. Archived batteries (referenced by sessions but no longer in the
 *      active list).
 *   3. Orphan pseudo-group "Not in a saved battery" at the bottom
 *      (Q-J12 locked), iff any sessions exist with
 *      `applied_battery_id = NULL`.
 *
 * In M-2 each card is header-only — name + session count. M-3 fills
 * the body with the Sessions ↔ Progression sub-toggle.
 *
 * Not used on the session-builder rail (Q-M7 refinement in §7.2 of
 * the gap doc — the rail becomes a session-grouped feed instead of
 * carrying its own Category↔Battery toggle).
 */

import Link from 'next/link'
import { groupHistoryByBattery } from '@/lib/testing/comparison'
import type {
  BatteryRow,
  ClientTestHistory,
  PublicationRow,
} from '@/lib/testing/loader-types'
import { BatteryCard } from './BatteryCard'

interface BatteryViewProps {
  clientId: string
  history: ClientTestHistory
  batteries: BatteryRow[]
  publications: PublicationRow[]
}

export function BatteryView({
  clientId,
  history,
  batteries,
  publications,
}: BatteryViewProps) {
  const groups = groupHistoryByBattery(history, batteries)

  if (groups.length === 0) {
    return <EmptyState />
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {groups.map((g) => (
        <BatteryCard
          key={g.battery_id ?? '__orphan__'}
          group={g}
          history={history}
          publications={publications}
          clientId={clientId}
        />
      ))}
    </div>
  )
}

function EmptyState() {
  // Reached when the org has no active saved batteries AND this client
  // has no orphan captures. Once a battery is created OR a session is
  // captured without a battery, groups[] is non-empty and this state
  // is skipped.
  return (
    <div
      className="card"
      style={{
        padding: '40px 32px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        No saved batteries yet
      </div>
      <p
        style={{
          fontSize: '.86rem',
          lineHeight: 1.55,
          margin: '0 auto',
          maxWidth: 460,
        }}
      >
        Create a saved battery in{' '}
        <Link
          href="/settings/tests"
          style={{
            color: 'var(--color-charcoal)',
            textDecoration: 'underline',
          }}
        >
          Settings → Tests → Saved batteries
        </Link>{' '}
        to organise testing here.
      </p>
    </div>
  )
}

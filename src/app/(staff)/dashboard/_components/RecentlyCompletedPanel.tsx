'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  initialsFor,
  toneFor,
} from '../../clients/_lib/client-helpers'
import { SessionExerciseSummary } from '../../_components/SessionExerciseSummary'
import type { ProfileCompletionExercise } from '../../clients/[id]/_components/ClientProfile'

export type DashboardCompletion = {
  id: string
  client_id: string
  client_first_name: string
  client_last_name: string
  // From program_days; null when the parent program_day was soft-deleted.
  day_label: string
  scheduled_date: string | null
  completed_at: string
  session_rpe: number | null
  set_count: number
  exercises: ProfileCompletionExercise[]
}

/**
 * Phase L (2026-05-14) — dashboard "Recently completed" panel.
 *
 * Replaces the previous `ActivityFeed` at the bottom of `/dashboard`. The
 * EP framed the dashboard as exactly three surfaces (Needs Attention,
 * Today's sessions, Recent activity from client portal); this panel is
 * that third surface. Clinical notes that used to surface via the old
 * ActivityFeed are still reachable from each client's profile + flagged
 * notes still appear in the Needs Attention panel above.
 *
 * Sort: `completed_at DESC` — most recent first.
 * Limit: 5 (loader-side; the panel doesn't paginate).
 * Single-row-expanded per Q-L10 (a).
 * Chevron hidden when `set_count === 0` per Q-L11 (b).
 */
export function RecentlyCompletedPanel({
  completions,
}: {
  completions: DashboardCompletion[]
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 22px',
          borderBottom: '1px solid var(--color-border-subtle)',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1rem',
              color: 'var(--color-primary)',
            }}
          >
            Recently completed
          </div>
          <div
            style={{
              fontSize: '.74rem',
              color: 'var(--color-muted)',
              marginTop: 1,
            }}
          >
            Sessions your clients have logged from the portal
          </div>
        </div>
      </div>

      {completions.length === 0 ? (
        <div
          style={{
            padding: '28px 22px',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.88rem',
          }}
        >
          No sessions completed yet. Sessions your clients finish will show
          here.
        </div>
      ) : (
        <div>
          {completions.map((c, i) => {
            const last = i === completions.length - 1
            const isOpen = expandedId === c.id
            return (
              <CompletionRow
                key={c.id}
                completion={c}
                isLast={last}
                isOpen={isOpen}
                onToggle={() =>
                  setExpandedId((prev) => (prev === c.id ? null : c.id))
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function CompletionRow({
  completion,
  isLast,
  isOpen,
  onToggle,
}: {
  completion: DashboardCompletion
  isLast: boolean
  isOpen: boolean
  onToggle: () => void
}) {
  const canExpand = completion.set_count > 0
  const fullName = `${completion.client_first_name} ${completion.client_last_name}`
  const detailBits: string[] = [completion.day_label]
  if (completion.session_rpe !== null) {
    detailBits.push(`RPE ${completion.session_rpe}`)
  }

  return (
    <div
      style={{
        borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto auto',
          gap: 14,
          alignItems: 'center',
          padding: '13px 22px',
        }}
      >
        <Link
          href={`/clients/${completion.client_id}`}
          aria-label={`Open ${fullName}'s profile`}
          style={{
            // Display: contents lets the Link's child elements participate
            // in the parent grid layout directly. Click target is the
            // visible row except the chevron column.
            display: 'contents',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <span
            className={`avatar ${toneFor(completion.client_id)}`}
            style={{ width: 32, height: 32, fontSize: 32 * 0.38 }}
          >
            {initialsFor(
              completion.client_first_name,
              completion.client_last_name,
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                color: 'var(--color-charcoal)',
                fontSize: '.88rem',
                lineHeight: 1.3,
              }}
            >
              {fullName}
            </div>
            <div
              style={{
                fontSize: '.76rem',
                color: 'var(--color-text-light)',
                marginTop: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {detailBits.join(' · ')}
            </div>
          </div>
          <span
            style={{
              fontSize: '.72rem',
              color: 'var(--color-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              letterSpacing: '.02em',
              whiteSpace: 'nowrap',
            }}
          >
            {relativeTime(completion.completed_at)}
          </span>
        </Link>
        {canExpand ? (
          <button
            type="button"
            aria-label={isOpen ? 'Hide session detail' : 'Show session detail'}
            aria-expanded={isOpen}
            onClick={onToggle}
            style={{
              width: 28,
              height: 28,
              display: 'inline-grid',
              placeItems: 'center',
              borderRadius: 'var(--radius-button)',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-light)',
              cursor: 'pointer',
              transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {isOpen ? (
              <ChevronUp size={16} aria-hidden />
            ) : (
              <ChevronDown size={16} aria-hidden />
            )}
          </button>
        ) : (
          // Reserve the column so rows with no chevron still align with
          // rows that have one. 28px matches the chevron button width.
          <span aria-hidden style={{ width: 28, height: 28 }} />
        )}
      </div>
      {canExpand && isOpen && (
        <div
          style={{
            padding: '4px 22px 16px 68px',
            // 68px left padding lines the expander content up under the
            // client name column (32px avatar + 14px gap + 22px outer
            // padding = 68px).
            background: 'var(--color-surface)',
            borderTop: '1px solid var(--color-border-hairline)',
          }}
        >
          <div style={{ paddingTop: 12 }}>
            <SessionExerciseSummary exercises={completion.exercises} />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * "just now" / "12 min ago" / "3 hr ago" / "2 days ago" / "Sat 10 May".
 * Same shape as the old ActivityFeed.relativeTime (now deleted) — kept
 * inline here so the helper travels with its only consumer.
 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

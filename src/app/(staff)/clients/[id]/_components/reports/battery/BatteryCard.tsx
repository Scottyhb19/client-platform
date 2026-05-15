'use client'

/**
 * BatteryCard — one card per saved battery (or the orphan pseudo-group)
 * on the Reports tab's Test Battery view.
 *
 * M-3 layout:
 * - Header: battery name + subline (session count + most-recent date,
 *   or "Not yet applied to this client" for active batteries with zero
 *   applications). Click anywhere on the header to toggle the body.
 * - Chevron rotates 0deg → -90deg on collapse.
 * - Body (when expanded): sub-toggle Progression ↔ Sessions, then the
 *   chosen sub-view.
 * - Cards with zero applied sessions (Q-M9 (a) "Not yet applied")
 *   render header-only — no chevron, no body, muted via opacity.
 *
 * Per Q-M6 (b) the orphan card is collapsible with default expanded;
 * saved-battery cards inherit the same behaviour for visual
 * consistency. Per Q-J13 the sub-toggle is per-card with its own
 * state; per-card independence so the EP can have one battery on
 * Progression and another on Sessions simultaneously.
 *
 * Default sub-view is Progression — the handoff brief frames the
 * Test Battery view's primary lens as "how does this whole assessment
 * shape up over its repetitions?", which is exactly Progression.
 *
 * Collapse animation mirrors the portal Phase J `PortalSessionGroup`
 * pattern: grid-template-rows 1fr ⇄ 0fr with overflow:hidden inner
 * div, 300ms cubic-bezier(0.4, 0, 0.2, 1).
 */

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { BatteryGroup } from '@/lib/testing/comparison'
import type {
  ClientTestHistory,
  PublicationRow,
} from '@/lib/testing/loader-types'
import { timeAgo } from '../helpers'
import { BatteryProgressionView } from './BatteryProgressionView'
import { BatterySessionsView } from './BatterySessionsView'

type SubView = 'progression' | 'sessions'

interface BatteryCardProps {
  group: BatteryGroup
  history: ClientTestHistory
  publications: PublicationRow[]
  clientId: string
}

export function BatteryCard({
  group,
  history,
  publications,
  clientId,
}: BatteryCardProps) {
  const sessionCount = group.sessions.length
  const isEmpty = sessionCount === 0

  const [expanded, setExpanded] = useState(true)
  const [subView, setSubView] = useState<SubView>('progression')

  if (isEmpty) {
    // Header-only card. No chevron — there's no body to hide. Muted
    // via opacity so a fresh client's never-yet-applied batteries
    // don't compete visually with the ones that have data.
    return (
      <article
        className="card"
        style={{
          padding: 18,
          opacity: 0.65,
        }}
      >
        <NameLine group={group} />
        <SublineText group={group} />
      </article>
    )
  }

  const contentId = `battery-card-content-${
    group.battery_id ?? '__orphan__'
  }`

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
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={contentId}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          minWidth: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <NameLine group={group} />
          <SublineText group={group} />
        </div>
        <ChevronDown
          size={18}
          aria-hidden
          style={{
            color: 'var(--color-muted)',
            flexShrink: 0,
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>
      <div
        id={contentId}
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition:
            'grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              paddingTop: 4,
            }}
          >
            <SubToggle mode={subView} onChange={setSubView} />
            {subView === 'progression' ? (
              <BatteryProgressionView
                sessions={group.sessions}
                history={history}
                publications={publications}
                clientId={clientId}
              />
            ) : (
              <BatterySessionsView
                sessions={group.sessions}
                history={history}
              />
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function NameLine({ group }: { group: BatteryGroup }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontStyle: group.is_orphan ? 'italic' : 'normal',
        fontSize: '1.05rem',
        color: 'var(--color-charcoal)',
        letterSpacing: '-0.01em',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <span>{group.battery_name}</span>
      {group.is_archived && (
        <span
          className="tag"
          style={{
            fontSize: '.62rem',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Archived
        </span>
      )}
    </div>
  )
}

function SublineText({ group }: { group: BatteryGroup }) {
  const sessionCount = group.sessions.length
  return (
    <div
      style={{
        fontSize: '.76rem',
        color: 'var(--color-text-light)',
        marginTop: 2,
      }}
    >
      {sessionCount === 0
        ? 'Not yet applied to this client'
        : `${sessionCount} session${
            sessionCount === 1 ? '' : 's'
          } · last ${timeAgo(group.sessions[0].conducted_at)}`}
    </div>
  )
}

function SubToggle({
  mode,
  onChange,
}: {
  mode: SubView
  onChange: (next: SubView) => void
}) {
  return (
    <div
      role="group"
      aria-label="Battery sub-view"
      style={{
        display: 'inline-flex',
        background: '#EDE8E2',
        borderRadius: 999,
        padding: 2,
        flexShrink: 0,
        alignSelf: 'flex-start',
      }}
    >
      <Segment
        active={mode === 'progression'}
        onClick={() => onChange('progression')}
        label="Progression"
      />
      <Segment
        active={mode === 'sessions'}
        onClick={() => onChange('sessions')}
        label="Sessions"
      />
    </div>
  )
}

function Segment({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: active ? '#fff' : 'transparent',
        border: 'none',
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: '.74rem',
        fontWeight: 600,
        cursor: 'pointer',
        color: active ? 'var(--color-charcoal)' : 'var(--color-muted)',
        boxShadow: active ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
        whiteSpace: 'nowrap',
        transition:
          'background 150ms cubic-bezier(0.4, 0, 0.2, 1), color 150ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {label}
    </button>
  )
}

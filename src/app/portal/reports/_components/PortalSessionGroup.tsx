'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { SessionGroup } from '@/lib/testing/comparison'
import { PortalTestCard } from './PortalTestCard'

interface Props {
  group: SessionGroup
  /** Newest group expanded by default per Q-J9a sign-off; older groups
   *  default collapsed. DataView sets this based on group index. */
  defaultExpanded: boolean
}

/**
 * One session-as-battery group on the portal Data tab. Header carries
 * the date + battery name (when one was applied) + count; body is the
 * list of PortalTestCards anchored on this session.
 *
 * Collapsible per Q-J9 sign-off (chat 2026-05-14): newest expanded,
 * older collapsed. 300ms reveal using the design-system easing curve.
 *
 * Per Q-J5 sign-off (revised 2026-05-14): each test card in this
 * group anchors on this group's session_id, not on the metric's
 * latest captured session. Frozen-snapshot semantic — the Jan card
 * shows Jan's value, the Mar card shows Mar's value.
 *
 * Per Q-J6 (a): standalone captures (battery_name === null) render
 * as a one-test group with no special label — just the date.
 * Multi-test no-battery captures show "N tests" as the second line.
 */
export function PortalSessionGroup({ group, defaultExpanded }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const count = group.tests.length
  const secondLine = group.battery_name
    ? `${group.battery_name} · ${count} test${count === 1 ? '' : 's'}`
    : count > 1
      ? `${count} tests`
      : null

  const contentId = `portal-session-group-content-${group.session_id}`

  return (
    <section style={{ marginBottom: 28 }}>
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
          marginBottom: 12,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.95rem',
              color: 'var(--color-charcoal)',
              letterSpacing: '-.005em',
              lineHeight: 1.2,
            }}
          >
            {formatGroupDate(group.conducted_at)}
          </div>
          {secondLine && (
            <div
              style={{
                fontSize: '.74rem',
                color: 'var(--color-muted)',
                marginTop: 2,
              }}
            >
              {secondLine}
            </div>
          )}
        </div>
        <ChevronDown
          size={18}
          aria-hidden
          style={{
            color: 'var(--color-muted)',
            flexShrink: 0,
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition:
              'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
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
          {group.tests.map(({ test, framing_text }) => (
            <PortalTestCard
              key={`${group.session_id}:${test.test_id}`}
              test={test}
              sessionId={group.session_id}
              sessionConductedAt={group.conducted_at}
              framing={framing_text}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function formatGroupDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

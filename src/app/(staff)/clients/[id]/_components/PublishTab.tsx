'use client'

/**
 * PublishTab — staff-side surface for the on_publish review/publish flow.
 *
 * Two sections:
 *   - "Needs review": sessions with on_publish metrics that don't yet
 *     have a live client_publications row. The EP types optional framing
 *     text and clicks Publish.
 *   - "Published": sessions with a live publication. Framing is read-only
 *     here (per schema, no updated_at on the publication row); the EP
 *     can Unpublish to remove visibility, then re-publish if they want
 *     to change the framing.
 *
 * Per docs/decisions.md D-004: this lives at /clients/[id]?tab=publish.
 * The tab is conditionally visible — see ClientProfile.tsx for the
 * gating rule (anySessionWithOnPublish).
 *
 * `auto`-visibility metrics never reach this surface (always visible to
 * the client). `never`-visibility metrics never reach it either —
 * RLS-enforced hard wall. Only `on_publish` metrics show up.
 */

import type {
  ClientTestHistory,
  PublicationRow,
} from '@/lib/testing/loader-types'
import { PublishCard } from './reports/PublishCard'
import { buildPublishView } from './reports/helpers'

interface PublishTabProps {
  clientId: string
  testHistory: ClientTestHistory
  publications: PublicationRow[]
}

export function PublishTab({
  clientId,
  testHistory,
  publications,
}: PublishTabProps) {
  const view = buildPublishView(
    testHistory ?? { tests: [], categories: [], sessions: [] },
    publications ?? [],
  )
  const noWorkflow = view.pending.length === 0 && view.published.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.25rem',
            color: 'var(--color-charcoal)',
            letterSpacing: '-0.01em',
          }}
        >
          Publish to client
        </div>
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.5,
            maxWidth: 560,
          }}
        >
          Review test sessions before they appear in the client's portal.
          Add a framing sentence to give context, then publish — or hold
          back and decide later.
        </div>
      </header>

      {noWorkflow ? (
        <EmptyState />
      ) : (
        <>
          <Section
            title="Needs review"
            count={view.pending.length}
            tone="warning"
            empty="Nothing to review right now. New on_publish captures will appear here."
          >
            {view.pending.map((entry) => (
              <PublishCard
                key={entry.session.session_id}
                clientId={clientId}
                entry={entry}
              />
            ))}
          </Section>
          <Section
            title="Published"
            count={view.published.length}
            tone="ok"
            empty="No live publications yet."
          >
            {view.published.map((entry) => (
              <PublishCard
                key={entry.session.session_id}
                clientId={clientId}
                entry={entry}
              />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  tone,
  empty,
  children,
}: {
  title: string
  count: number
  tone: 'warning' | 'ok'
  empty: string
  children: React.ReactNode
}) {
  const dotColour =
    tone === 'warning' ? 'var(--color-warning)' : 'var(--color-accent)'
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColour,
            flexShrink: 0,
          }}
          aria-hidden
        />
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: '.92rem',
            fontWeight: 700,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: 'var(--color-charcoal)',
          }}
        >
          {title}
        </h2>
        <span
          style={{
            fontSize: '.74rem',
            color: 'var(--color-muted)',
          }}
        >
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div
          className="card"
          style={{
            padding: 20,
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            textAlign: 'center',
          }}
        >
          {empty}
        </div>
      ) : (
        children
      )}
    </section>
  )
}

function EmptyState() {
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
        Nothing to publish yet
      </div>
      <p
        style={{
          fontSize: '.86rem',
          lineHeight: 1.55,
          margin: '0 auto',
          maxWidth: 460,
        }}
      >
        This client hasn't captured any metrics that require review before
        being shared. PROMs, body composition, and other clinician-flagged
        results show up here when captured.
      </p>
    </div>
  )
}

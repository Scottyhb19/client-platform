'use client'

/**
 * TestPublishButton — top-right control on each TestCard for the
 * per-test publish flow (Phase D.5).
 *
 * State machine:
 *   - Test has no on_publish metrics → returns null (button hidden)
 *   - Latest unpublished session exists → "Publish" call-to-action
 *     (warning-coloured tone since it's pending)
 *   - All on_publish sessions are published → "Published" badge
 *     (accent-coloured tone). Click opens the same dialog so the EP
 *     can review framing or unpublish.
 *
 * The dialog handles the actual publish/unpublish actions; this
 * component is the trigger.
 */

import { CircleCheck, Send } from 'lucide-react'
import { useState } from 'react'
import { TestPublishDialog } from './TestPublishDialog'
import {
  latestLivePublicationForTest,
  latestUnpublishedSessionForTest,
  testIsPublishable,
} from './helpers'
import type {
  ClientTestHistory,
  PublicationRow,
  TestHistory,
} from '@/lib/testing/loader-types'

interface TestPublishButtonProps {
  clientId: string
  test: TestHistory
  history: ClientTestHistory
  publications: PublicationRow[]
}

export function TestPublishButton({
  clientId,
  test,
  history,
  publications,
}: TestPublishButtonProps) {
  const [open, setOpen] = useState(false)

  if (!testIsPublishable(test)) return null

  const pendingSession = latestUnpublishedSessionForTest(
    test,
    history,
    publications,
  )
  const livePublications = publications.filter(
    (p) => p.test_id === test.test_id,
  )
  const livePublicationsLatestFirst = [...livePublications].sort((a, b) =>
    b.published_at.localeCompare(a.published_at),
  )

  const isPending = pendingSession !== null
  const liveCount = livePublications.length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          isPending
            ? `Publish ${test.test_name}`
            : `Review ${test.test_name} publications`
        }
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 11px',
          borderRadius: 999,
          border: '1px solid',
          borderColor: isPending
            ? 'rgba(232,163,23,0.35)'
            : 'rgba(45,178,76,0.35)',
          background: isPending
            ? 'rgba(232,163,23,0.08)'
            : 'rgba(45,178,76,0.08)',
          color: isPending ? '#9a7a0e' : 'var(--color-primary)',
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: '.74rem',
          letterSpacing: '0.02em',
          cursor: 'pointer',
          transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
          flexShrink: 0,
        }}
      >
        {isPending ? (
          <>
            <Send size={11} aria-hidden /> Publish
          </>
        ) : (
          <>
            <CircleCheck size={11} aria-hidden />
            {liveCount > 1 ? `Published (${liveCount})` : 'Published'}
          </>
        )}
      </button>

      {open && (
        <TestPublishDialog
          clientId={clientId}
          test={test}
          history={history}
          publications={publications}
          pendingSession={pendingSession}
          livePublications={livePublicationsLatestFirst}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

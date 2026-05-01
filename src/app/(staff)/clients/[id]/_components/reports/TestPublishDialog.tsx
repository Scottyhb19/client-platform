'use client'

/**
 * TestPublishDialog — modal for the per-test publish flow (Phase D.5).
 *
 * Two sections:
 *   - "Publish next session" (visible only when an unpublished
 *     on_publish session exists for this test). Shows preview of the
 *     latest unpublished session's metrics + framing input + Publish.
 *   - "Currently published" (visible when at least one live
 *     publication exists for this test). Lists all live publications
 *     (chronological, latest first) with framing + Unpublish per row.
 *
 * Editing framing on a live publication is intentionally not supported
 * (per schema: client_publications has no updated_at). To change the
 * framing, the EP unpublishes then re-publishes.
 *
 * The dialog is dismissed via the close button or the Escape key. Body
 * scroll is locked while open.
 */

import { CircleCheck, X } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  publishTestAction,
  unpublishPublicationAction,
} from '../../publish-actions'
import { ClientChartFactory } from './client-charts/ClientChartFactory'
import { formatShortDate } from './helpers'
import {
  onPublishMetricsForTestInSession,
} from './helpers'
import type {
  ClientTestHistory,
  PublicationRow,
  SessionInfo,
  TestHistory,
} from '@/lib/testing/loader-types'

const FRAMING_MAX = 280

interface TestPublishDialogProps {
  clientId: string
  test: TestHistory
  history: ClientTestHistory
  publications: PublicationRow[]
  /** The latest unpublished on_publish session for this test, if any.
   *  When null the "Publish next session" section is hidden. */
  pendingSession: SessionInfo | null
  /** All live publications for this test, latest published_at first. */
  livePublications: PublicationRow[]
  onClose: () => void
}

export function TestPublishDialog({
  clientId,
  test,
  history,
  publications,
  pendingSession,
  livePublications,
  onClose,
}: TestPublishDialogProps) {
  // Escape dismisses; lock body scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Publish ${test.test_name}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, 0.55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 200,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: 'calc(100vh - 32px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <DialogHeader test={test} onClose={onClose} />

        <div
          style={{
            overflow: 'auto',
            padding: '18px 22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
          {pendingSession && (
            <PendingSessionForm
              clientId={clientId}
              test={test}
              session={pendingSession}
              history={history}
              publications={publications}
            />
          )}
          {livePublications.length > 0 && (
            <PublishedList
              clientId={clientId}
              test={test}
              publications={livePublications}
            />
          )}
          {!pendingSession && livePublications.length === 0 && (
            <div
              style={{
                fontSize: '.85rem',
                color: 'var(--color-text-light)',
                textAlign: 'center',
                padding: '20px 12px',
              }}
            >
              Nothing to publish for this test yet — capture an on_publish
              metric first.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DialogHeader({
  test,
  onClose,
}: {
  test: TestHistory
  onClose: () => void
}) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '16px 22px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '.66rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            fontWeight: 700,
            marginBottom: 2,
          }}
        >
          Publish to client
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-charcoal)',
            letterSpacing: '-0.01em',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {test.test_name}
          {test.is_custom && (
            <span
              className="tag new"
              style={{
                fontSize: '.58rem',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Custom
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="btn ghost"
        style={{ padding: 8 }}
      >
        <X size={16} aria-hidden />
      </button>
    </header>
  )
}

function PendingSessionForm({
  clientId,
  test,
  session,
  history,
  publications,
}: {
  clientId: string
  test: TestHistory
  session: SessionInfo
  history: ClientTestHistory
  publications: PublicationRow[]
}) {
  const router = useRouter()
  const [framing, setFraming] = useState('')
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const metricsThisSession = onPublishMetricsForTestInSession(
    test,
    session.session_id,
  )

  const remaining = FRAMING_MAX - framing.length
  const overLimit = remaining < 0

  function handlePublish() {
    setError(null)
    startTransition(async () => {
      const res = await publishTestAction({
        clientId,
        sessionId: session.session_id,
        testId: test.test_id,
        framingText: framing.trim() === '' ? null : framing,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel
        text="Publish next session"
        tone="warning"
      />
      <div
        style={{
          fontSize: '.84rem',
          color: 'var(--color-text-light)',
          lineHeight: 1.5,
        }}
      >
        Session of <strong style={{ color: 'var(--color-text)' }}>
          {formatShortDate(session.conducted_at)}
        </strong> — {metricsThisSession.length} metric
        {metricsThisSession.length === 1 ? '' : 's'} captured for this test.
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: '12px 14px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 10,
        }}
      >
        {metricsThisSession.map((m) => (
          <div
            key={m.metric.settings.metric_id}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '.68rem',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                fontWeight: 700,
              }}
            >
              {m.metric.settings.metric_label}
            </div>
            <ClientChartFactory
              metric={m.metric}
              thisSessionValues={m.thisSessionValues}
              thisSessionDate={session.conducted_at}
              framingText={framing}
            />
          </div>
        ))}
      </div>
      <FramingTextarea
        value={framing}
        onChange={setFraming}
        disabled={busy}
        overLimit={overLimit}
      />
      <div
        style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}
      >
        <button
          type="button"
          className="btn primary"
          onClick={handlePublish}
          disabled={busy || overLimit}
          style={{ fontSize: '.84rem' }}
        >
          {busy ? 'Publishing…' : 'Publish to client'}
        </button>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            fontSize: '.78rem',
            color: 'var(--color-alert)',
          }}
        >
          {error}
        </div>
      )}
      {/* Reference args — silences unused-imports for cases the dialog
          calls in directly without prop drilling further. */}
      <input type="hidden" data-history={history.tests.length} data-pubs={publications.length} />
    </section>
  )
}

function PublishedList({
  clientId,
  test,
  publications,
}: {
  clientId: string
  test: TestHistory
  publications: PublicationRow[]
}) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <SectionLabel
        text={
          publications.length === 1
            ? 'Currently published'
            : `Currently published (${publications.length})`
        }
        tone="ok"
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {publications.map((p) => (
          <PublishedRow
            key={p.id}
            clientId={clientId}
            testName={test.test_name}
            publication={p}
          />
        ))}
      </div>
    </section>
  )
}

function PublishedRow({
  clientId,
  testName,
  publication,
}: {
  clientId: string
  testName: string
  publication: PublicationRow
}) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleUnpublish() {
    setError(null)
    startTransition(async () => {
      const res = await unpublishPublicationAction({
        clientId,
        publicationId: publication.id,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '12px 14px',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.92rem',
              color: 'var(--color-charcoal)',
            }}
          >
            {formatShortDate(publication.published_at)}
          </span>
          <span
            className="tag active"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '.6rem',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <CircleCheck size={10} aria-hidden /> Live
          </span>
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={handleUnpublish}
          disabled={busy}
          aria-label={`Unpublish ${testName} session of ${formatShortDate(publication.published_at)}`}
          style={{ fontSize: '.76rem', padding: '4px 10px' }}
        >
          {busy ? 'Unpublishing…' : 'Unpublish'}
        </button>
      </div>
      {publication.framing_text ? (
        <p
          style={{
            margin: 0,
            fontSize: '.84rem',
            lineHeight: 1.5,
            color: 'var(--color-text)',
            fontStyle: 'italic',
          }}
        >
          {publication.framing_text}
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: '.78rem',
            color: 'var(--color-muted)',
            fontStyle: 'italic',
          }}
        >
          Published without framing.
        </p>
      )}
      {error && (
        <div
          role="alert"
          style={{
            fontSize: '.74rem',
            color: 'var(--color-alert)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function SectionLabel({
  text,
  tone,
}: {
  text: string
  tone: 'warning' | 'ok'
}) {
  const dot =
    tone === 'warning' ? 'var(--color-warning)' : 'var(--color-accent)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dot,
          flexShrink: 0,
        }}
        aria-hidden
      />
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: '.78rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-charcoal)',
        }}
      >
        {text}
      </h3>
    </div>
  )
}

function FramingTextarea({
  value,
  onChange,
  disabled,
  overLimit,
}: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
  overLimit: boolean
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '.66rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-muted)',
          fontWeight: 700,
        }}
      >
        Framing for the client (optional)
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        maxLength={FRAMING_MAX + 50}
        disabled={disabled}
        placeholder="One sentence the client will read alongside the chart. Skip to publish without commentary."
        style={{
          width: '100%',
          padding: '8px 10px',
          fontFamily: 'var(--font-sans)',
          fontSize: '.86rem',
          lineHeight: 1.5,
          border: `1px solid ${overLimit ? 'var(--color-alert)' : 'var(--color-border-subtle)'}`,
          borderRadius: 'var(--radius-input)',
          background: '#fff',
          color: 'var(--color-text)',
          outline: 'none',
          resize: 'vertical',
          minHeight: 56,
        }}
      />
      <div
        style={{
          textAlign: 'right',
          fontSize: '.7rem',
          color: overLimit ? 'var(--color-alert)' : 'var(--color-muted)',
        }}
      >
        {value.length} / {FRAMING_MAX}
      </div>
    </div>
  )
}

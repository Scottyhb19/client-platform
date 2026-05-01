'use client'

/**
 * PublishCard — one card per session in the publish flow.
 *
 * Two display modes:
 *   - mode='pending': framing-text textarea + Publish button. Shown for
 *     sessions with on_publish metrics that don't have a live publication.
 *   - mode='published': framing text shown read-only + Unpublish button.
 *     Shown for sessions with a live publication.
 *
 * The "no editable framing on published" rule comes from the schema:
 * client_publications has no updated_at column. To change framing,
 * unpublish then re-publish — preserves the audit trail.
 *
 * Each on_publish metric in the session renders via ClientChartFactory,
 * so the EP previews exactly what the client will see in the portal.
 * The framing text appears once at the top of the card (not per metric)
 * to match the schema model — one framing_text per publication,
 * not per metric.
 */

import { Eye, EyeOff } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import {
  publishSessionAction,
  unpublishPublicationAction,
} from '../../publish-actions'
import { ClientChartFactory } from './client-charts/ClientChartFactory'
import { formatShortDate } from './helpers'
import type { PublishSessionEntry } from './helpers'

const FRAMING_MAX = 280

interface PublishCardProps {
  clientId: string
  entry: PublishSessionEntry
}

export function PublishCard({ clientId, entry }: PublishCardProps) {
  const isPending = entry.publication === null
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [framingDraft, setFramingDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const framingDisplayed = isPending
    ? framingDraft
    : (entry.publication?.framing_text ?? '')

  function handlePublish() {
    setError(null)
    startTransition(async () => {
      const res = await publishSessionAction({
        clientId,
        sessionId: entry.session.session_id,
        framingText: framingDraft.trim() === '' ? null : framingDraft,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      // Server action revalidates the client page; router.refresh flushes
      // the local cache so the card moves between sections immediately.
      router.refresh()
    })
  }

  function handleUnpublish() {
    if (!entry.publication) return
    setError(null)
    startTransition(async () => {
      const res = await unpublishPublicationAction({
        clientId,
        publicationId: entry.publication!.id,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

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
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
              letterSpacing: '-0.01em',
            }}
          >
            {formatShortDate(entry.session.conducted_at)}
          </div>
          <div
            style={{
              fontSize: '.76rem',
              color: 'var(--color-text-light)',
              marginTop: 2,
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <span>
              {entry.metrics.length} metric
              {entry.metrics.length === 1 ? '' : 's'} to share
            </span>
            {entry.session.battery_name && (
              <>
                <span style={{ color: 'var(--color-muted)' }}>·</span>
                <span>{entry.session.battery_name}</span>
              </>
            )}
          </div>
        </div>
        <StatusBadge isPending={isPending} publishedAt={entry.publication?.published_at} />
      </header>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          borderTop: '1px solid var(--color-border-subtle)',
          paddingTop: 14,
        }}
      >
        {entry.metrics.map((m) => (
          <div
            key={m.metric.settings.metric_id}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '.74rem',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                fontWeight: 700,
              }}
            >
              {m.metric.settings.test_name} ·{' '}
              {m.metric.settings.metric_label}
            </div>
            <ClientChartFactory
              metric={m.metric}
              thisSessionValues={m.thisSessionValues}
              thisSessionDate={entry.session.conducted_at}
              framingText={framingDisplayed}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          borderTop: '1px solid var(--color-border-subtle)',
          paddingTop: 14,
        }}
      >
        <FramingArea
          mode={isPending ? 'edit' : 'view'}
          value={framingDisplayed}
          onChange={(v) => setFramingDraft(v)}
          disabled={pending}
        />
        <ActionRow
          isPending={isPending}
          submitting={pending}
          onPublish={handlePublish}
          onUnpublish={handleUnpublish}
        />
        {error && (
          <div
            role="alert"
            style={{
              fontSize: '.78rem',
              color: 'var(--color-alert)',
              marginTop: 4,
            }}
          >
            {error}
          </div>
        )}
      </div>
    </article>
  )
}

function StatusBadge({
  isPending,
  publishedAt,
}: {
  isPending: boolean
  publishedAt?: string
}) {
  if (isPending) {
    return (
      <span
        className="tag overdue"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: '.66rem',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <EyeOff size={11} aria-hidden /> Held back
      </span>
    )
  }
  return (
    <span
      className="tag active"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: '.66rem',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      <Eye size={11} aria-hidden /> Published
      {publishedAt && (
        <span style={{ fontWeight: 500, marginLeft: 2 }}>
          · {formatShortDate(publishedAt)}
        </span>
      )}
    </span>
  )
}

function FramingArea({
  mode,
  value,
  onChange,
  disabled,
}: {
  mode: 'edit' | 'view'
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  const remaining = FRAMING_MAX - value.length
  const overLimit = remaining < 0

  if (mode === 'view') {
    if (value.trim() === '') {
      return (
        <div
          style={{
            fontSize: '.8rem',
            color: 'var(--color-muted)',
            fontStyle: 'italic',
          }}
        >
          No framing text. To change this, unpublish first then republish
          with new framing.
        </div>
      )
    }
    return (
      <div
        style={{
          fontSize: '.86rem',
          lineHeight: 1.5,
          color: 'var(--color-text)',
          padding: '10px 12px',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 8,
        }}
      >
        {value}
      </div>
    )
  }

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

function ActionRow({
  isPending,
  submitting,
  onPublish,
  onUnpublish,
}: {
  isPending: boolean
  submitting: boolean
  onPublish: () => void
  onUnpublish: () => void
}) {
  if (isPending) {
    return (
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn primary"
          onClick={onPublish}
          disabled={submitting}
          style={{ fontSize: '.84rem' }}
        >
          {submitting ? 'Publishing…' : 'Publish to client'}
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
      <button
        type="button"
        className="btn outline"
        onClick={onUnpublish}
        disabled={submitting}
        style={{ fontSize: '.84rem' }}
      >
        {submitting ? 'Unpublishing…' : 'Unpublish'}
      </button>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { X } from 'lucide-react'
import { type AvatarTone } from '../../clients/_lib/client-helpers'
import { OverdueFollowUpButton } from './OverdueFollowUpButton'

export type AttentionTone =
  | 'flag'
  | 'overdue'
  | 'ended'
  | 'ending'
  | 'reconcile'
  | 'new'
  | 'onboarding'

export type AttentionItem = {
  clientId: string
  avatar: string
  /** Client-category avatar tone (categoryToneFor) — identity, not urgency.
      Urgency lives on the tag chip (`tag ${tone}`) and the stat cards. */
  avatarTone: AvatarTone
  firstName: string
  lastName: string
  tone: AttentionTone
  tag: string
  reason: string
  action: { label: string; href: string }
  priority: number
  // Reconcile rows only: every unactioned session for the client (attendance +
  // note combined). When >1, the row's "Open" opens a per-client modal listing
  // them — each labelled with its type, each opening its own booking on the
  // schedule (highlighted, dimming the rest).
  sessions?: { id: string; when: string; dateIso: string; typeLabel: string }[]
}

// Rule 1 (operator, 2026-06-28): never more than 10 attention rows on the
// dashboard itself. Anything beyond opens the modal (rule 2).
const DASHBOARD_VISIBLE = 10

/**
 * Needs-attention panel. Two deduped-separately groups (Adherence / Clinical
 * admin); a client can appear once in each. The dashboard shows at most 10 rows;
 * a "View all" / "View more" opens a modal housing every row, each still
 * actionable. Counts are by row, not client.
 */
export function AttentionPanel({
  adherence,
  admin,
}: {
  adherence: AttentionItem[]
  admin: AttentionItem[]
}) {
  const [showAll, setShowAll] = useState(false)
  const total = adherence.length + admin.length

  // Cap the dashboard at 10 rows total, Adherence first; the rest live in the
  // modal. (Realistically rare at f&f scale, but bounds a real backlog.)
  const adhVisible = adherence.slice(0, DASHBOARD_VISIBLE)
  const adminVisible = admin.slice(
    0,
    Math.max(0, DASHBOARD_VISIBLE - adhVisible.length),
  )
  const overflow = total - (adhVisible.length + adminVisible.length)

  return (
    <div className="card" style={{ padding: '22px 26px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 6,
        }}
      >
        <div className="eyebrow" style={{ margin: 0 }}>
          Needs attention
        </div>
        {total > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            style={linkButtonStyle}
          >
            View all →
          </button>
        )}
      </div>

      {total === 0 ? (
        <div
          style={{
            padding: '28px 0',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: '.88rem',
          }}
        >
          Nothing flagged.
        </div>
      ) : (
        <>
          <AttentionGroup label="Adherence" items={adhVisible} />
          <AttentionGroup label="Clinical admin" items={adminVisible} />
          {overflow > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              style={{
                ...linkButtonStyle,
                display: 'block',
                padding: '12px 0 2px',
              }}
            >
              View more ({overflow}) →
            </button>
          )}
        </>
      )}

      {showAll && (
        <ModalShell title={`Needs attention · ${total}`} onClose={() => setShowAll(false)}>
          <AttentionGroup label="Adherence" items={adherence} />
          <AttentionGroup label="Clinical admin" items={admin} />
        </ModalShell>
      )}
    </div>
  )
}

function AttentionGroup({
  label,
  items,
}: {
  label: string
  items: AttentionItem[]
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div
        className="eyebrow"
        style={{ margin: '12px 0 0', fontSize: '.64rem', color: 'var(--color-muted)' }}
      >
        {label}
      </div>
      {items.map((it) => (
        // Key by tone + reason, not tag: a client can have BOTH a reconcile
        // "attendance not set" and a "note owed" row (same tag "Reconcile").
        <AttentionRow key={`${it.clientId}-${it.tone}-${it.reason}`} it={it} />
      ))}
    </div>
  )
}

function AttentionRow({ it }: { it: AttentionItem }) {
  const [showSessions, setShowSessions] = useState(false)
  const variant: AvatarTone = it.avatarTone
  const sessions = it.sessions ?? []
  // >1 unactioned session of this type → one row whose "Open" opens a per-client
  // modal listing them all (operator request); 1 → render inline with a direct
  // Open to that session.
  const multi = sessions.length > 1
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 0',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <span
        className={`avatar ${variant}`}
        style={{ width: 40, height: 40, fontSize: 40 * 0.38 }}
      >
        {it.avatar}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            href={`/clients/${it.clientId}`}
            style={{
              fontWeight: 600,
              color: 'var(--color-charcoal)',
              textDecoration: 'none',
            }}
          >
            {it.firstName} {it.lastName}
          </Link>
          <span className={`tag ${it.tone}`}>{it.tag}</span>
        </div>
        <div
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
          }}
        >
          {it.reason}
        </div>
      </div>
      {it.tone === 'overdue' || it.tone === 'onboarding' ? (
        // Manual exit for the two triggers with no natural DB clear (Overdue,
        // Onboarding). The shared ack snoozes the row ~10 days; the action link
        // sits beside it.
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <OverdueFollowUpButton clientId={it.clientId} />
          <Link href={it.action.href} className="btn outline">
            {it.action.label}
          </Link>
        </div>
      ) : multi ? (
        <button
          type="button"
          className="btn outline"
          onClick={() => setShowSessions(true)}
        >
          {it.action.label}
        </button>
      ) : (
        <Link href={it.action.href} className="btn outline">
          {it.action.label}
        </Link>
      )}

      {showSessions && (
        <ReconcileSessionsModal
          it={it}
          sessions={sessions}
          onClose={() => setShowSessions(false)}
        />
      )}
    </div>
  )
}

/**
 * Per-client reconcile modal (rule 2): lists every unactioned session for one
 * client — attendance and note combined — each labelled with its type and
 * opening that specific booking on the schedule (focused). Mirrors the "view
 * all" modal shell.
 */
function ReconcileSessionsModal({
  it,
  sessions,
  onClose,
}: {
  it: AttentionItem
  sessions: { id: string; when: string; dateIso: string; typeLabel: string }[]
  onClose: () => void
}) {
  return (
    <ModalShell
      title={`${it.firstName} ${it.lastName} · to reconcile`}
      onClose={onClose}
    >
      <div>
        {sessions.map((s, i) => (
          <div
            key={`${s.id}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '12px 0',
              borderBottom:
                i < sessions.length - 1
                  ? '1px solid var(--color-border-subtle)'
                  : 'none',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '.85rem', color: 'var(--color-charcoal)' }}>
                {s.when}
              </div>
              <div
                style={{ fontSize: '.72rem', color: 'var(--color-muted)', marginTop: 1 }}
              >
                {s.typeLabel}
              </div>
            </div>
            <Link
              href={`/schedule?d=${s.dateIso}&focus=${s.id}`}
              className="btn outline"
              onClick={onClose}
            >
              Open
            </Link>
          </div>
        ))}
      </div>
    </ModalShell>
  )
}

/**
 * Modal shell: portal + overlay + scroll-lock + header (title + close). Shared
 * by the "view all" modal and the per-client reconcile modal. Mirrors
 * ConfirmDialog's body-pin scroll-lock.
 */
function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const bodyEl = document.body
    const scrollY = window.scrollY
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    const prev = {
      position: bodyEl.style.position,
      top: bodyEl.style.top,
      width: bodyEl.style.width,
      paddingRight: bodyEl.style.paddingRight,
    }
    bodyEl.style.position = 'fixed'
    bodyEl.style.top = `-${scrollY}px`
    bodyEl.style.width = '100%'
    if (scrollbar > 0) bodyEl.style.paddingRight = `${scrollbar}px`
    return () => {
      document.removeEventListener('keydown', onKey)
      bodyEl.style.position = prev.position
      bodyEl.style.top = prev.top
      bodyEl.style.width = prev.width
      bodyEl.style.paddingRight = prev.paddingRight
      window.scrollTo(0, scrollY)
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'start center',
        zIndex: 300,
        padding: 24,
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '22px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 4,
          }}
        >
          <div className="eyebrow" style={{ margin: 0 }}>
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-muted)',
              cursor: 'pointer',
              padding: 4,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: '.78rem',
  color: 'var(--color-primary)',
  fontWeight: 500,
  cursor: 'pointer',
}

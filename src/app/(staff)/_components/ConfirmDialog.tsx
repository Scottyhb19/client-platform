'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

/**
 * CN-13 — small on-system confirm dialog for clinical flows, replacing
 * browser-native confirm()/alert(). Shape and restraint mirror the
 * ArchiveConfirm precedent in ClientProfile.tsx: dark scrim, 440px card,
 * display-font heading, factual body copy, persistent error block, and a
 * Cancel + tonal confirm pair. No motion beyond the standard transitions —
 * dialogs appear still, per the design system.
 *
 * `tone` picks the confirm button: 'alert' for destructive verbs
 * (archive), 'primary' for content-replacing but recoverable verbs
 * (replace draft with copied note).
 *
 * When `error` is set the dialog stays open and shows it — the caller
 * decides whether to retry or cancel. `busy` dims and locks both buttons.
 *
 * Rendered through a PORTAL to <body> and locks the document scroll while
 * open. The portal is load-bearing: several callers (the session builder,
 * the library circuit/day editors) render this inside a dnd-kit sortable
 * card whose `transform` makes a `position: fixed` descendant resolve
 * against the CARD, not the viewport — so without the portal the scrim is
 * confined to that card, the page keeps scrolling, and sibling cards bleed
 * through. Portaling to <body> + the scroll-lock restores a true,
 * movement-free full-screen modal.
 */

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'alert',
  busy = false,
  error = null,
  zIndex = 300,
  onCancel,
  onConfirm,
}: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  tone?: 'alert' | 'primary'
  busy?: boolean
  error?: string | null
  // Scrim stacking level. Defaults above the calendar/toolbar modal layer
  // (200). Raise it when opening over a higher surface — e.g. the schedule's
  // appointment popover sits at 1000, so it passes zIndex={1100}.
  zIndex?: number
  onCancel: () => void
  onConfirm: () => void
}) {
  // Lock the page scroll with ZERO visual movement. We do NOT set
  // overflow:hidden on <html> — it is height:100% in this app, so clipping it
  // snaps the page to the top and drags sticky panels (the session-builder
  // library rail) upward. Instead we pin <body> at its current scroll offset
  // (position:fixed + top:-scrollY) and compensate for the removed scrollbar
  // so nothing shifts; on close we restore and scroll back.
  useEffect(() => {
    const bodyEl = document.body
    const scrollY = window.scrollY
    const scrollbar = window.innerWidth - document.documentElement.clientWidth
    const prev = {
      position: bodyEl.style.position,
      top: bodyEl.style.top,
      left: bodyEl.style.left,
      right: bodyEl.style.right,
      width: bodyEl.style.width,
      paddingRight: bodyEl.style.paddingRight,
    }
    bodyEl.style.position = 'fixed'
    bodyEl.style.top = `-${scrollY}px`
    bodyEl.style.left = '0'
    bodyEl.style.right = '0'
    bodyEl.style.width = '100%'
    if (scrollbar > 0) bodyEl.style.paddingRight = `${scrollbar}px`
    return () => {
      bodyEl.style.position = prev.position
      bodyEl.style.top = prev.top
      bodyEl.style.left = prev.left
      bodyEl.style.right = prev.right
      bodyEl.style.width = prev.width
      bodyEl.style.paddingRight = prev.paddingRight
      window.scrollTo(0, scrollY)
    }
  }, [])

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-heading"
      onClick={() => {
        if (!busy) onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'center',
        // Above the calendar/toolbar modal layer (200) and every in-card
        // stacking context; callers raise it for higher surfaces.
        zIndex,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="confirm-dialog-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 8px',
            color: 'var(--color-charcoal)',
          }}
        >
          {title}
        </h2>
        <div
          style={{
            fontSize: '.9rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.55,
            margin: '0 0 18px',
          }}
        >
          {body}
        </div>
        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              background: 'rgba(214,64,69,.08)',
              border: '1px solid rgba(214,64,69,.25)',
              borderRadius: 8,
              color: 'var(--color-alert)',
              fontSize: '.84rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            className="btn outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          {tone === 'primary' ? (
            <button
              type="button"
              className="btn primary"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: '.84rem',
                padding: '8px 16px',
                borderRadius: 7,
                border: '1px solid var(--color-alert)',
                background: 'var(--color-alert)',
                color: '#fff',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )

  // Guard SSR (these dialogs only ever open from a client interaction, so
  // document exists in practice; the check keeps it safe regardless).
  if (typeof document === 'undefined') return null
  return createPortal(dialog, document.body)
}

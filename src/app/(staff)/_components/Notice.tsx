'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, X } from 'lucide-react'

/**
 * Small on-system notice ("toast") — the on-brand replacement for
 * browser-native alert() at sites with NO natural inline error slot: the
 * session-builder set grid, the library set-steppers and column-unit
 * dropdowns (editor-kit), the schedule drag-to-reschedule. Those are tiny
 * async controls with nowhere to host an inline error line without threading
 * state up through a deep callback tree (and the session builder is the
 * differentiator — we don't rewire it just to surface a rare failure).
 *
 * Where an inline slot DOES exist (settings rows, form flows) we use that, and
 * where a confirm precedes the action we surface the failure inside
 * ConfirmDialog. This component is only for the leftover no-slot cases.
 *
 * Design posture (Odyssey_Design_System.pdf): bottom-anchored, still, card
 * surface with a thin border, a single soft elevation to lift it off content,
 * and a gentle fade within the system's 300ms reveal allowance — no slide, no
 * bounce, no backdrop-filter. Error tone carries a faint alert tint (NOT the
 * restricted 3px left-border flag pattern). Errors dwell longer than
 * successes; either can be dismissed by hand.
 *
 * Implemented as a module-scoped external store read via useSyncExternalStore,
 * with one <NoticeHost/> mounted in the staff layout. A toast must be callable
 * from anywhere on the client — including shared kit components and handlers
 * inside startTransition — without a context provider or a callback threaded
 * through every parent. This is the same shape lightweight toast libraries
 * use, with zero new dependencies and full design-token control.
 */

export type NoticeTone = 'error' | 'success'

interface NoticeItem {
  id: number
  message: string
  tone: NoticeTone
  durationMs: number
}

// ── Module-scoped external store ─────────────────────────────────────────
// Read via useSyncExternalStore — the idiomatic way to surface module state in
// React without setState-in-effect. `items` is reassigned (never mutated) on
// every change, so its reference doubles as the snapshot.
let items: NoticeItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
// Stable empty reference for the server snapshot — a fresh [] each call would
// make useSyncExternalStore loop.
const EMPTY: NoticeItem[] = []

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function getSnapshot() {
  return items
}

function getServerSnapshot() {
  return EMPTY
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id)
  emit()
}

/**
 * Show an on-system notice. The on-brand replacement for alert() at no-slot
 * sites. Defaults to the error tone (these almost always carry a failed
 * server-action message); pass `tone: 'success'` for confirmations.
 */
export function notify(
  message: string,
  opts?: { tone?: NoticeTone; durationMs?: number },
): void {
  const tone = opts?.tone ?? 'error'
  const durationMs = opts?.durationMs ?? (tone === 'error' ? 6000 : 4000)
  items = [...items, { id: nextId++, message, tone, durationMs }]
  emit()
}

// ── Host (mounted once in the staff layout) ──────────────────────────────
export function NoticeHost() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Hydration gate. Notices only ever appear after a user interaction, so the
  // list is ALWAYS empty during SSR and the first client (hydration) render —
  // both return null here, so the server and client trees are identical and
  // there is no mismatch. The portal mounts only once the first notice is
  // pushed, well after hydration. Do NOT swap this for a bare `typeof document`
  // branch: that renders null on the server but the portal on the client,
  // which is the classic hydration mismatch (and was the bug here).
  if (list.length === 0) return null
  // Defensive only: createPortal needs document.body. Unreachable on the server
  // (the list is empty there → handled above), so it never diverges from the
  // client; it just guards against a future server-side notify() footgun.
  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 24,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        // Top-most: above ConfirmDialog (300) AND the schedule's appointment
        // popover (1000), so a failure raised from any surface is still legible.
        zIndex: 2000,
        padding: '0 16px',
        // The wrapper must not eat clicks on the page beneath it; each card
        // re-enables pointer events for itself.
        pointerEvents: 'none',
      }}
    >
      {list.map((item) => (
        <NoticeCard key={item.id} item={item} />
      ))}
    </div>,
    document.body,
  )
}

function NoticeCard({ item }: { item: NoticeItem }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Fade in on the next frame, then auto-dismiss. setVisible runs inside the
    // rAF callback (not synchronously in the effect body), so it's not a
    // cascading-render hazard. Keyed by id in the map, so this runs once.
    const raf = requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => dismiss(item.id), item.durationMs)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [item.id, item.durationMs])

  const isError = item.tone === 'error'

  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        maxWidth: 460,
        padding: '12px 14px',
        background: isError ? 'rgba(214,64,69,.06)' : 'var(--color-card)',
        border: `1px solid ${
          isError ? 'rgba(214,64,69,.22)' : 'var(--color-border-subtle)'
        }`,
        borderRadius: 10,
        boxShadow: '0 6px 24px rgba(0,0,0,.12)',
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {isError ? (
        <AlertCircle
          size={16}
          aria-hidden
          style={{ color: 'var(--color-alert)', flexShrink: 0, marginTop: 1 }}
        />
      ) : (
        <Check
          size={16}
          aria-hidden
          style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 1 }}
        />
      )}
      <span
        style={{
          fontSize: '.86rem',
          lineHeight: 1.45,
          color: 'var(--color-charcoal)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {item.message}
      </span>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 2,
          cursor: 'pointer',
          color: 'var(--color-muted)',
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}

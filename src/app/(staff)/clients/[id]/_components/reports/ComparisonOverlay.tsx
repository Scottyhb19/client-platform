'use client'

/**
 * ComparisonOverlay — full-viewport "Compare sessions" surface.
 *
 * Per docs/decisions.md D-005 (Q4/Q9 sign-off):
 * - Full-viewport overlay (not a modal, not a side panel)
 * - All sessions pre-selected by default — the EP sees the full
 *   longitudinal picture immediately
 * - Deselecting narrows the table; %-change column always present
 *
 * Dismiss paths:
 * - Close button in header
 * - Escape key
 *
 * Body scroll is locked while the overlay is open so background
 * scrolling doesn't leak through the table's own scroll containers.
 */

import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ClientTestHistory } from '@/lib/testing/loader-types'
import { ComparisonSessionPicker } from './ComparisonSessionPicker'
import { ComparisonTable } from './ComparisonTable'
import { buildComparisonRows } from './helpers'

interface ComparisonOverlayProps {
  history: ClientTestHistory
  clientName: string
  onClose: () => void
}

export function ComparisonOverlay({
  history,
  clientName,
  onClose,
}: ComparisonOverlayProps) {
  const allIds = useMemo(
    () => new Set(history.sessions.map((s) => s.session_id)),
    [history.sessions],
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(allIds)

  // Reset selection if the underlying session list changes (e.g. the
  // user captures a new session while the overlay is open — unlikely
  // but cheap to guard).
  useEffect(() => {
    setSelectedIds(new Set(history.sessions.map((s) => s.session_id)))
  }, [history.sessions])

  // Escape dismisses; lock body scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const view = useMemo(
    () => buildComparisonRows(history, selectedIds),
    [history, selectedIds],
  )

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Compare sessions for ${clientName}`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-surface)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '14px 24px',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-card)',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.15rem',
              color: 'var(--color-charcoal)',
              letterSpacing: '-0.01em',
            }}
          >
            Compare sessions
          </div>
          <div
            style={{
              fontSize: '.78rem',
              color: 'var(--color-text-light)',
              marginTop: 2,
            }}
          >
            {clientName} ·{' '}
            {history.sessions.length} session
            {history.sessions.length === 1 ? '' : 's'} captured
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close comparison"
          className="btn ghost"
          style={{
            padding: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <X size={16} aria-hidden /> Close
        </button>
      </header>

      <main
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 24px 60px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          maxWidth: 1400,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <ComparisonSessionPicker
          sessions={history.sessions}
          selectedIds={selectedIds}
          onToggle={toggle}
          onSelectAll={() => setSelectedIds(new Set(allIds))}
          onClear={() => setSelectedIds(new Set())}
        />
        <ComparisonTable view={view} />
      </main>
    </div>
  )
}

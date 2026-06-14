'use client'

import { useState } from 'react'
import {
  NotesPanel,
  type ClinicalNoteSummary,
} from '../../_components/NotesPanel'
import {
  ReportsPanel,
  type SessionReport,
} from '../../_components/ReportsPanel'
import type { ClientTestHistory } from '@/lib/testing/loader-types'

/**
 * Side panel on the program calendar page (Phase E).
 *
 * Wraps the same NotesPanel + ReportsPanel components the session builder
 * uses, behind a two-tab strip that mirrors the session-builder styling.
 * No Files tab in v1 (Q2b=C, deferred until a real Files use case lands).
 *
 * Tab selection is local client state — only the panel "open vs closed"
 * is URL-tracked (so a refresh keeps the panel open). The internal Notes
 * vs Reports choice resets to Notes on each open, which matches the
 * "default to clinical context" intent of the panel.
 */

interface CalendarSidePanelProps {
  notes: ClinicalNoteSummary[]
  reports: SessionReport[]
  history: ClientTestHistory
}

export function CalendarSidePanel({
  notes,
  reports,
  history,
}: CalendarSidePanelProps) {
  const [tab, setTab] = useState<'notes' | 'reports'>('notes')

  return (
    <aside style={{ position: 'sticky', top: 20 }}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          // P2-2: was the inline CREAM_DEEP literal — same value, now the token.
          background: 'var(--color-surface-2)',
          padding: 3,
          borderRadius: 'var(--radius-button)',
          marginBottom: 14,
        }}
      >
        {(['notes', 'reports'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            style={{
              flex: 1,
              padding: '7px 10px',
              border: 'none',
              borderRadius: 5,
              fontSize: '.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              // P2-2: INK/MUTED/#fff literals → tokens. The active-tab card
              // shadow is the one sanctioned card shadow (design system), left
              // as the canonical literal — there is no shadow token.
              background: tab === k ? 'var(--color-card)' : 'transparent',
              color: tab === k ? 'var(--color-primary)' : 'var(--color-muted)',
              boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              textTransform: 'capitalize',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === 'notes' && <NotesPanel notes={notes} />}
      {tab === 'reports' && (
        <ReportsPanel reports={reports} history={history} />
      )}
    </aside>
  )
}

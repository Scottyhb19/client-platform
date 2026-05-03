'use client'

import { useState } from 'react'
import {
  NotesPanel,
  type PinnedNote,
} from '../../_components/NotesPanel'
import {
  ReportsPanel,
  type SessionReport,
} from '../../_components/ReportsPanel'

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

const INK = '#1E1A18'
const MUTED = '#78746F'
const CREAM_DEEP = '#EDE8E2'

interface CalendarSidePanelProps {
  notes: PinnedNote[]
  reports: SessionReport[]
}

export function CalendarSidePanel({ notes, reports }: CalendarSidePanelProps) {
  const [tab, setTab] = useState<'notes' | 'reports'>('notes')

  return (
    <aside style={{ position: 'sticky', top: 20 }}>
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: CREAM_DEEP,
          padding: 3,
          borderRadius: 7,
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
              background: tab === k ? '#fff' : 'transparent',
              color: tab === k ? INK : MUTED,
              boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              textTransform: 'capitalize',
            }}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === 'notes' && <NotesPanel notes={notes} />}
      {tab === 'reports' && <ReportsPanel reports={reports} />}
    </aside>
  )
}

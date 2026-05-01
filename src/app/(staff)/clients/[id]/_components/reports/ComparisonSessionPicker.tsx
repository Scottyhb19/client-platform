'use client'

/**
 * ComparisonSessionPicker — checkbox list of sessions inside the
 * comparison overlay. Per docs/decisions.md D-005 (Q4/Q9 sign-off):
 * defaults to all sessions checked; deselecting narrows the table.
 *
 * Compact: each row shows the session date, an optional battery name,
 * and the result count. Notes are intentionally omitted to keep the
 * picker short — the EP can refer back to the Reports tab cards or
 * the clinical-notes tab for context.
 */

import type { SessionInfo } from '@/lib/testing/loader-types'
import { formatShortDate } from './helpers'

interface ComparisonSessionPickerProps {
  sessions: SessionInfo[]
  selectedIds: Set<string>
  onToggle: (sessionId: string) => void
  onSelectAll: () => void
  onClear: () => void
}

export function ComparisonSessionPicker({
  sessions,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
}: ComparisonSessionPickerProps) {
  const allChecked = selectedIds.size === sessions.length
  const noneChecked = selectedIds.size === 0

  return (
    <section
      className="card"
      style={{
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
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
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.78rem',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--color-muted)',
            }}
          >
            Sessions
          </div>
          <div
            style={{
              fontSize: '.82rem',
              color: 'var(--color-text)',
              marginTop: 2,
            }}
          >
            <strong style={{ fontWeight: 600 }}>{selectedIds.size}</strong> of{' '}
            {sessions.length} selected
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn ghost"
            onClick={onSelectAll}
            disabled={allChecked}
            style={{ fontSize: '.76rem', padding: '4px 10px' }}
          >
            Select all
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onClear}
            disabled={noneChecked}
            style={{ fontSize: '.76rem', padding: '4px 10px' }}
          >
            Clear
          </button>
        </div>
      </header>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          maxHeight: 220,
          overflowY: 'auto',
        }}
      >
        {sessions.map((s) => {
          const checked = selectedIds.has(s.session_id)
          return (
            <li key={s.session_id}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 8px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: '.84rem',
                  background: checked ? 'rgba(30,26,24,0.03)' : 'transparent',
                  transition: 'background 150ms cubic-bezier(0.4,0,0.2,1)',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(s.session_id)}
                  style={{
                    accentColor: 'var(--color-primary)',
                    width: 14,
                    height: 14,
                    cursor: 'pointer',
                  }}
                />
                <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                  {formatShortDate(s.conducted_at)}
                </span>
                {s.battery_name && (
                  <>
                    <span style={{ color: 'var(--color-muted)' }}>·</span>
                    <span style={{ color: 'var(--color-text-light)' }}>
                      {s.battery_name}
                    </span>
                  </>
                )}
                <span style={{ color: 'var(--color-muted)' }}>·</span>
                <span style={{ color: 'var(--color-text-light)' }}>
                  {s.result_count} result{s.result_count === 1 ? '' : 's'}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

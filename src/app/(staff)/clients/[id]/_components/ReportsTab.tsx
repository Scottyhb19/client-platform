'use client'

/**
 * ReportsTab — staff-side view of structured test sessions for one client.
 *
 * Replaces the placeholder ReportsTab() that was inline in ClientProfile.tsx.
 * Renders a list of captured sessions with a "+ Record test" button that
 * opens TestCaptureModal. Charts and per-test cards arrive in Phase D —
 * for now this is a list + capture entry only.
 *
 * The legacy `reports` table (rendered HTML reports) is unchanged and
 * lives elsewhere. This tab is the new structured-data surface.
 */

import { Plus } from 'lucide-react'
import { useState } from 'react'
import { TestCaptureModal } from './TestCaptureModal'
import type {
  BatteryRow,
  CapturedSessionRow,
  CatalogCategory,
  LastUsedBatteryHint,
} from '@/lib/testing'

interface ReportsTabProps {
  clientId: string
  catalog: CatalogCategory[]
  batteries: BatteryRow[]
  lastUsedBattery: LastUsedBatteryHint | null
  capturedSessions: CapturedSessionRow[]
}

export function ReportsTab({
  clientId,
  catalog,
  batteries,
  lastUsedBattery,
  capturedSessions,
}: ReportsTabProps) {
  // Defensive: during HMR transitions or if a loader returns nothing,
  // these can briefly arrive undefined. The page-level loaders normally
  // guarantee arrays.
  const sessions = capturedSessions ?? []
  const cat = catalog ?? []
  const bs = batteries ?? []
  const [open, setOpen] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Test sessions</div>
          <button
            type="button"
            className="btn outline"
            onClick={() => setOpen(true)}
            style={{ fontSize: '.78rem', padding: '6px 12px' }}
          >
            <Plus size={13} aria-hidden /> Record test
          </button>
        </div>
        {sessions.length === 0 ? (
          <div
            style={{
              padding: '32px 24px',
              textAlign: 'center',
              color: 'var(--color-text-light)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1rem',
                color: 'var(--color-charcoal)',
                marginBottom: 4,
              }}
            >
              No test sessions yet
            </div>
            <p
              style={{
                fontSize: '.84rem',
                lineHeight: 1.6,
                margin: '0 auto',
                maxWidth: 440,
              }}
            >
              Capture force plate, dynamometry, range of motion, and
              patient-reported outcomes here. Charts will populate as
              sessions accumulate.
            </p>
          </div>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            {sessions.map((s) => (
              <li
                key={s.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto',
                  gap: 14,
                  alignItems: 'center',
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--color-border-subtle)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: '.86rem',
                      color: 'var(--color-text)',
                    }}
                  >
                    {formatLongDate(s.conducted_at)}
                  </div>
                  <div
                    style={{
                      fontSize: '.76rem',
                      color: 'var(--color-text-light)',
                      marginTop: 2,
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      {s.result_count} metric{s.result_count === 1 ? '' : 's'}
                    </span>
                    {s.battery_name && (
                      <>
                        <span style={{ color: 'var(--color-muted)' }}>·</span>
                        <span>{s.battery_name}</span>
                      </>
                    )}
                    {s.source !== 'manual' && (
                      <span className="tag muted" style={{ fontSize: '.66rem' }}>
                        {s.source}
                      </span>
                    )}
                  </div>
                  {s.notes && (
                    <div
                      style={{
                        fontSize: '.78rem',
                        color: 'var(--color-text-light)',
                        marginTop: 4,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {s.notes}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <TestCaptureModal
        open={open}
        onClose={() => setOpen(false)}
        clientId={clientId}
        catalog={cat}
        batteries={bs}
        lastUsedBattery={lastUsedBattery}
      />
    </div>
  )
}

function formatLongDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

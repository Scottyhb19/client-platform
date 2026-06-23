'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Copy, Layers, Plus, Save } from 'lucide-react'
import { duplicateProgramDayAction } from '../../../day-actions'
import { SingleDatePicker } from '../../../_components/SingleDatePicker'
import { CircuitAddModal, type CircuitOption } from './CircuitControls'
import {
  SaveDayAsSessionModal,
  SessionAddModal,
  type SessionOption,
} from './SessionControls'

/**
 * #4 — the "Session Tools" dropdown on the session-builder header, replacing the
 * standalone Duplicate button. Day-level insert/tools actions live here:
 *   - Duplicate day   — the old DuplicateButton logic, folded in.
 *   - Add circuit…    — CircuitAddModal, moved out of the right-panel Library tab.
 *   - Add session     — placeholder until the Sessions workbench ships.
 */
export function SessionToolsMenu({
  clientId,
  dayId,
  sourceDate,
  duplicateDisabled,
  circuits,
  sessions,
}: {
  clientId: string
  dayId: string
  sourceDate: string | null
  duplicateDisabled: boolean
  circuits: CircuitOption[]
  sessions: SessionOption[]
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [circuitOpen, setCircuitOpen] = useState(false)
  const [addSessionOpen, setAddSessionOpen] = useState(false)
  const [saveSessionOpen, setSaveSessionOpen] = useState(false)
  const [dupError, setDupError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDuplicate(targetDate: string) {
    setDupError(null)
    startTransition(async () => {
      const result = await duplicateProgramDayAction(clientId, dayId, targetDate)
      if ('error' in result) {
        setDupError(result.error)
        return
      }
      if (result.status === 'conflict') {
        setDupError('A session is already scheduled for that date. Pick a different one.')
        return
      }
      if (result.status === 'no_program') {
        setDupError(
          'No active training block covers that date. Create or extend a block first.',
        )
        return
      }
      router.push(`/clients/${clientId}/program/days/${result.newDayId}`)
    })
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="btn outline" onClick={() => setMenuOpen((o) => !o)}>
        Session Tools
        <ChevronDown size={14} aria-hidden />
      </button>

      {menuOpen && (
        <>
          {/* Click-away backdrop. */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 30 }}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 6,
              zIndex: 31,
              minWidth: 210,
              background: 'var(--color-card)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-card-dense)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              padding: 4,
            }}
          >
            <ToolMenuItem
              icon={<Copy size={15} aria-hidden />}
              disabled={duplicateDisabled}
              onClick={() => {
                setMenuOpen(false)
                setDupError(null)
                setDupOpen(true)
              }}
            >
              Duplicate day
            </ToolMenuItem>
            <ToolMenuItem
              icon={<Plus size={15} aria-hidden />}
              onClick={() => {
                setMenuOpen(false)
                setCircuitOpen(true)
              }}
            >
              Add circuit…
            </ToolMenuItem>
            <ToolMenuItem
              icon={<Layers size={15} aria-hidden />}
              onClick={() => {
                setMenuOpen(false)
                setAddSessionOpen(true)
              }}
            >
              Add session…
            </ToolMenuItem>
            <ToolMenuItem
              icon={<Save size={15} aria-hidden />}
              onClick={() => {
                setMenuOpen(false)
                setSaveSessionOpen(true)
              }}
            >
              Save day as session…
            </ToolMenuItem>
          </div>
        </>
      )}

      {dupOpen && (
        <SingleDatePicker
          anchorDate={sourceDate ?? undefined}
          title="Duplicate this session"
          description={
            dupError
              ? dupError
              : 'The chosen date inherits this session’s exercises as a draft.'
          }
          confirmLabel="Duplicate"
          busy={pending}
          onCancel={() => {
            if (!pending) {
              setDupOpen(false)
              setDupError(null)
            }
          }}
          onConfirm={handleDuplicate}
        />
      )}

      {circuitOpen && (
        <CircuitAddModal
          circuits={circuits}
          clientId={clientId}
          dayId={dayId}
          onClose={() => setCircuitOpen(false)}
        />
      )}

      {addSessionOpen && (
        <SessionAddModal
          sessions={sessions}
          clientId={clientId}
          dayId={dayId}
          onClose={() => setAddSessionOpen(false)}
        />
      )}

      {saveSessionOpen && (
        <SaveDayAsSessionModal dayId={dayId} onClose={() => setSaveSessionOpen(false)} />
      )}
    </div>
  )
}

function ToolMenuItem({
  children,
  icon,
  onClick,
  disabled,
  hint,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '9px 11px',
        border: 'none',
        background: 'none',
        borderRadius: 'var(--radius-input)',
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: '.86rem',
        fontWeight: 500,
        color: disabled ? 'var(--color-muted)' : 'var(--color-text)',
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <span style={{ color: 'var(--color-text-light)', display: 'grid', placeItems: 'center' }}>
        {icon}
      </span>
      <span style={{ flex: 1 }}>{children}</span>
      {hint && (
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '.6rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
          }}
        >
          {hint}
        </span>
      )}
    </button>
  )
}

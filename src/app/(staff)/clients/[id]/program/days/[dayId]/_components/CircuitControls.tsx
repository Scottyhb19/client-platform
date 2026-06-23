'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { CIRCUIT_TYPE_LABELS, type CircuitType } from '@/app/(staff)/library/types'
import { addCircuitToDayAction, saveGroupAsCircuitAction } from '../actions'

/** A circuit option for the session-builder pickers (C-5/C-6). */
export type CircuitOption = {
  id: string
  name: string
  circuit_type: CircuitType
}

const CIRCUIT_TYPES: CircuitType[] = ['superset', 'triset', 'circuit', 'finisher', 'warmup']

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-display)',
  fontSize: '.66rem',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: 5,
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 11px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: '.88rem',
  color: 'var(--color-text)',
  outline: 'none',
}
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  background: 'rgba(0,0,0,0.4)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
}

/**
 * C-6 (relocated to the Session Tools menu, #4) — modal listing the org's
 * circuits; picking one appends it to the day as a fresh superset group
 * (insert_circuit_into_day, copy-on-apply). Opened from SessionToolsMenu.
 */
export function CircuitAddModal({
  circuits,
  clientId,
  dayId,
  onClose,
}: {
  circuits: CircuitOption[]
  clientId: string
  dayId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleAdd(circuitId: string) {
    setError(null)
    startTransition(async () => {
      const res = await addCircuitToDayAction(clientId, dayId, circuitId)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div onClick={() => !pending && onClose()} style={overlayStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add a circuit"
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-card)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          padding: 20,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-charcoal)',
            marginBottom: 4,
          }}
        >
          Add a circuit
        </div>
        <p
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            margin: '0 0 14px',
            lineHeight: 1.5,
          }}
        >
          Drops the circuit&rsquo;s exercises into this day as one group. Editing the
          circuit later won&rsquo;t change what you add here.
        </p>

        {circuits.length === 0 ? (
          <div
            style={{
              fontSize: '.84rem',
              color: 'var(--color-muted)',
              lineHeight: 1.55,
              padding: '8px 0',
            }}
          >
            No circuits yet. Group a few exercises in a session and choose{' '}
            <strong style={{ color: 'var(--color-text)' }}>Save as circuit</strong>.
          </div>
        ) : (
          <div
            style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}
          >
            {circuits.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={pending}
                onClick={() => handleAdd(c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 11px',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-input)',
                  background: 'var(--color-surface)',
                  cursor: pending ? 'default' : 'pointer',
                  opacity: pending ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 600,
                    fontSize: '.86rem',
                    color: 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '.62rem',
                    letterSpacing: '.05em',
                    textTransform: 'uppercase',
                    color: 'var(--color-muted)',
                    flexShrink: 0,
                  }}
                >
                  {CIRCUIT_TYPE_LABELS[c.circuit_type]}
                </span>
                <Plus
                  size={14}
                  aria-hidden
                  style={{ color: 'var(--color-text-light)', flexShrink: 0 }}
                />
              </button>
            ))}
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--color-alert)' }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn outline" onClick={onClose} disabled={pending}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * C-5 — "Save as circuit" group action, rendered in the SupersetBlock footer.
 * Opens an in-app modal (name + type, type pre-set from member count) and saves
 * the group's exercises (+ per-set rows) as a reusable circuit. In-app dialog,
 * no backdrop blur per the design system.
 */
export function SaveAsCircuitButton({ memberIds }: { memberIds: string[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CircuitType>(
    memberIds.length === 2 ? 'superset' : memberIds.length === 3 ? 'triset' : 'circuit',
  )
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the circuit a name.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await saveGroupAsCircuitAction(trimmed, type, memberIds)
      if ('error' in res) {
        setError(res.error)
        return
      }
      if (res.status === 'duplicate_name') {
        setError(`A circuit called "${trimmed}" already exists.`)
        return
      }
      setOpen(false)
      setName('')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        style={{
          border: 'none',
          background: 'none',
          padding: '4px 2px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: '.74rem',
          letterSpacing: '.02em',
          color: 'var(--color-text-light)',
        }}
      >
        Save as circuit
      </button>

      {open && (
        <div onClick={() => !pending && setOpen(false)} style={overlayStyle}>
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Save as circuit"
            style={{
              width: '100%',
              maxWidth: 380,
              background: 'var(--color-card)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-card)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              padding: 20,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.1rem',
                color: 'var(--color-charcoal)',
                marginBottom: 4,
              }}
            >
              Save as circuit
            </div>
            <p
              style={{
                fontSize: '.82rem',
                color: 'var(--color-text-light)',
                margin: '0 0 14px',
                lineHeight: 1.5,
              }}
            >
              Saves these {memberIds.length} exercises as a reusable circuit you can drop
              into any session.
            </p>

            <label style={labelStyle}>Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="e.g. Adductor finisher"
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 12 }}>Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CircuitType)}
              style={inputStyle}
            >
              {CIRCUIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CIRCUIT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>

            {error && (
              <div
                role="alert"
                style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--color-alert)' }}
              >
                {error}
              </div>
            )}

            <div
              style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}
            >
              <button
                type="button"
                className="btn outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleSave}
                disabled={pending}
              >
                {pending ? 'Saving…' : 'Save circuit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

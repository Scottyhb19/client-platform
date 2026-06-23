'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import {
  applySessionToDayAction,
  saveDayAsSessionAction,
} from '@/app/(staff)/library/session-actions'

/** A session option for the builder's "Add session" picker (S-6). */
export type SessionOption = {
  id: string
  name: string
  exerciseCount: number
}

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
 * S-6 — modal listing the org's session templates; picking one appends its
 * exercises to this day (apply_session_to_program_day, copy-on-apply, every
 * superset group remapped fresh). Opened from SessionToolsMenu. Mirrors
 * CircuitAddModal.
 */
export function SessionAddModal({
  sessions,
  clientId,
  dayId,
  onClose,
}: {
  sessions: SessionOption[]
  clientId: string
  dayId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleAdd(sessionId: string) {
    setError(null)
    startTransition(async () => {
      const res = await applySessionToDayAction(sessionId, dayId, clientId)
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
        aria-label="Add a session"
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
          Add a session
        </div>
        <p
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            margin: '0 0 14px',
            lineHeight: 1.5,
          }}
        >
          Appends the session&rsquo;s exercises to this day. Editing the session
          later won&rsquo;t change what you add here.
        </p>

        {sessions.length === 0 ? (
          <div
            style={{
              fontSize: '.84rem',
              color: 'var(--color-muted)',
              lineHeight: 1.55,
              padding: '8px 0',
            }}
          >
            No sessions yet. Build one in the Library&rsquo;s{' '}
            <strong style={{ color: 'var(--color-text)' }}>Sessions</strong> tab,
            or save a day with <strong style={{ color: 'var(--color-text)' }}>Save day as session</strong>.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={pending}
                onClick={() => handleAdd(s.id)}
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
                  {s.name}
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
                  {s.exerciseCount} {s.exerciseCount === 1 ? 'ex' : 'exs'}
                </span>
                <Plus size={14} aria-hidden style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}

        {error && (
          <div role="alert" style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--color-alert)' }}>
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
 * S-6 — "Save day as session" modal (name input). Copies the whole day into a
 * new session template (save_day_as_session). Opened from SessionToolsMenu;
 * closing on success matches the "Save as circuit" pattern. Mirrors the
 * SaveAsCircuitButton modal, minus the type select (a session has no type).
 */
export function SaveDayAsSessionModal({
  dayId,
  onClose,
}: {
  dayId: string
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the session a name.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await saveDayAsSessionAction(dayId, trimmed)
      if ('error' in res) {
        setError(res.error)
        return
      }
      if (res.status === 'duplicate_name') {
        setError(`A session called "${trimmed}" already exists.`)
        return
      }
      onClose()
    })
  }

  return (
    <div onClick={() => !pending && onClose()} style={overlayStyle}>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Save day as session"
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
          Save day as session
        </div>
        <p
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            margin: '0 0 14px',
            lineHeight: 1.5,
          }}
        >
          Saves this day&rsquo;s exercises, groups, and sections as a reusable session
          you can drop onto any client&rsquo;s program.
        </p>

        <label style={labelStyle}>Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="e.g. Day A — Lower body"
          style={inputStyle}
        />

        {error && (
          <div role="alert" style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--color-alert)' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button type="button" className="btn outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={handleSave} disabled={pending}>
            {pending ? 'Saving…' : 'Save session'}
          </button>
        </div>
      </div>
    </div>
  )
}

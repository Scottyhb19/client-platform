'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MoreVertical, Plus, X } from 'lucide-react'
import { CIRCUIT_TYPE_LABELS, type CircuitSummary, type CircuitType } from '../types'
import {
  createCircuitAction,
  deleteCircuitAction,
  renameCircuitAction,
} from '../circuit-actions'

/**
 * C-4 / #3 — the Circuits tab. Lists the org's circuits and is the entrance to
 * the workbench: "New circuit" authors one from scratch, and clicking a circuit
 * opens the editor (/library/circuits/[id]) to add/remove exercises + set
 * prescriptions. Inline rename + soft-delete live on each card's menu.
 */
export function CircuitsTab({ circuits }: { circuits: CircuitSummary[] }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <NewCircuitButton />
      </div>

      {circuits.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}
        >
          {circuits.map((c) => (
            <CircuitCard key={c.id} circuit={c} />
          ))}
        </div>
      )}
    </div>
  )
}

const CIRCUIT_TYPES: CircuitType[] = ['superset', 'triset', 'circuit', 'finisher', 'warmup']

function NewCircuitButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<CircuitType>('circuit')
  const [error, setError] = useState<string | null>(null)

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the circuit a name.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await createCircuitAction(trimmed, type)
      if ('error' in res) {
        setError(res.error)
        return
      }
      if ('status' in res) {
        setError(`A circuit called "${trimmed}" already exists.`)
        return
      }
      router.push(`/library/circuits/${res.circuitId}`)
    })
  }

  return (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => {
          setError(null)
          setName('')
          setType('circuit')
          setOpen(true)
        }}
      >
        <Plus size={14} aria-hidden />
        New circuit
      </button>

      {open && (
        <div onClick={() => !pending && setOpen(false)} style={overlayStyle}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New circuit" style={modalStyle}>
            <div style={modalHeading}>New circuit</div>
            <p style={modalSub}>
              Build a reusable group of exercises. You&rsquo;ll add exercises and set
              prescriptions next.
            </p>

            <label style={labelStyle}>Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
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
              <div role="alert" style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--color-alert)' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button type="button" className="btn outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={handleCreate} disabled={pending}>
                {pending ? 'Creating…' : 'Create + edit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CircuitCard({ circuit: c }: { circuit: CircuitSummary }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(c.name)
  const [error, setError] = useState<string | null>(null)

  function handleDelete() {
    setMenuOpen(false)
    if (
      !window.confirm(
        `Delete "${c.name}"?\n\nDeleting hides the circuit from the library; sessions you've already built with it are unaffected.`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await deleteCircuitAction(c.id)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  function handleRename() {
    const trimmed = name.trim()
    if (trimmed === c.name) {
      setRenaming(false)
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await renameCircuitAction(c.id, trimmed)
      if (res.error) {
        setError(res.error)
      } else {
        setRenaming(false)
        router.refresh()
      }
    })
  }

  const summary = `${CIRCUIT_TYPE_LABELS[c.circuit_type]} · ${c.exerciseCount} ${
    c.exerciseCount === 1 ? 'exercise' : 'exercises'
  }`

  return (
    <article className="card" style={{ position: 'relative', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') {
                    setName(c.name)
                    setRenaming(false)
                  }
                }}
                style={inputStyle}
              />
              <IconButton label="Save name" onClick={handleRename} disabled={pending}>
                <Check size={15} aria-hidden />
              </IconButton>
              <IconButton
                label="Cancel rename"
                onClick={() => {
                  setName(c.name)
                  setRenaming(false)
                  setError(null)
                }}
              >
                <X size={15} aria-hidden />
              </IconButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => router.push(`/library/circuits/${c.id}`)}
              style={{
                display: 'block',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.05rem',
                color: 'var(--color-charcoal)',
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
              }}
            >
              {c.name}
            </button>
          )}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 3 }}>
            {summary}
          </div>
        </div>

        {!renaming && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <IconButton label="Circuit actions" onClick={() => setMenuOpen((o) => !o)}>
              <MoreVertical size={16} aria-hidden />
            </IconButton>
            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: 4,
                    zIndex: 11,
                    minWidth: 140,
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-card-dense)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    overflow: 'hidden',
                  }}
                >
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      router.push(`/library/circuits/${c.id}`)
                    }}
                  >
                    Edit
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      setMenuOpen(false)
                      setRenaming(true)
                    }}
                  >
                    Rename
                  </MenuItem>
                  <MenuItem onClick={handleDelete} danger>
                    Delete
                  </MenuItem>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {c.notes && !renaming && (
        <div style={{ fontSize: '.84rem', color: 'var(--color-text-light)', marginTop: 8, lineHeight: 1.5 }}>
          {c.notes}
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 10, fontSize: '.78rem', color: 'var(--color-alert)' }}>
          {error}
        </div>
      )}
    </article>
  )
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
const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  background: 'var(--color-card)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-card)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  padding: 20,
}
const modalHeading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: '1.1rem',
  color: 'var(--color-charcoal)',
  marginBottom: 4,
}
const modalSub: React.CSSProperties = {
  fontSize: '.82rem',
  color: 'var(--color-text-light)',
  margin: '0 0 14px',
  lineHeight: 1.5,
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

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 30,
        height: 30,
        border: 'none',
        background: 'none',
        borderRadius: 'var(--radius-button)',
        color: 'var(--color-text-light)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 14px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: '.84rem',
        fontWeight: 500,
        color: danger ? 'var(--color-alert)' : 'var(--color-text)',
      }}
    >
      {children}
    </button>
  )
}

function EmptyState() {
  return (
    <div className="card" style={{ padding: '44px 28px', textAlign: 'center', color: 'var(--color-text-light)' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.2rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        No circuits yet
      </div>
      <p style={{ fontSize: '.92rem', margin: '0 auto', lineHeight: 1.6, maxWidth: 460 }}>
        Hit <strong style={{ color: 'var(--color-text)' }}>New circuit</strong> to build one
        from scratch, or group exercises in a session and choose{' '}
        <strong style={{ color: 'var(--color-text)' }}>Save as circuit</strong>.
      </p>
    </div>
  )
}

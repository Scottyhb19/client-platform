'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MoreVertical, X } from 'lucide-react'
import { CIRCUIT_TYPE_LABELS, type CircuitSummary } from '../types'
import { deleteCircuitAction, renameCircuitAction } from '../circuit-actions'

/**
 * C-4 — the Circuits tab list. Renders the org's saved circuits (engine:
 * save_group_as_circuit / insert_circuit_into_day, both in the session builder)
 * with a type chip + structure summary, and rename/delete management. Circuits
 * are CREATED and USED in the session builder ("Save as circuit" on a group;
 * "Add circuit" on a day) — there is no apply-from-Library, so no apply UI here.
 */
export function CircuitsTab({ circuits }: { circuits: CircuitSummary[] }) {
  if (circuits.length === 0) return <EmptyState />

  return (
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
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 32,
                  padding: '0 10px',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-input)',
                  background: 'var(--color-surface)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '.9rem',
                  color: 'var(--color-text)',
                  outline: 'none',
                }}
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
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.05rem',
                color: 'var(--color-charcoal)',
                lineHeight: 1.25,
                overflowWrap: 'anywhere',
              }}
            >
              {c.name}
            </div>
          )}
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-muted)',
              marginTop: 3,
            }}
          >
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
                {/* Click-away backdrop. */}
                <div
                  onClick={() => setMenuOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 10 }}
                />
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
        <div
          style={{
            fontSize: '.84rem',
            color: 'var(--color-text-light)',
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          {c.notes}
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
    </article>
  )
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
    <div
      className="card"
      style={{
        padding: '44px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
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
        Group a few exercises in the session builder, then{' '}
        <strong style={{ color: 'var(--color-text)' }}>Save as circuit</strong> from the
        group menu — it&rsquo;ll appear here to drop into any session.
      </p>
    </div>
  )
}

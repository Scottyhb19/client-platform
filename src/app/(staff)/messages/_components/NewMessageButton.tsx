'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Edit3, Search, X } from 'lucide-react'
import { getOrCreateThreadAction } from '../actions'
import type { AvatarTone } from '../../clients/_lib/client-helpers'

export interface MessageClientOption {
  id: string
  firstName: string
  lastName: string
  email: string
  /** Client-category avatar tone, resolved server-side (categoryToneFor). */
  tone: AvatarTone
}

function initials(first: string, last: string): string {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (f && l) return (f[0] + l[0]).toUpperCase()
  if (f) return f.slice(0, 2).toUpperCase()
  return '?'
}

/**
 * Compose entry for the inbox. Replaces the old `New message` → `/clients`
 * link (which detoured through the client list to a profile). This opens a
 * searchable picker in place; selecting a client runs the SAME
 * getOrCreateThreadAction the profile speech-bubble uses and navigates
 * straight to the thread — start-a-conversation without leaving Messages.
 */
export function NewMessageButton({ clients }: { clients: MessageClientOption[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function openPicker() {
    // Reset any prior state before showing the modal (the search auto-focuses
    // on mount) — kept out of an effect to satisfy react-hooks/set-state-in-effect.
    setQuery('')
    setError(null)
    setOpeningId(null)
    setOpen(true)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) =>
      `${c.firstName} ${c.lastName} ${c.email}`.toLowerCase().includes(q),
    )
  }, [clients, query])

  function pick(clientId: string) {
    if (pending) return
    setError(null)
    setOpeningId(clientId)
    startTransition(async () => {
      const res = await getOrCreateThreadAction(clientId)
      if (res.error || !res.data) {
        setError(res.error ?? 'Could not open thread.')
        setOpeningId(null)
        return
      }
      setOpen(false)
      router.push(`/messages?thread=${res.data.threadId}`)
    })
  }

  return (
    <>
      <button type="button" className="btn primary" onClick={openPicker}>
        <Edit3 size={14} aria-hidden /> New message
      </button>

      {open && (
        <div style={overlayStyle} onClick={() => !pending && setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New message"
            style={modalStyle}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !pending) setOpen(false)
            }}
          >
            <div style={headRow}>
              <div style={modalHeading}>New message</div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => !pending && setOpen(false)}
                style={closeBtn}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <p style={modalSub}>Pick a client to start or open their conversation.</p>

            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search
                size={16}
                aria-hidden
                style={{
                  position: 'absolute',
                  left: 12,
                  top: 11,
                  color: 'var(--color-muted)',
                }}
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name or email…"
                aria-label="Search clients"
                style={searchInput}
              />
            </div>

            <div style={listWrap}>
              {clients.length === 0 ? (
                <div style={emptyRow}>No clients yet. Invite one first.</div>
              ) : filtered.length === 0 ? (
                <div style={emptyRow}>No clients match that search.</div>
              ) : (
                filtered.map((c) => {
                  const isOpening = openingId === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pick(c.id)}
                      disabled={pending}
                      style={{
                        ...rowStyle,
                        cursor: pending ? 'default' : 'pointer',
                        opacity: pending && !isOpening ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!pending) e.currentTarget.style.background = '#F5F0EA'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span
                        className={`avatar ${c.tone}`}
                        style={{ width: 34, height: 34, fontSize: 13 }}
                        aria-hidden
                      >
                        {initials(c.firstName, c.lastName)}
                      </span>
                      <span style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                        <span style={rowName}>
                          {c.firstName} {c.lastName}
                        </span>
                        <span style={rowEmail}>{c.email}</span>
                      </span>
                      {isOpening && <span style={openingLabel}>Opening…</span>}
                    </button>
                  )
                })
              )}
            </div>

            {error && (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  background: 'rgba(0,0,0,0.4)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
}
const modalStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 420,
  background: 'var(--color-card)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-card)',
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  padding: 20,
}
const headRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
}
const modalHeading: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: '1.1rem',
  color: 'var(--color-charcoal)',
}
const modalSub: React.CSSProperties = {
  fontSize: '.82rem',
  color: 'var(--color-text-light)',
  margin: '4px 0 14px',
  lineHeight: 1.5,
}
const closeBtn: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-muted)',
  cursor: 'pointer',
  borderRadius: 7,
}
const searchInput: React.CSSProperties = {
  width: '100%',
  height: 38,
  padding: '0 12px 0 36px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: '.86rem',
  color: 'var(--color-text)',
  outline: 'none',
}
const listWrap: React.CSSProperties = {
  maxHeight: 340,
  overflowY: 'auto',
  margin: '0 -6px',
}
const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '9px 6px',
  border: 'none',
  background: 'transparent',
  borderRadius: 8,
  transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1)',
}
const rowName: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-sans)',
  fontWeight: 600,
  fontSize: '.9rem',
  color: 'var(--color-text)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const rowEmail: React.CSSProperties = {
  display: 'block',
  fontSize: '.74rem',
  color: 'var(--color-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const openingLabel: React.CSSProperties = {
  fontSize: '.74rem',
  color: 'var(--color-muted)',
  whiteSpace: 'nowrap',
}
const emptyRow: React.CSSProperties = {
  padding: '18px 8px',
  textAlign: 'center',
  fontSize: '.82rem',
  color: 'var(--color-text-light)',
}
const errorStyle: React.CSSProperties = {
  marginTop: 12,
  fontSize: '.78rem',
  color: 'var(--color-alert)',
}

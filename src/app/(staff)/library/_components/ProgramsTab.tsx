'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MoreVertical, X } from 'lucide-react'
import type { ClientOption, ProgramTemplateSummary } from '../types'
import {
  applyProgramTemplateAction,
  deleteProgramTemplateAction,
  renameProgramTemplateAction,
} from '../program-template-actions'

/**
 * LPT-2 — the Programs tab list. Renders the org's saved program templates
 * (engine: save_program_as_template / create_program_from_template) with a
 * structure summary, instantiation count, and rename/delete management.
 * Apply-to-client (LPT-4) and preview (LPT-3) land in the next pass.
 */
export function ProgramsTab({
  templates,
  clients,
}: {
  templates: ProgramTemplateSummary[]
  clients: ClientOption[]
}) {
  if (templates.length === 0) return <EmptyState />

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 14,
      }}
    >
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} clients={clients} />
      ))}
    </div>
  )
}

function TemplateCard({
  template: t,
  clients,
}: {
  template: ProgramTemplateSummary
  clients: ClientOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyClient, setApplyClient] = useState('')
  const [applyDate, setApplyDate] = useState('')
  const [name, setName] = useState(t.name)
  const [error, setError] = useState<string | null>(null)

  function handleApply() {
    if (!applyClient) {
      setError('Pick a client.')
      return
    }
    if (!applyDate) {
      setError('Pick a start date.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await applyProgramTemplateAction(t.id, applyClient, applyDate)
      if ('error' in res) {
        setError(res.error)
        return
      }
      if (res.status === 'overlap') {
        setError(
          'This client already has an active block covering these dates. Pick a later start date.',
        )
        return
      }
      // Created → land the EP on the new block's calendar.
      router.push(`/clients/${res.clientId}/program`)
    })
  }

  function handleDelete() {
    setMenuOpen(false)
    const usage =
      t.usedCount > 0
        ? `\n\nStarted by ${t.usedCount} ${t.usedCount === 1 ? 'client' : 'clients'}. Deleting hides the template; their programs are unaffected.`
        : ''
    if (!window.confirm(`Delete "${t.name}"?${usage}`)) return
    setError(null)
    startTransition(async () => {
      const res = await deleteProgramTemplateAction(t.id)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  function handleRename() {
    const trimmed = name.trim()
    if (trimmed === t.name) {
      setRenaming(false)
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await renameProgramTemplateAction(t.id, trimmed)
      if (res.error) {
        setError(res.error)
      } else {
        setRenaming(false)
        router.refresh()
      }
    })
  }

  const summary = [
    `${t.weekCount} ${t.weekCount === 1 ? 'week' : 'weeks'}`,
    `${t.dayCount} ${t.dayCount === 1 ? 'day' : 'days'}`,
    `${t.exerciseCount} ${t.exerciseCount === 1 ? 'exercise' : 'exercises'}`,
  ].join(' · ')

  return (
    <article
      className="card"
      style={{ position: 'relative', padding: '16px 18px' }}
    >
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
                    setName(t.name)
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
                  setName(t.name)
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
              {t.name}
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
            {t.usedCount > 0 && ` · used ${t.usedCount}×`}
          </div>
        </div>

        {!renaming && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <IconButton
              label="Template actions"
              onClick={() => setMenuOpen((o) => !o)}
            >
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
                      router.push(`/library/programs/${t.id}`)
                    }}
                  >
                    Preview
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

      {t.description && !renaming && (
        <div
          style={{
            fontSize: '.84rem',
            color: 'var(--color-text-light)',
            marginTop: 8,
            lineHeight: 1.5,
          }}
        >
          {t.description}
        </div>
      )}

      {!renaming && (
        <div style={{ marginTop: 12 }}>
          {applying ? (
            <div style={{ display: 'grid', gap: 8 }}>
              <select
                value={applyClient}
                onChange={(e) => setApplyClient(e.target.value)}
                aria-label="Client"
                style={fieldStyle}
              >
                <option value="">Choose a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.first_name} {c.last_name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={applyDate}
                onChange={(e) => setApplyDate(e.target.value)}
                aria-label="Start date"
                style={fieldStyle}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleApply}
                  disabled={pending}
                  style={{ flex: 1 }}
                >
                  {pending ? 'Applying…' : 'Apply'}
                </button>
                <button
                  type="button"
                  className="btn outline"
                  onClick={() => {
                    setApplying(false)
                    setError(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setError(null)
                setApplying(true)
              }}
              style={{ width: '100%' }}
            >
              Use template
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 10,
            fontSize: '.78rem',
            color: 'var(--color-alert)',
          }}
        >
          {error}
        </div>
      )}
    </article>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: '.86rem',
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
        No program templates yet
      </div>
      <p
        style={{
          fontSize: '.92rem',
          margin: '0 auto',
          lineHeight: 1.6,
          maxWidth: 460,
        }}
      >
        Build a training block for a client, then{' '}
        <strong style={{ color: 'var(--color-text)' }}>Save as template</strong>{' '}
        from the program calendar — it&rsquo;ll appear here to reuse for any
        client.
      </p>
    </div>
  )
}

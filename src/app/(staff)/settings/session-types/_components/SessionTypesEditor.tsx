'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  createSessionTypeAction,
  deleteSessionTypeAction,
  updateSessionTypeAction,
  type SessionTypeRow,
} from '../actions'

type Draft = {
  name: string
  color: string
}

const DEFAULT_NEW_COLOR = '#2DB24C'

/**
 * Client-side editor for session types. Each row is inline-editable —
 * changes debounce-commit on blur. A trailing row lets the user add a
 * new type; trash icons soft-delete existing ones.
 */
export function SessionTypesEditor({
  initialTypes,
}: {
  initialTypes: SessionTypeRow[]
}) {
  const router = useRouter()
  const [types, setTypes] = useState<SessionTypeRow[]>(initialTypes)
  const [newDraft, setNewDraft] = useState<Draft>({
    name: '',
    color: DEFAULT_NEW_COLOR,
  })
  const [rowError, setRowError] = useState<Record<string, string | null>>({})
  const [addError, setAddError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function setError(id: string, msg: string | null) {
    setRowError((prev) => ({ ...prev, [id]: msg }))
  }

  function commitEdit(row: SessionTypeRow, patch: Partial<Draft>) {
    const next = { ...row, ...patch }
    // Local optimistic update so the UI feels instant.
    setTypes((prev) => prev.map((t) => (t.id === row.id ? next : t)))
    startTransition(async () => {
      const res = await updateSessionTypeAction({
        id: row.id,
        name: next.name,
        color: next.color,
      })
      if (res.error) {
        setError(row.id, res.error)
        // Revert on failure.
        setTypes((prev) => prev.map((t) => (t.id === row.id ? row : t)))
        return
      }
      setError(row.id, null)
    })
  }

  function handleDelete(row: SessionTypeRow) {
    if (
      !confirm(
        `Delete "${row.name}"? Existing appointments with this type will stay labelled but use a fallback colour.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await deleteSessionTypeAction(row.id)
      if (res.error) {
        alert(res.error)
        return
      }
      setTypes((prev) => prev.filter((t) => t.id !== row.id))
      router.refresh()
    })
  }

  function handleAdd() {
    if (!newDraft.name.trim()) {
      setAddError('Name is required.')
      return
    }
    setAddError(null)
    startTransition(async () => {
      const res = await createSessionTypeAction({
        name: newDraft.name,
        color: newDraft.color,
      })
      if (res.error || !res.id) {
        setAddError(res.error ?? 'Unknown error.')
        return
      }
      // Re-pull the list to get correct sort_order + ID.
      router.refresh()
      setNewDraft({ name: '', color: DEFAULT_NEW_COLOR })
    })
  }

  return (
    <div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr 46px',
          gap: 12,
          padding: '8px 22px',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: '.64rem',
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          background: 'var(--color-surface)',
        }}
      >
        <div>Colour</div>
        <div>Name</div>
        <div />
      </div>

      {types.length === 0 && (
        <div
          style={{
            padding: '18px 16px',
            fontSize: '.86rem',
            color: 'var(--color-muted)',
          }}
        >
          No session types yet — add your first below.
        </div>
      )}

      {types.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '60px 1fr 46px',
            gap: 12,
            padding: '10px 22px',
            borderBottom: '1px solid var(--color-border-subtle)',
            alignItems: 'center',
          }}
        >
          <input
            type="color"
            value={t.color}
            onChange={(e) =>
              commitEdit(t, { color: e.target.value.toLowerCase() })
            }
            aria-label={`Colour for ${t.name}`}
            style={{
              width: 36,
              height: 28,
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 6,
              cursor: 'pointer',
              background: 'transparent',
              padding: 0,
            }}
          />
          <div>
            <input
              type="text"
              defaultValue={t.name}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next === t.name) return
                commitEdit(t, { name: next })
              }}
              aria-label={`Name for ${t.name}`}
              style={{
                width: '100%',
                height: 32,
                padding: '0 10px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 7,
                background: 'var(--color-surface)',
                fontFamily: 'var(--font-sans)',
                fontSize: '.9rem',
                color: 'var(--color-text)',
                outline: 'none',
              }}
            />
            {rowError[t.id] && (
              <div
                role="alert"
                style={{
                  fontSize: '.72rem',
                  color: 'var(--color-alert)',
                  marginTop: 4,
                }}
              >
                {rowError[t.id]}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label={`Delete ${t.name}`}
            onClick={() => handleDelete(t)}
            disabled={pending}
            style={{
              width: 32,
              height: 32,
              border: 'none',
              background: 'transparent',
              color: 'var(--color-alert)',
              cursor: pending ? 'wait' : 'pointer',
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Trash2 size={15} aria-hidden />
          </button>
        </div>
      ))}

      {/* Add row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr 46px',
          gap: 12,
          padding: '12px 22px',
          alignItems: 'center',
          background: 'var(--color-surface)',
        }}
      >
        <input
          type="color"
          value={newDraft.color}
          onChange={(e) =>
            setNewDraft((d) => ({
              ...d,
              color: e.target.value.toLowerCase(),
            }))
          }
          aria-label="New session type colour"
          style={{
            width: 36,
            height: 28,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 6,
            cursor: 'pointer',
            background: 'transparent',
            padding: 0,
          }}
        />
        <div>
          <input
            type="text"
            value={newDraft.name}
            onChange={(e) =>
              setNewDraft((d) => ({ ...d, name: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="e.g. Consultation"
            aria-label="New session type name"
            style={{
              width: '100%',
              height: 32,
              padding: '0 10px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 7,
              background: '#fff',
              fontFamily: 'var(--font-sans)',
              fontSize: '.9rem',
              color: 'var(--color-text)',
              outline: 'none',
            }}
          />
          {addError && (
            <div
              role="alert"
              style={{
                fontSize: '.72rem',
                color: 'var(--color-alert)',
                marginTop: 4,
              }}
            >
              {addError}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={pending || !newDraft.name.trim()}
          aria-label="Add session type"
          style={{
            width: 32,
            height: 32,
            border: 'none',
            background: 'var(--color-primary)',
            color: '#fff',
            cursor:
              pending || !newDraft.name.trim() ? 'not-allowed' : 'pointer',
            borderRadius: 6,
            display: 'grid',
            placeItems: 'center',
            opacity: pending || !newDraft.name.trim() ? 0.45 : 1,
          }}
        >
          <Plus size={15} aria-hidden />
        </button>
      </div>
    </div>
  )
}

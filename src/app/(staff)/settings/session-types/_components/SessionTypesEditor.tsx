'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import {
  createSessionTypeAction,
  deleteSessionTypeAction,
  updateSessionTypeAction,
  type SessionTypeKind,
  type SessionTypeRow,
} from '../actions'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'

type Draft = {
  name: string
  color: string
  default_duration_minutes: number
  kind: SessionTypeKind
}

const DEFAULT_NEW_COLOR = '#2DB24C'
const DEFAULT_NEW_DURATION = 45
const ROW_GRID = '60px 1fr 84px 46px'

const inputStyle: React.CSSProperties = {
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
}

/**
 * Client-side editor for session types. Rows are inline-editable —
 * colour/duration commit on change/blur; name commits on blur. Types are
 * grouped into Appointment and Unavailable (non-client time) sub-sections
 * (P1-7); the trailing add row creates either kind. Duration is the picker's
 * default slot length for that type (P1-6).
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
    default_duration_minutes: DEFAULT_NEW_DURATION,
    kind: 'appointment',
  })
  const [rowError, setRowError] = useState<Record<string, string | null>>({})
  const [addError, setAddError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SessionTypeRow | null>(
    null,
  )
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const appointmentTypes = types.filter((t) => t.kind !== 'unavailable')
  const unavailableTypes = types.filter((t) => t.kind === 'unavailable')

  function setError(id: string, msg: string | null) {
    setRowError((prev) => ({ ...prev, [id]: msg }))
  }

  function commitEdit(row: SessionTypeRow, patch: Partial<SessionTypeRow>) {
    const next = { ...row, ...patch }
    // Local optimistic update so the UI feels instant.
    setTypes((prev) => prev.map((t) => (t.id === row.id ? next : t)))
    startTransition(async () => {
      const res = await updateSessionTypeAction({
        id: row.id,
        name: next.name,
        color: next.color,
        default_duration_minutes: next.default_duration_minutes,
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

  // On-system confirm (shared ConfirmDialog) in place of browser confirm()/
  // alert(); a delete failure shows inside the dialog so the EP can retry.
  function runDelete() {
    const row = confirmDelete
    if (!row) return
    setDeleteError(null)
    startTransition(async () => {
      const res = await deleteSessionTypeAction(row.id)
      if (res.error) {
        setDeleteError(res.error)
        return
      }
      setTypes((prev) => prev.filter((t) => t.id !== row.id))
      setConfirmDelete(null)
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
        default_duration_minutes: newDraft.default_duration_minutes,
        kind: newDraft.kind,
      })
      if (res.error || !res.id) {
        setAddError(res.error ?? 'Unknown error.')
        return
      }
      // Append locally — useState(initialTypes) doesn't re-initialise when the
      // refreshed server payload changes the prop, so mirror the server's
      // normalisation (name trimmed, colour lowercased).
      setTypes((prev) => [
        ...prev,
        {
          id: res.id!,
          name: newDraft.name.trim(),
          color: newDraft.color.trim().toLowerCase(),
          sort_order: (prev[prev.length - 1]?.sort_order ?? 0) + 10,
          default_duration_minutes: newDraft.default_duration_minutes,
          kind: newDraft.kind,
        },
      ])
      router.refresh()
      setNewDraft((d) => ({
        ...d,
        name: '',
        color: DEFAULT_NEW_COLOR,
        default_duration_minutes: DEFAULT_NEW_DURATION,
      }))
    })
  }

  function renderRow(t: SessionTypeRow) {
    return (
      <div
        key={t.id}
        style={{
          display: 'grid',
          gridTemplateColumns: ROW_GRID,
          gap: 12,
          padding: '10px 22px',
          borderBottom: '1px solid var(--color-border-subtle)',
          alignItems: 'center',
        }}
      >
        <input
          type="color"
          value={t.color}
          onChange={(e) => commitEdit(t, { color: e.target.value.toLowerCase() })}
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
            style={inputStyle}
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
        <input
          type="number"
          defaultValue={t.default_duration_minutes}
          min={5}
          max={240}
          step={5}
          onBlur={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!Number.isFinite(v) || v === t.default_duration_minutes) return
            commitEdit(t, { default_duration_minutes: v })
          }}
          aria-label={`Default minutes for ${t.name}`}
          style={inputStyle}
        />
        <button
          type="button"
          aria-label={`Delete ${t.name}`}
          onClick={() => {
            setDeleteError(null)
            setConfirmDelete(t)
          }}
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
    )
  }

  function subHeader(label: string) {
    return (
      <div
        style={{
          padding: '10px 22px 6px',
          fontSize: '.64rem',
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.06em',
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        {label}
      </div>
    )
  }

  return (
    <div>
      {/* Column header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: ROW_GRID,
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
        <div>Mins</div>
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

      {appointmentTypes.length > 0 && subHeader('Appointment types')}
      {appointmentTypes.map(renderRow)}

      {unavailableTypes.length > 0 &&
        subHeader('Unavailable · non-client time')}
      {unavailableTypes.map(renderRow)}

      {/* Add row — creates either kind */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr 84px 124px 46px',
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
            setNewDraft((d) => ({ ...d, color: e.target.value.toLowerCase() }))
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
            placeholder={
              newDraft.kind === 'unavailable'
                ? 'e.g. Supervision'
                : 'e.g. Consultation'
            }
            aria-label="New session type name"
            style={{ ...inputStyle, background: '#fff' }}
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
        <input
          type="number"
          value={newDraft.default_duration_minutes}
          min={5}
          max={240}
          step={5}
          onChange={(e) =>
            setNewDraft((d) => ({
              ...d,
              default_duration_minutes: parseInt(e.target.value, 10) || 0,
            }))
          }
          aria-label="New session type default minutes"
          style={{ ...inputStyle, background: '#fff' }}
        />
        <select
          value={newDraft.kind}
          onChange={(e) =>
            setNewDraft((d) => ({
              ...d,
              kind: e.target.value as SessionTypeKind,
            }))
          }
          aria-label="New session type kind"
          style={{ ...inputStyle, background: '#fff' }}
        >
          <option value="appointment">Appointment</option>
          <option value="unavailable">Unavailable</option>
        </select>
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

      {confirmDelete && (
        <ConfirmDialog
          title="Delete session type?"
          body={
            <>
              Delete “{confirmDelete.name}”? Existing appointments with this
              type will stay labelled but use a fallback colour.
            </>
          }
          confirmLabel="Delete"
          busy={pending}
          error={deleteError}
          onCancel={() => {
            if (pending) return
            setConfirmDelete(null)
            setDeleteError(null)
          }}
          onConfirm={runDelete}
        />
      )}
    </div>
  )
}

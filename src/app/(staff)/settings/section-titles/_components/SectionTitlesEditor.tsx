'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  createSectionTitleSettingAction,
  deleteSectionTitleAction,
  moveSectionTitleAction,
  renameSectionTitleAction,
  type SectionTitleRow,
} from '../actions'

/**
 * Settings editor for the session builder's per-exercise section titles
 * (G-5, brief §6.5.1: add / remove / reorder / rename). Mirrors the
 * SessionTypesEditor pattern: inline rename on blur with optimistic
 * update + revert, confirm-then-delete, trailing add row. Reorder is
 * arrow-button based — the dropdown in the builder follows sort_order.
 *
 * Everything here is dropdown-only: section titles are copied as text at
 * prescribe time, so no existing program is touched by any edit.
 */
export function SectionTitlesEditor({
  initialTitles,
}: {
  initialTitles: SectionTitleRow[]
}) {
  const router = useRouter()
  const [titles, setTitles] = useState<SectionTitleRow[]>(initialTitles)
  const [newName, setNewName] = useState('')
  const [rowError, setRowError] = useState<Record<string, string | null>>({})
  const [addError, setAddError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function setError(id: string, msg: string | null) {
    setRowError((prev) => ({ ...prev, [id]: msg }))
  }

  function commitRename(row: SectionTitleRow, nextName: string) {
    const next = { ...row, name: nextName }
    setTitles((prev) => prev.map((t) => (t.id === row.id ? next : t)))
    startTransition(async () => {
      const res = await renameSectionTitleAction(row.id, nextName)
      if (res.error) {
        setError(row.id, res.error)
        setTitles((prev) => prev.map((t) => (t.id === row.id ? row : t)))
        return
      }
      setError(row.id, null)
    })
  }

  function handleMove(row: SectionTitleRow, direction: 'up' | 'down') {
    // Optimistic local reorder; server renumbers authoritatively.
    setTitles((prev) => {
      const index = prev.findIndex((t) => t.id === row.id)
      const target = direction === 'up' ? index - 1 : index + 1
      if (index === -1 || target < 0 || target >= prev.length) return prev
      const copy = [...prev]
      const [moved] = copy.splice(index, 1)
      copy.splice(target, 0, moved!)
      return copy
    })
    startTransition(async () => {
      const res = await moveSectionTitleAction(row.id, direction)
      if (res.error) {
        setError(row.id, res.error)
        router.refresh() // pull the server's order back
        return
      }
      setError(row.id, null)
    })
  }

  function handleDelete(row: SectionTitleRow) {
    if (
      !confirm(
        `Delete "${row.name}"? Exercises already carrying this title keep it — this only removes it from the builder's dropdown.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await deleteSectionTitleAction(row.id)
      if (res.error) {
        alert(res.error)
        return
      }
      setTitles((prev) => prev.filter((t) => t.id !== row.id))
      router.refresh()
    })
  }

  function handleAdd() {
    const trimmed = newName.trim()
    if (!trimmed) {
      setAddError('Name is required.')
      return
    }
    setAddError(null)
    startTransition(async () => {
      const res = await createSectionTitleSettingAction(trimmed)
      if (res.error || !res.id) {
        setAddError(res.error ?? 'Unknown error.')
        return
      }
      // Append locally — router.refresh() alone can't update the list
      // because useState(initialTitles) doesn't re-initialise when the
      // refreshed server payload changes the prop. (The same latent gap
      // exists in the SessionTypesEditor this mirrors — flagged as a
      // rider in the polish doc rather than reopening that section.)
      setTitles((prev) => [
        ...prev,
        {
          id: res.id!,
          name: trimmed,
          sort_order: (prev[prev.length - 1]?.sort_order ?? 0) + 10,
        },
      ])
      router.refresh()
      setNewName('')
    })
  }

  return (
    <div>
      {titles.length === 0 && (
        <div
          style={{
            padding: '18px 22px',
            fontSize: '.86rem',
            color: 'var(--color-muted)',
          }}
        >
          No section titles yet — add your first below.
        </div>
      )}

      {titles.map((t, i) => (
        <div
          key={t.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 32px 32px 46px',
            gap: 8,
            padding: '10px 22px',
            borderBottom: '1px solid var(--color-border-subtle)',
            alignItems: 'center',
          }}
        >
          <div>
            <input
              type="text"
              defaultValue={t.name}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next === t.name) return
                commitRename(t, next)
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
          <IconAction
            label={`Move ${t.name} up`}
            disabled={pending || i === 0}
            onClick={() => handleMove(t, 'up')}
          >
            <ArrowUp size={15} aria-hidden />
          </IconAction>
          <IconAction
            label={`Move ${t.name} down`}
            disabled={pending || i === titles.length - 1}
            onClick={() => handleMove(t, 'down')}
          >
            <ArrowDown size={15} aria-hidden />
          </IconAction>
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
          gridTemplateColumns: '1fr 46px',
          gap: 8,
          padding: '12px 22px',
          alignItems: 'center',
          background: 'var(--color-surface)',
        }}
      >
        <div>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder="e.g. Contrast Work"
            aria-label="New section title name"
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
          disabled={pending || !newName.trim()}
          aria-label="Add section title"
          style={{
            width: 32,
            height: 32,
            border: 'none',
            background: 'var(--color-primary)',
            color: '#fff',
            cursor: pending || !newName.trim() ? 'not-allowed' : 'pointer',
            borderRadius: 6,
            display: 'grid',
            placeItems: 'center',
            opacity: pending || !newName.trim() ? 0.45 : 1,
          }}
        >
          <Plus size={15} aria-hidden />
        </button>
      </div>
    </div>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: 32,
        height: 32,
        border: 'none',
        background: 'transparent',
        color: disabled ? 'var(--color-text-faint)' : 'var(--color-muted)',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 6,
        display: 'grid',
        placeItems: 'center',
      }}
    >
      {children}
    </button>
  )
}

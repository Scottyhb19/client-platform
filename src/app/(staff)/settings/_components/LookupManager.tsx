'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import {
  addClientCategoryAction,
  addExerciseTagAction,
  removeClientCategoryAction,
  removeExerciseTagAction,
} from '../actions'
import { inputStyle } from './PracticeInfoForm'

export type LookupRow = { id: string; name: string }

type Kind = 'tags' | 'categories'

const ACTIONS = {
  tags: {
    add: addExerciseTagAction,
    remove: removeExerciseTagAction,
    placeholder: 'New tag name…',
  },
  categories: {
    add: addClientCategoryAction,
    remove: removeClientCategoryAction,
    placeholder: 'New category name…',
  },
}

export function LookupManager({
  kind,
  rows,
}: {
  kind: Kind
  rows: LookupRow[]
}) {
  const { add, remove, placeholder } = ACTIONS[kind]
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    setError(null)
    startTransition(async () => {
      const res = await add(trimmed)
      if (res.error) {
        setError(res.error)
        return
      }
      setName('')
    })
  }

  function handleRemove(id: string, rowName: string) {
    if (
      !confirm(
        `Remove "${rowName}"? Existing records keep using it but it'll be hidden from new pickers.`,
      )
    )
      return
    startTransition(async () => {
      const res = await remove(id)
      if (res.error) alert(res.error)
    })
  }

  return (
    <div style={{ padding: '20px 22px' }}>
      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 12px',
            background: 'rgba(214,64,69,.08)',
            border: '1px solid rgba(214,64,69,.25)',
            borderRadius: 8,
            color: 'var(--color-alert)',
            fontSize: '.82rem',
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {/* Existing chips */}
      {rows.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-muted)',
            marginBottom: 14,
          }}
        >
          None yet — add one below.
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginBottom: 14,
          }}
        >
          {rows.map((r) => (
            <span
              key={r.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 10px',
                background: 'var(--color-surface-2)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 8,
                fontSize: '.8rem',
                fontWeight: 500,
              }}
            >
              {r.name}
              <button
                type="button"
                onClick={() => handleRemove(r.id, r.name)}
                disabled={pending}
                aria-label={`Remove ${r.name}`}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-muted)',
                  padding: 0,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <X size={12} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Add row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAdd()
            }
          }}
          placeholder={placeholder}
          style={{ ...inputStyle, height: 34, flex: 1 }}
        />
        <button
          type="button"
          className="btn outline"
          onClick={handleAdd}
          disabled={pending || name.trim() === ''}
        >
          {pending ? 'Adding…' : `Add ${kind === 'tags' ? 'tag' : 'category'}`}
        </button>
      </div>
    </div>
  )
}

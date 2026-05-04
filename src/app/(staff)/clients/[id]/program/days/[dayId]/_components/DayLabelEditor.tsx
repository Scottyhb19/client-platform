'use client'

import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { renameProgramDayAction } from '../../../day-actions'

const MAX_LEN = 30

interface DayLabelEditorProps {
  clientId: string
  dayId: string
  initialLabel: string
}

/**
 * Inline rename for a program_day's `day_label`. Click the label → text
 * field with the current value selected → Enter/blur to save, Esc to
 * cancel. Length capped at 30 to match the `program_days.day_label`
 * CHECK constraint.
 *
 * Visually it lives in the eyebrow line of the session builder header,
 * so the affordance is intentionally subtle (a hairline pencil that
 * fades in on hover) — the click target is the label itself.
 */
export function DayLabelEditor({
  clientId,
  dayId,
  initialLabel,
}: DayLabelEditorProps) {
  const router = useRouter()
  const [label, setLabel] = useState(initialLabel)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initialLabel)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Keep local state in sync if a parent refresh hands down a new label
  // (e.g. concurrent edit from another tab + revalidate).
  useEffect(() => {
    if (!editing) setLabel(initialLabel)
  }, [initialLabel, editing])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function startEdit() {
    setDraft(label)
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setError(null)
    setEditing(false)
  }

  function save() {
    const trimmed = draft.trim()
    if (trimmed.length < 1) {
      setError('Cannot be empty.')
      return
    }
    if (trimmed.length > MAX_LEN) {
      setError(`Max ${MAX_LEN} characters.`)
      return
    }
    if (trimmed === label) {
      setEditing(false)
      return
    }
    startTransition(async () => {
      const result = await renameProgramDayAction(clientId, dayId, trimmed)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setLabel(result.dayLabel)
      setEditing(false)
      router.refresh()
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title="Rename session"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '0 4px',
          margin: '0 -4px',
          background: 'transparent',
          border: 'none',
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
          borderRadius: 5,
        }}
      >
        <span>{label}</span>
        <Pencil
          size={14}
          aria-hidden
          style={{
            opacity: hovered ? 0.55 : 0,
            transition: 'opacity 150ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        verticalAlign: 'baseline',
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        maxLength={MAX_LEN}
        disabled={pending}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onBlur={() => save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelEdit()
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-label="Session name"
        style={{
          font: 'inherit',
          color: 'inherit',
          padding: '2px 8px',
          height: '1.5em',
          minWidth: 100,
          maxWidth: 280,
          border: '1px solid',
          borderColor: error
            ? 'var(--color-alert)'
            : 'var(--color-border-subtle)',
          borderRadius: 6,
          background: 'var(--color-card)',
          outline: 'none',
        }}
      />
      {error && (
        <span style={{ fontSize: '.7rem', color: 'var(--color-alert)' }}>
          {error}
        </span>
      )}
    </span>
  )
}

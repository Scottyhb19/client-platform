'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { deleteExerciseAction } from '../actions'

interface CardMenuProps {
  exerciseId: string
  exerciseName: string
  usageCount: number
}

export function CardMenu({
  exerciseId,
  exerciseName,
  usageCount,
}: CardMenuProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    const message =
      usageCount > 0
        ? `Delete "${exerciseName}"?\n\nUsed in ${usageCount} program ${usageCount === 1 ? 'day' : 'days'}. The exercise will be hidden from the library; existing prescriptions are unaffected.`
        : `Delete "${exerciseName}"?`
    if (!confirm(message)) return
    startTransition(async () => {
      const res = await deleteExerciseAction(exerciseId)
      if (res.error) {
        alert(res.error)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Actions for ${exerciseName}`}
        aria-expanded={open}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: 'var(--color-muted)',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 6,
        }}
      >
        <MoreVertical size={16} aria-hidden />
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
          />
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              minWidth: 160,
              background: 'var(--color-card)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              zIndex: 20,
              overflow: 'hidden',
            }}
          >
            <Link
              href={`/library/${exerciseId}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={menuItemStyle}
            >
              <Pencil size={14} aria-hidden /> Edit
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              disabled={pending}
              style={{
                ...menuItemStyle,
                width: '100%',
                background: 'none',
                border: 'none',
                cursor: pending ? 'wait' : 'pointer',
                color: 'var(--color-alert)',
              }}
            >
              <Trash2 size={14} aria-hidden />{' '}
              {pending ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  fontSize: '.84rem',
  color: 'var(--color-text)',
  textDecoration: 'none',
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  textAlign: 'left',
}

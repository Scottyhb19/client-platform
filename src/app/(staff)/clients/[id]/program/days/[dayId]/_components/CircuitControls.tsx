'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { CIRCUIT_TYPE_LABELS, type CircuitType } from '@/app/(staff)/library/types'
import { addCircuitToDayAction, saveGroupAsCircuitAction } from '../actions'

/** A circuit option for the session-builder pickers (C-5/C-6). */
export type CircuitOption = {
  id: string
  name: string
  circuit_type: CircuitType
}

/**
 * C-6 — "Add circuit" picker. Renders above the LibraryPanel in the session
 * builder's right-panel Library tab. Picking a circuit appends its exercises to
 * the day as one fresh superset group (insert_circuit_into_day, copy-on-apply).
 * Self-contained so LibraryPanel stays untouched; renders nothing when the org
 * has no circuits yet (so the panel isn't cluttered before any exist).
 */
export function AddCircuitPicker({
  circuits,
  clientId,
  dayId,
}: {
  circuits: CircuitOption[]
  clientId: string
  dayId: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (circuits.length === 0) return null

  function handleAdd(circuitId: string) {
    setError(null)
    startTransition(async () => {
      const res = await addCircuitToDayAction(clientId, dayId, circuitId)
      if (res.error) setError(res.error)
      else router.refresh()
    })
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="eyebrow"
        style={{ marginBottom: 8, color: 'var(--color-muted)' }}
      >
        Add a circuit
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        {circuits.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={pending}
            onClick={() => handleAdd(c.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              padding: '9px 11px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-input)',
              background: 'var(--color-surface)',
              cursor: pending ? 'default' : 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: '.86rem',
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {c.name}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '.62rem',
                letterSpacing: '.05em',
                textTransform: 'uppercase',
                color: 'var(--color-muted)',
                flexShrink: 0,
              }}
            >
              {CIRCUIT_TYPE_LABELS[c.circuit_type]}
            </span>
            <Plus size={14} aria-hidden style={{ color: 'var(--color-text-light)', flexShrink: 0 }} />
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: '.78rem', color: 'var(--color-alert)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

/**
 * C-5 — "Save as circuit" group action, rendered in the SupersetBlock footer.
 * Prompts for a name, infers the type from member count (2 → superset, 3 →
 * tri-set, else circuit), and saves the group's exercises (+ per-set rows) as a
 * reusable circuit (save_group_as_circuit). prompt()/alert() match the builder's
 * existing confirm()/alert() modals; an inline rename is a later refinement.
 */
export function SaveAsCircuitButton({ memberIds }: { memberIds: string[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleSave() {
    const raw = window.prompt('Save this group as a reusable circuit.\n\nName:')
    const name = raw?.trim()
    if (!name) return

    const type: CircuitType =
      memberIds.length === 2 ? 'superset' : memberIds.length === 3 ? 'triset' : 'circuit'

    startTransition(async () => {
      const res = await saveGroupAsCircuitAction(name, type, memberIds)
      if ('error' in res) {
        alert(res.error)
        return
      }
      if (res.status === 'duplicate_name') {
        alert(`A circuit called "${name}" already exists. Pick another name.`)
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleSave}
      disabled={pending}
      style={{
        border: 'none',
        background: 'none',
        padding: '4px 2px',
        cursor: pending ? 'default' : 'pointer',
        fontFamily: 'var(--font-sans)',
        fontWeight: 600,
        fontSize: '.74rem',
        letterSpacing: '.02em',
        color: 'var(--color-text-light)',
        opacity: pending ? 0.6 : 1,
      }}
    >
      {pending ? 'Saving…' : 'Save as circuit'}
    </button>
  )
}

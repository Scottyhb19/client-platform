'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Search, Trash2, X } from 'lucide-react'
import {
  addCircuitExerciseSetAction,
  addExerciseToCircuitAction,
  removeCircuitExerciseAction,
  removeCircuitExerciseSetAction,
  updateCircuitAction,
  updateCircuitExerciseRepMetricAction,
  updateCircuitExerciseSetAction,
} from '../../../circuit-actions'
import { CIRCUIT_TYPE_LABELS, type CircuitType } from '../../../types'
import { VOLUME_UNIT_OPTIONS } from '@/lib/prescription/volume-units'

export type EditorSet = {
  id: string
  set_number: number
  reps: string | null
  rep_metric: string | null
  optional_metric: string | null
  optional_value: string | null
}
export type EditorExercise = {
  id: string
  exercise_id: string
  exercise_name: string
  sets: EditorSet[]
}
export type EditorCircuit = {
  id: string
  name: string
  circuit_type: CircuitType
  notes: string | null
  exercises: EditorExercise[]
}
export type EditorExerciseOption = { id: string; name: string }

const CIRCUIT_TYPES: CircuitType[] = ['superset', 'triset', 'circuit', 'finisher', 'warmup']

const fieldStyle: React.CSSProperties = {
  height: 34,
  padding: '0 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: '.86rem',
  color: 'var(--color-text)',
  outline: 'none',
}

export function CircuitEditor({
  circuit,
  library,
}: {
  circuit: EditorCircuit
  library: EditorExerciseOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [type, setType] = useState<CircuitType>(circuit.circuit_type)
  const [nameError, setNameError] = useState<string | null>(null)

  function saveName(value: string) {
    const name = value.trim()
    if (name === circuit.name) return
    startTransition(async () => {
      const res = await updateCircuitAction(circuit.id, { name })
      if (res.error) setNameError(res.error)
      else {
        setNameError(null)
        router.refresh()
      }
    })
  }

  function saveType(value: CircuitType) {
    setType(value)
    startTransition(async () => {
      await updateCircuitAction(circuit.id, { circuit_type: value })
      router.refresh()
    })
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link
          href="/library"
          aria-label="Back to library"
          style={{ color: 'var(--color-text-light)', padding: 6, display: 'grid', placeItems: 'center' }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div className="eyebrow" style={{ marginBottom: 0 }}>
          Circuit · editing
        </div>
      </div>

      {/* Name + type */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle}>Name</label>
          <input
            defaultValue={circuit.name}
            onBlur={(e) => saveName(e.target.value)}
            placeholder="Circuit name"
            style={{ ...fieldStyle, width: '100%', height: 40, fontSize: '1rem', fontWeight: 600 }}
          />
          {nameError && (
            <div role="alert" style={{ marginTop: 6, fontSize: '.78rem', color: 'var(--color-alert)' }}>
              {nameError}
            </div>
          )}
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle}>Type</label>
          <select
            value={type}
            onChange={(e) => saveType(e.target.value as CircuitType)}
            style={{ ...fieldStyle, width: '100%', height: 40 }}
          >
            {CIRCUIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {CIRCUIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Exercises */}
      <div style={{ display: 'grid', gap: 12 }}>
        {circuit.exercises.length === 0 ? (
          <div
            className="card"
            style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--color-text-light)' }}
          >
            No exercises yet — add some below.
          </div>
        ) : (
          circuit.exercises.map((ex) => (
            <ExerciseCard key={ex.id} circuitId={circuit.id} exercise={ex} />
          ))
        )}
      </div>

      <AddExercisePicker circuitId={circuit.id} library={library} />
    </div>
  )
}

function ExerciseCard({ circuitId, exercise }: { circuitId: string; exercise: EditorExercise }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const measure = exercise.sets[0]?.rep_metric ?? ''

  function refreshAfter(fn: () => Promise<{ error: string | null }>) {
    startTransition(async () => {
      const res = await fn()
      if (res.error) alert(res.error)
      else router.refresh()
    })
  }

  return (
    <article className="card" style={{ padding: '14px 16px', opacity: pending ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: '.95rem',
            color: 'var(--color-charcoal)',
            overflowWrap: 'anywhere',
          }}
        >
          {exercise.exercise_name}
        </div>
        <select
          value={measure}
          aria-label="Measure"
          onChange={(e) =>
            refreshAfter(() =>
              updateCircuitExerciseRepMetricAction(circuitId, exercise.id, e.target.value || null),
            )
          }
          style={{ ...fieldStyle, width: 110 }}
        >
          {VOLUME_UNIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <IconButton
          label={`Remove ${exercise.exercise_name}`}
          onClick={() => {
            if (!confirm(`Remove ${exercise.exercise_name} from this circuit?`)) return
            refreshAfter(() => removeCircuitExerciseAction(circuitId, exercise.id))
          }}
        >
          <Trash2 size={15} aria-hidden />
        </IconButton>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        {exercise.sets.map((s) => (
          <SetRow
            key={s.id}
            circuitId={circuitId}
            set={s}
            canRemove={exercise.sets.length > 1}
            onRemove={() =>
              refreshAfter(() => removeCircuitExerciseSetAction(circuitId, s.id))
            }
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => refreshAfter(() => addCircuitExerciseSetAction(circuitId, exercise.id))}
        style={{
          marginTop: 8,
          border: 'none',
          background: 'none',
          padding: '4px 2px',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: '.76rem',
          color: 'var(--color-primary)',
        }}
      >
        <Plus size={12} aria-hidden /> Add set
      </button>
    </article>
  )
}

function SetRow({
  circuitId,
  set,
  canRemove,
  onRemove,
}: {
  circuitId: string
  set: EditorSet
  canRemove: boolean
  onRemove: () => void
}) {
  // Autosave on blur; no refresh needed — the DOM value already equals what was
  // saved, and the next structural action re-fetches.
  function save(patch: { reps?: string | null; optional_value?: string | null }) {
    void updateCircuitExerciseSetAction(circuitId, set.id, patch)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          width: 22,
          textAlign: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.78rem',
          color: 'var(--color-muted)',
        }}
      >
        {set.set_number}
      </span>
      <input
        defaultValue={set.reps ?? ''}
        onBlur={(e) => save({ reps: e.target.value.trim() || null })}
        placeholder="reps"
        aria-label={`Set ${set.set_number} reps`}
        style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
      />
      <input
        defaultValue={set.optional_value ?? ''}
        onBlur={(e) => save({ optional_value: e.target.value.trim() || null })}
        placeholder="load / notes"
        aria-label={`Set ${set.set_number} load`}
        style={{ ...fieldStyle, flex: 1, minWidth: 0 }}
      />
      <IconButton
        label={`Remove set ${set.set_number}`}
        onClick={onRemove}
        disabled={!canRemove}
      >
        <X size={14} aria-hidden />
      </IconButton>
    </div>
  )
}

function AddExercisePicker({
  circuitId,
  library,
}: {
  circuitId: string
  library: EditorExerciseOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [query, setQuery] = useState('')

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return library.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 8)
  }, [query, library])

  function add(exerciseId: string) {
    startTransition(async () => {
      const res = await addExerciseToCircuitAction(circuitId, exerciseId)
      if (res.error) alert(res.error)
      else {
        setQuery('')
        router.refresh()
      }
    })
  }

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <label style={labelStyle}>Add an exercise</label>
      <div style={{ position: 'relative' }}>
        <Search
          size={15}
          aria-hidden
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-text-light)',
          }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the exercise library…"
          aria-label="Search exercises"
          disabled={pending}
          style={{ ...fieldStyle, width: '100%', height: 38, paddingLeft: 32 }}
        />
      </div>
      {matches.length > 0 && (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {matches.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={pending}
              onClick={() => add(e.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                padding: '8px 10px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-input)',
                background: 'var(--color-surface)',
                cursor: pending ? 'default' : 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: '.86rem',
                color: 'var(--color-text)',
              }}
            >
              <Plus size={13} aria-hidden style={{ color: 'var(--color-text-light)' }} />
              <span style={{ flex: 1 }}>{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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
        flexShrink: 0,
        border: 'none',
        background: 'none',
        borderRadius: 'var(--radius-button)',
        color: 'var(--color-text-light)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-display)',
  fontSize: '.66rem',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: 5,
}

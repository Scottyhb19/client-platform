'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowLeft, ArrowUp, Play, Trash2 } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  addCircuitExerciseSetAction,
  moveCircuitExerciseAction,
  removeCircuitExerciseAction,
  removeCircuitExerciseSetAction,
  reorderCircuitExercisesAction,
  updateCircuitAction,
  updateCircuitExerciseAction,
  updateCircuitExerciseMetricAction,
  updateCircuitExerciseRepMetricAction,
  updateCircuitExerciseSetAction,
} from '../../../circuit-actions'
import { CIRCUIT_TYPE_LABELS, type CircuitType } from '../../../types'
import type { LibraryExercise } from '@/app/(staff)/library/types'
import {
  DragHandle,
  DraggedCardGhost,
  EditableTextarea,
  ExtrasRow,
  IconButton,
  SaveStatusContext,
  SaveStatusPill,
  SetStepper,
  SetTable,
  SortableCardShell,
  SpineLetter,
  useSaveRun,
  useSaveStatus,
  BORDER,
  FAINT,
  INK,
  MUTED,
} from '@/app/(staff)/library/_components/editor-kit'
import { CircuitLibraryPanel } from './CircuitLibraryPanel'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'

/*
 * Circuit editor (#3 workbench) — card UI carbon-copied from the session
 * builder so an EP edits a circuit on the exact same card as a session, minus
 * the Notes/Reports tabs, the last-logged footer, swap-in-place, superset
 * grouping, and section title. A circuit IS one group, so its exercises render
 * under a single continuous slate spine (A1, A2…), and drag-to-reorder (the
 * 6-dot grip) reorders within that one group.
 *
 * The card atoms (set table, steppers, autosave fields, drag scaffolding,
 * save-status pill) now live in the shared editor-kit (A-1 of
 * docs/polish/library-sessions-programs.md) — this editor keeps only its own
 * orchestration (the one-group block + card body) and wires the kit atoms to
 * the circuit server actions via onCommit callbacks. SessionBuilder.tsx is
 * untouched.
 */

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
  exercise_video_url: string | null
  rest_seconds: number | null
  tempo: string | null
  instructions: string | null
  sets: EditorSet[]
}
export type EditorCircuit = {
  id: string
  name: string
  circuit_type: CircuitType
  notes: string | null
  exercises: EditorExercise[]
}
export type EditorMetricUnit = { code: string; display_label: string }

const CIRCUIT_TYPES: CircuitType[] = [
  'superset',
  'triset',
  'circuit',
  'finisher',
  'warmup',
]

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

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-display)',
  fontSize: '.66rem',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: 5,
}

export function CircuitEditor({
  circuit,
  library,
  movementPatterns,
  exerciseTags,
  metricUnits,
}: {
  circuit: EditorCircuit
  library: LibraryExercise[]
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  metricUnits: EditorMetricUnit[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [type, setType] = useState<CircuitType>(circuit.circuit_type)
  const [nameError, setNameError] = useState<string | null>(null)

  // Shared save-status state (see editor-kit SaveStatusPill). run() brackets
  // every save with a pending++/pending-- pair, marks the page touched, and
  // records the last outcome; here it also covers the top-level name/type saves.
  const { value: saveValue, run } = useSaveStatus()

  function saveName(value: string) {
    const name = value.trim()
    if (name === circuit.name) return
    startTransition(async () => {
      const res = await run(updateCircuitAction(circuit.id, { name }))
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
      await run(updateCircuitAction(circuit.id, { circuit_type: value }))
      router.refresh()
    })
  }

  return (
    <SaveStatusContext.Provider value={saveValue}>
      <div style={{ display: 'grid', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              href="/library"
              aria-label="Back to library"
              style={{
                color: 'var(--color-text-light)',
                padding: 6,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <ArrowLeft size={18} aria-hidden />
            </Link>
            <div className="eyebrow" style={{ marginBottom: 0 }}>
              Circuit · editing
            </div>
          </div>
          {/* Persistent autosave status — answers "is it safe to leave?" */}
          <SaveStatusPill />
        </div>

        {/* Name + type */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            alignItems: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <label style={labelStyle}>Name</label>
            <input
              defaultValue={circuit.name}
              onBlur={(e) => saveName(e.target.value)}
              placeholder="Circuit name"
              style={{
                ...fieldStyle,
                width: '100%',
                height: 40,
                fontSize: '1rem',
                fontWeight: 600,
              }}
            />
            {nameError && (
              <div
                role="alert"
                style={{
                  marginTop: 6,
                  fontSize: '.78rem',
                  color: 'var(--color-alert)',
                }}
              >
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

        {/* Two-column layout, mirroring the session builder: exercise group on
            the left, the Library picker pinned on the right. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 320px',
            gap: 28,
            alignItems: 'start',
          }}
        >
          <div>
            {circuit.exercises.length === 0 ? (
              <EmptyState />
            ) : (
              <CircuitGroupBlock
                circuitId={circuit.id}
                exercises={circuit.exercises}
                metricUnits={metricUnits}
              />
            )}
          </div>

          <aside
            style={{
              position: 'sticky',
              top: 20,
              height: 'calc(100vh - 40px)',
              overflowY: 'auto',
            }}
          >
            <CircuitLibraryPanel
              options={library}
              circuitId={circuit.id}
              movementPatterns={movementPatterns}
              exerciseTags={exerciseTags}
            />
          </aside>
        </div>
      </div>
    </SaveStatusContext.Provider>
  )
}

function EmptyState() {
  return (
    <div
      style={{
        background: 'var(--color-card)',
        border: `1px dashed ${BORDER}`,
        borderRadius: 'var(--radius-card)',
        padding: '40px 24px',
        textAlign: 'center',
        color: MUTED,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.1rem',
          color: INK,
          marginBottom: 4,
        }}
      >
        No exercises yet
      </div>
      <p
        style={{
          fontSize: '.86rem',
          lineHeight: 1.55,
          margin: '0 auto',
          maxWidth: 360,
        }}
      >
        Pick exercises from the Library panel on the right. Defaults are copied
        in; you can tweak the prescription per exercise inline.
      </p>
    </div>
  )
}

/* ====================== Grouped block (the circuit is one group) ====================== */

/**
 * Renders the circuit's exercises as ONE continuous slate-spine group with
 * A1, A2… letters — the SupersetBlock layout from the builder, generalised to
 * "the whole circuit is the group". Drag-and-drop (@dnd-kit) reorders within
 * the group via the 6-dot grip; the ↑/↓ arrows are the keyboard-accessible
 * fallback. No in-group "+ add" bars (exercises are added via the right Library
 * panel) and no Save-as-circuit footer (we're already inside a circuit).
 */
function CircuitGroupBlock({
  circuitId,
  exercises,
  metricUnits,
}: {
  circuitId: string
  exercises: EditorExercise[]
  metricUnits: EditorMetricUnit[]
}) {
  const router = useRouter()
  const run = useSaveRun()
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [, startReorder] = useTransition()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id as string)
  }
  function handleDragCancel() {
    setActiveDragId(null)
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = exercises.findIndex((x) => x.id === active.id)
    const newIndex = exercises.findIndex((x) => x.id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
    const orderedIds = arrayMove(exercises, oldIndex, newIndex).map((x) => x.id)
    startReorder(async () => {
      const res = await run(reorderCircuitExercisesAction(circuitId, orderedIds))
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  const activeEx =
    activeDragId !== null
      ? exercises.find((x) => x.id === activeDragId) ?? null
      : null

  return (
    <DndContext
      id="circuit-editor-dnd"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={exercises.map((x) => x.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '34px 1fr',
            columnGap: 10,
            rowGap: 10,
            position: 'relative',
          }}
        >
          {/* Continuous slate spine behind the left column, full block height. */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: 34,
              background: 'var(--color-slate)',
              borderRadius: 17,
              zIndex: 0,
            }}
          />
          {exercises.map((ex, idx) => (
            <React.Fragment key={ex.id}>
              <div
                style={{
                  gridColumn: 1,
                  gridRow: idx + 1,
                  display: 'grid',
                  placeItems: 'center',
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <SpineLetter>{`A${idx + 1}`}</SpineLetter>
              </div>
              <SortableCardShell
                id={ex.id}
                layoutStyle={{
                  gridColumn: 2,
                  gridRow: idx + 1,
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                <ExerciseBody
                  circuitId={circuitId}
                  exercise={ex}
                  isFirst={idx === 0}
                  isLast={idx === exercises.length - 1}
                  metricUnits={metricUnits}
                />
              </SortableCardShell>
            </React.Fragment>
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeEx ? <DraggedCardGhost name={activeEx.exercise_name} /> : null}
      </DragOverlay>
    </DndContext>
  )
}

/* ====================== Card body (left + right grid) ====================== */

function ExerciseBody({
  circuitId,
  exercise,
  isFirst,
  isLast,
  metricUnits,
}: {
  circuitId: string
  exercise: EditorExercise
  isFirst: boolean
  isLast: boolean
  metricUnits: EditorMetricUnit[]
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()
  // On-system confirm (shared ConfirmDialog) in place of browser confirm()/
  // alert(); a delete failure shows inside the dialog so the EP can retry.
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  function doRemove() {
    setRemoveError(null)
    startTransition(async () => {
      const res = await run(removeCircuitExerciseAction(circuitId, exercise.id))
      if (res.error) {
        setRemoveError(res.error)
        return
      }
      setConfirmRemove(false)
      router.refresh()
    })
  }

  function handleMove(direction: 'up' | 'down') {
    startTransition(async () => {
      const res = await run(
        moveCircuitExerciseAction(circuitId, exercise.id, direction),
      )
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.1fr 1.2fr',
        gap: 14,
        flex: 1,
        padding: '12px 14px',
        opacity: pending ? 0.55 : 1,
        transition: 'opacity 150ms',
      }}
    >
      {/* LEFT: name, instructions, demo video */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 15,
              color: INK,
              overflowWrap: 'anywhere',
            }}
          >
            {exercise.exercise_name}
          </div>
          <IconButton
            disabled={isFirst || pending}
            onClick={() => handleMove('up')}
            label="Move up"
          >
            <ArrowUp size={14} aria-hidden />
          </IconButton>
          <IconButton
            disabled={isLast || pending}
            onClick={() => handleMove('down')}
            label="Move down"
          >
            <ArrowDown size={14} aria-hidden />
          </IconButton>
          <IconButton
            disabled={pending}
            onClick={() => {
              setRemoveError(null)
              setConfirmRemove(true)
            }}
            label="Remove exercise"
          >
            <Trash2 size={14} aria-hidden />
          </IconButton>
          <DragHandle />
        </div>

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: FAINT,
            marginBottom: 6,
          }}
        >
          Instructions
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableTextarea
              initialValue={exercise.instructions ?? ''}
              placeholder="Add a coaching cue…"
              onCommit={(next) =>
                updateCircuitExerciseAction(circuitId, exercise.id, {
                  instructions: next,
                })
              }
            />
          </div>
          {exercise.exercise_video_url ? (
            <a
              href={exercise.exercise_video_url}
              target="_blank"
              rel="noreferrer"
              aria-label="Play demo video"
              style={{
                display: 'grid',
                placeItems: 'center',
                background: INK,
                borderRadius: 8,
                width: 96,
                height: 60,
                flexShrink: 0,
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.92)',
                  display: 'grid',
                  placeItems: 'center',
                  color: INK,
                }}
              >
                <Play size={12} aria-hidden fill="currentColor" />
              </span>
            </a>
          ) : (
            <div
              aria-label="No demo video"
              style={{
                display: 'grid',
                placeItems: 'center',
                background: INK,
                borderRadius: 8,
                width: 96,
                height: 60,
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.12)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                <Play size={12} aria-hidden />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: set table + stepper + extras — kit atoms wired to circuit actions */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <SetTable
          sets={exercise.sets}
          metricUnits={metricUnits}
          onRepsCommit={(setId, next) =>
            updateCircuitExerciseSetAction(circuitId, setId, { reps: next })
          }
          onValueCommit={(setId, next) =>
            updateCircuitExerciseSetAction(circuitId, setId, {
              optional_value: next,
            })
          }
          onRepMetricCommit={(next) =>
            updateCircuitExerciseRepMetricAction(circuitId, exercise.id, next)
          }
          onMetricCommit={(next) =>
            updateCircuitExerciseMetricAction(circuitId, exercise.id, next)
          }
        />
        <SetStepper
          count={exercise.sets.length}
          onAdd={() => addCircuitExerciseSetAction(circuitId, exercise.id)}
          onRemove={() => {
            const last = exercise.sets[exercise.sets.length - 1]
            return last
              ? removeCircuitExerciseSetAction(circuitId, last.id)
              : Promise.resolve({ error: null })
          }}
        />
        <ExtrasRow
          restSeconds={exercise.rest_seconds}
          tempo={exercise.tempo}
          onRestCommit={(next) =>
            updateCircuitExerciseAction(circuitId, exercise.id, {
              rest_seconds: next,
            })
          }
          onTempoCommit={(next) =>
            updateCircuitExerciseAction(circuitId, exercise.id, { tempo: next })
          }
        />
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove exercise?"
          body={
            <>
              <strong>{exercise.exercise_name}</strong> will be removed from
              this circuit, along with its sets.
            </>
          }
          confirmLabel="Remove"
          busy={pending}
          error={removeError}
          onCancel={() => {
            if (pending) return
            setConfirmRemove(false)
            setRemoveError(null)
          }}
          onConfirm={doRemove}
        />
      )}
    </div>
  )
}

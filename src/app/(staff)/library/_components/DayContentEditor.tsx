'use client'

import React, { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  Link2,
  Play,
  Plus,
  Search,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
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
import type { LibraryExercise } from '../types'
import { DayLibraryPanel } from './DayLibraryPanel'
import {
  DragHandle,
  DraggedCardGhost,
  EditableTextarea,
  ExtrasRow,
  IconButton,
  SetStepper,
  SetTable,
  SortableCardShell,
  SpineLetter,
  useSaveRun,
  type SaveResult,
  BORDER,
  FAINT,
  GREEN,
  INK,
  MUTED,
} from './editor-kit'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'
import { notify } from '@/app/(staff)/_components/Notice'

/*
 * DayContentEditor — the reusable, client-agnostic "edit a day of exercises"
 * surface (A-2 of docs/polish/library-sessions-programs.md). The grouping
 * engine (solo cards + superset spine + sections + insert bars + group/ungroup
 * + drag reorder) is cloned from the session builder
 * (clients/[id]/program/days/[dayId]/_components/SessionBuilder.tsx) — the
 * protected differentiator, which is NOT touched. Dropped from the clone:
 * the Notes/Reports right panel, the last-logged footer, swap-in-place, and
 * the save-as-circuit footer — none apply to a template with no client.
 *
 * Every mutation is delegated to an injected `actions` object, so the session
 * editor and the program-template editor each supply their own server actions
 * while the card UX stays identical. The leaf atoms (set table, steppers,
 * autosave fields, drag scaffolding) come from the shared editor-kit. The
 * consumer must render this inside a SaveStatusContext.Provider (the editor
 * page owns it, so the header's save-status pill reflects card edits too).
 */

export type DayEditorSet = {
  id: string
  set_number: number
  reps: string | null
  rep_metric: string | null
  optional_metric: string | null
  optional_value: string | null
}
export type DayEditorExercise = {
  id: string
  exercise_id: string
  exercise_name: string
  exercise_video_url: string | null
  section_title: string | null
  superset_group_id: string | null
  rest_seconds: number | null
  tempo: string | null
  instructions: string | null
  sets: DayEditorSet[]
}
export type SectionTitleOption = { id: string; name: string }
export type MetricUnitOption = { code: string; display_label: string }

/** Where a library pick lands. `after` carries the id of the row to insert
 * below (the between-cards bar's upper neighbour). */
export type InsertSlot =
  | { kind: 'append' }
  | { kind: 'atStart' }
  | { kind: 'after'; afterId: string }

export type DayExercisePatch = {
  rest_seconds?: number | null
  tempo?: string | null
  instructions?: string | null
  section_title?: string | null
}
export type DaySetPatch = {
  reps?: string | null
  optional_metric?: string | null
  optional_value?: string | null
}

/**
 * The mutation surface a consumer must implement. Each closes over the
 * consumer's container id (a session_template id, or a template_day id) so
 * this editor stays storage-agnostic. All return the kit's SaveResult so the
 * autosave pill and revert-on-error behaviour are uniform.
 */
export type DayEditorActions = {
  addExercise: (exerciseId: string, slot: InsertSlot) => Promise<SaveResult>
  removeExercise: (exerciseId: string) => Promise<SaveResult>
  moveExercise: (
    exerciseId: string,
    direction: 'up' | 'down',
  ) => Promise<SaveResult>
  reorderExercises: (
    orderedIds: string[],
    movedId: string,
  ) => Promise<SaveResult>
  groupAcross: (beforeId: string, afterId: string) => Promise<SaveResult>
  ungroup: (exerciseId: string) => Promise<SaveResult>
  updateExercise: (
    exerciseId: string,
    patch: DayExercisePatch,
  ) => Promise<SaveResult>
  updateSet: (setId: string, patch: DaySetPatch) => Promise<SaveResult>
  addSet: (exerciseId: string) => Promise<SaveResult>
  removeSet: (setId: string) => Promise<SaveResult>
  updateRepMetric: (
    exerciseId: string,
    next: string | null,
  ) => Promise<SaveResult>
  updateMetric: (exerciseId: string, next: string | null) => Promise<SaveResult>
  updateSectionTitle: (
    exerciseId: string,
    next: string | null,
  ) => Promise<SaveResult>
  addSectionTitle: (
    name: string,
  ) => Promise<{ data: { id: string; name: string } | null; error: string | null }>
}

export function DayContentEditor({
  exercises,
  library,
  movementPatterns,
  exerciseTags,
  metricUnits,
  sectionTitles,
  actions,
}: {
  exercises: DayEditorExercise[]
  library: LibraryExercise[]
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  metricUnits: MetricUnitOption[]
  sectionTitles: SectionTitleOption[]
  actions: DayEditorActions
}) {
  const router = useRouter()
  const run = useSaveRun()
  const [insertSlot, setInsertSlot] = useState<InsertSlot | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [, startReorderTransition] = useTransition()
  // Bumped by the empty-state "Browse the library" button — pulses the panel
  // border once so the EP's eye snaps to where the next action lives.
  const [panelFlashKey, setPanelFlashKey] = useState(0)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
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
    const oldIndex = exercises.findIndex((e) => e.id === active.id)
    const newIndex = exercises.findIndex((e) => e.id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
    const orderedIds = arrayMove(exercises, oldIndex, newIndex).map((e) => e.id)
    const movedId = active.id as string
    startReorderTransition(async () => {
      const res = await run(actions.reorderExercises(orderedIds, movedId))
      if (res.error) {
        notify(res.error)
        return
      }
      router.refresh()
    })
  }

  // Force-focus the library search input. Survives wrapper changes by keying
  // off the shared SearchInput's aria-label.
  function focusLibrarySearch() {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[aria-label="Search exercises"]',
      )
      el?.focus()
    })
  }
  function browseFromEmptyState() {
    focusLibrarySearch()
    setPanelFlashKey((n) => n + 1)
  }

  const activeDragEx =
    activeDragId !== null
      ? exercises.find((e) => e.id === activeDragId) ?? null
      : null

  // row id → exercise name, for the library panel's insert banner label.
  const exerciseNameById = useMemo(
    () => new Map(exercises.map((e) => [e.id, e.exercise_name] as const)),
    [exercises],
  )

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 28,
        alignItems: 'start',
      }}
    >
      <div>
        {exercises.length === 0 ? (
          <EmptyState onBrowse={browseFromEmptyState} />
        ) : (
          <DndContext
            id="day-content-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={exercises.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              <DayExerciseList
                exercises={exercises}
                actions={actions}
                insertSlot={insertSlot}
                setInsertSlot={setInsertSlot}
                focusLibrarySearch={focusLibrarySearch}
                sectionTitles={sectionTitles}
                metricUnits={metricUnits}
              />
            </SortableContext>
            <DragOverlay>
              {activeDragEx ? (
                <DraggedCardGhost name={activeDragEx.exercise_name} />
              ) : null}
            </DragOverlay>
          </DndContext>
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
        {panelFlashKey > 0 && (
          <span
            key={panelFlashKey}
            aria-hidden
            style={{
              position: 'sticky',
              top: 0,
              left: 0,
              right: 0,
              display: 'block',
              height: 0,
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: '-2px -2px auto -2px',
                height: 'calc(100vh - 36px)',
                border: '2px solid var(--color-accent)',
                borderRadius: 'var(--radius-card)',
                opacity: 0,
                animation:
                  'panel-flash 1000ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
              }}
            />
          </span>
        )}
        <DayLibraryPanel
          options={library}
          insertSlot={insertSlot}
          setInsertSlot={setInsertSlot}
          exerciseNameById={exerciseNameById}
          movementPatterns={movementPatterns}
          exerciseTags={exerciseTags}
          onAdd={actions.addExercise}
        />
      </aside>
    </div>
  )
}

function EmptyState({ onBrowse }: { onBrowse: () => void }) {
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
          margin: '0 auto 16px',
          maxWidth: 360,
        }}
      >
        Pick exercises from the Library panel on the right. Defaults are copied
        in; you can tweak them per exercise inline.
      </p>
      <button
        type="button"
        onClick={onBrowse}
        className="btn outline"
        style={{ padding: '8px 16px', fontSize: '.84rem' }}
      >
        <Search size={14} aria-hidden />
        Browse the library
      </button>
    </div>
  )
}

/* ====================== Left column: grouped exercise list ====================== */

/**
 * Walks the ordered list once and emits an alternating sequence of
 * between-cards bars and cards (solo or superset blocks), with section
 * strips at section boundaries. Identical sequencing logic to the session
 * builder's ExerciseList — letters, contiguous-group collection, and the
 * defensive group key for legacy non-contiguous data.
 */
function DayExerciseList({
  exercises,
  actions,
  insertSlot,
  setInsertSlot,
  focusLibrarySearch,
  sectionTitles,
  metricUnits,
}: {
  exercises: DayEditorExercise[]
  actions: DayEditorActions
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  focusLibrarySearch: () => void
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
}) {
  const nodes: React.ReactNode[] = []
  let lastSection: string | null | undefined = undefined

  const groupCounts = new Map<string, number>()
  for (const ex of exercises) {
    if (ex.superset_group_id) {
      groupCounts.set(
        ex.superset_group_id,
        (groupCounts.get(ex.superset_group_id) ?? 0) + 1,
      )
    }
  }

  nodes.push(
    <BetweenCardsBar
      key="bar-top"
      beforeId={null}
      beforeGroupId={null}
      afterId={exercises[0]!.id}
      afterGroupId={exercises[0]!.superset_group_id}
      actions={actions}
      insertSlot={insertSlot}
      setInsertSlot={setInsertSlot}
      focusLibrarySearch={focusLibrarySearch}
    />,
  )

  let groupLetterIndex = -1
  let i = 0
  while (i < exercises.length) {
    const ex = exercises[i]!
    const section = ex.section_title?.trim() || null
    if (section && section !== lastSection) {
      nodes.push(<SectionStrip key={`sec-${i}`}>{section}</SectionStrip>)
    }
    lastSection = section ?? null

    const groupId = ex.superset_group_id
    const memberCount = groupId ? (groupCounts.get(groupId) ?? 1) : 1
    groupLetterIndex += 1
    const baseLetter = String.fromCharCode(65 + groupLetterIndex)

    if (groupId && memberCount > 1) {
      const members: DayEditorExercise[] = []
      let j = i
      while (
        j < exercises.length &&
        exercises[j]!.superset_group_id === groupId
      ) {
        members.push(exercises[j]!)
        j += 1
      }

      const isFirstOverall = i === 0
      const isLastOverall = j === exercises.length

      nodes.push(
        <SupersetBlock
          key={`grp-${groupId}-${i}`}
          baseLetter={baseLetter}
          members={members}
          actions={actions}
          insertSlot={insertSlot}
          setInsertSlot={setInsertSlot}
          focusLibrarySearch={focusLibrarySearch}
          isFirstOverall={isFirstOverall}
          isLastOverall={isLastOverall}
          sectionTitles={sectionTitles}
          metricUnits={metricUnits}
        />,
      )
      i = j
    } else {
      const isFirstOverall = i === 0
      const isLastOverall = i === exercises.length - 1
      nodes.push(
        <SoloExercise
          key={ex.id}
          exercise={ex}
          letter={baseLetter}
          actions={actions}
          isFirst={isFirstOverall}
          isLast={isLastOverall}
          sectionTitles={sectionTitles}
          metricUnits={metricUnits}
        />,
      )
      i += 1
    }

    if (i < exercises.length) {
      const before = exercises[i - 1]!
      const after = exercises[i]!
      nodes.push(
        <BetweenCardsBar
          key={`bar-${before.id}-${after.id}`}
          beforeId={before.id}
          beforeGroupId={before.superset_group_id}
          afterId={after.id}
          afterGroupId={after.superset_group_id}
          actions={actions}
          insertSlot={insertSlot}
          setInsertSlot={setInsertSlot}
          focusLibrarySearch={focusLibrarySearch}
        />,
      )
    }
  }

  const last = exercises[exercises.length - 1]!
  nodes.push(
    <BetweenCardsBar
      key="bar-bottom"
      beforeId={last.id}
      beforeGroupId={last.superset_group_id}
      afterId={null}
      afterGroupId={null}
      actions={actions}
      insertSlot={insertSlot}
      setInsertSlot={setInsertSlot}
      focusLibrarySearch={focusLibrarySearch}
    />,
  )

  return <>{nodes}</>
}

function SectionStrip({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '22px 0 10px',
        paddingLeft: 2,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--color-text-faint)',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-light)',
        }}
      >
        {children}
      </span>
    </div>
  )
}

function SoloPill({ letter }: { letter: string }) {
  return (
    <div
      style={{
        width: 34,
        minHeight: 34,
        background: 'var(--color-slate)',
        color: GREEN,
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: '.02em',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 18,
        alignSelf: 'center',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {letter}
    </div>
  )
}

function SoloExercise({
  exercise,
  letter,
  actions,
  isFirst,
  isLast,
  sectionTitles,
  metricUnits,
}: {
  exercise: DayEditorExercise
  letter: string
  actions: DayEditorActions
  isFirst: boolean
  isLast: boolean
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
      <SoloPill letter={letter} />
      <SortableCardShell id={exercise.id} layoutStyle={{ flex: 1 }}>
        <DayExerciseBody
          exercise={exercise}
          actions={actions}
          isFirst={isFirst}
          isLast={isLast}
          sectionTitles={sectionTitles}
          metricUnits={metricUnits}
        />
      </SortableCardShell>
    </div>
  )
}

function SupersetBlock({
  baseLetter,
  members,
  actions,
  insertSlot,
  setInsertSlot,
  focusLibrarySearch,
  isFirstOverall,
  isLastOverall,
  sectionTitles,
  metricUnits,
}: {
  baseLetter: string
  members: DayEditorExercise[]
  actions: DayEditorActions
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  focusLibrarySearch: () => void
  isFirstOverall: boolean
  isLastOverall: boolean
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
}) {
  const groupId = members[0]!.superset_group_id!

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '34px 1fr',
        columnGap: 10,
        position: 'relative',
      }}
    >
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
      {members.map((ex, idx) => {
        const cardRow = idx * 2 + 1
        const barRow = idx * 2 + 2
        return (
          <React.Fragment key={ex.id}>
            <div
              style={{
                gridColumn: 1,
                gridRow: cardRow,
                display: 'grid',
                placeItems: 'center',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <SpineLetter>{`${baseLetter}${idx + 1}`}</SpineLetter>
            </div>
            <SortableCardShell
              id={ex.id}
              layoutStyle={{
                gridColumn: 2,
                gridRow: cardRow,
                position: 'relative',
                zIndex: 1,
              }}
            >
              <DayExerciseBody
                exercise={ex}
                actions={actions}
                isFirst={isFirstOverall && idx === 0}
                isLast={isLastOverall && idx === members.length - 1}
                sectionTitles={sectionTitles}
                metricUnits={metricUnits}
              />
            </SortableCardShell>
            {idx < members.length - 1 && (
              <>
                <div
                  style={{
                    gridColumn: 1,
                    gridRow: barRow,
                    display: 'grid',
                    placeItems: 'center',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <span style={{ color: GREEN, fontSize: 16, lineHeight: 1 }}>
                    −
                  </span>
                </div>
                <div
                  style={{
                    gridColumn: 2,
                    gridRow: barRow,
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  <BetweenCardsBar
                    beforeId={ex.id}
                    beforeGroupId={groupId}
                    afterId={members[idx + 1]!.id}
                    afterGroupId={groupId}
                    actions={actions}
                    insertSlot={insertSlot}
                    setInsertSlot={setInsertSlot}
                    focusLibrarySearch={focusLibrarySearch}
                  />
                </div>
              </>
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/* ====================== Card body (left + right grid) ====================== */

function DayExerciseBody({
  exercise,
  actions,
  isFirst,
  isLast,
  sectionTitles,
  metricUnits,
}: {
  exercise: DayEditorExercise
  actions: DayEditorActions
  isFirst: boolean
  isLast: boolean
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
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
      const res = await run(actions.removeExercise(exercise.id))
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
      const res = await run(actions.moveExercise(exercise.id, direction))
      if (res.error) {
        notify(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleUngroup() {
    startTransition(async () => {
      const res = await run(actions.ungroup(exercise.id))
      if (res.error) {
        notify(res.error)
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
      {/* LEFT: name, section, instructions, demo video */}
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
          {exercise.superset_group_id && (
            <IconButton
              disabled={pending}
              onClick={handleUngroup}
              label="Remove from superset"
            >
              <Unlink size={14} aria-hidden />
            </IconButton>
          )}
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

        <SectionTitleField
          initialValue={exercise.section_title ?? ''}
          options={sectionTitles}
          onApply={(next) => actions.updateSectionTitle(exercise.id, next)}
          onAddSection={actions.addSectionTitle}
        />

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
                actions.updateExercise(exercise.id, { instructions: next })
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

      {/* RIGHT: set table + stepper + extras — kit atoms wired to the
          consumer's actions. */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <SetTable
          sets={exercise.sets}
          metricUnits={metricUnits}
          onRepsCommit={(setId, next) =>
            actions.updateSet(setId, { reps: next })
          }
          onValueCommit={(setId, next) =>
            actions.updateSet(setId, { optional_value: next })
          }
          onRepMetricCommit={(next) =>
            actions.updateRepMetric(exercise.id, next)
          }
          onMetricCommit={(next) => actions.updateMetric(exercise.id, next)}
        />
        <SetStepper
          count={exercise.sets.length}
          onAdd={() => actions.addSet(exercise.id)}
          onRemove={() => {
            const last = exercise.sets[exercise.sets.length - 1]
            return last
              ? actions.removeSet(last.id)
              : Promise.resolve({ error: null })
          }}
        />
        <ExtrasRow
          restSeconds={exercise.rest_seconds}
          tempo={exercise.tempo}
          onRestCommit={(next) =>
            actions.updateExercise(exercise.id, { rest_seconds: next })
          }
          onTempoCommit={(next) =>
            actions.updateExercise(exercise.id, { tempo: next })
          }
        />
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove exercise?"
          body={
            <>
              <strong>{exercise.exercise_name}</strong> will be removed from
              this day, along with its sets.
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

/* ====================== Between-cards bar ====================== */

function BetweenCardsBar({
  beforeId,
  beforeGroupId,
  afterId,
  afterGroupId,
  actions,
  insertSlot,
  setInsertSlot,
  focusLibrarySearch,
}: {
  beforeId: string | null
  beforeGroupId: string | null
  afterId: string | null
  afterGroupId: string | null
  actions: DayEditorActions
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  focusLibrarySearch: () => void
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()

  const isTop = beforeId === null
  const isBottom = afterId === null
  const isBetween = !isTop && !isBottom

  // Same group ⇒ already supersetted ⇒ the Superset button is meaningless.
  const sameGroup =
    isBetween && beforeGroupId !== null && beforeGroupId === afterGroupId
  const showSuperset = isBetween && !sameGroup

  const isActiveSlot =
    (isTop && insertSlot?.kind === 'atStart') ||
    (isBetween &&
      insertSlot?.kind === 'after' &&
      insertSlot.afterId === beforeId)

  function handleAddExercise() {
    if (isTop) setInsertSlot({ kind: 'atStart' })
    else if (isBottom) setInsertSlot(null) // bottom = append at end
    else setInsertSlot({ kind: 'after', afterId: beforeId! })
    focusLibrarySearch()
  }

  function handleSuperset() {
    if (!isBetween || sameGroup) return
    startTransition(async () => {
      const res = await run(actions.groupAcross(beforeId!, afterId!))
      if (res.error) {
        notify(res.error)
        return
      }
      router.refresh()
    })
  }

  const addLabel = isTop
    ? 'Insert at top'
    : isBottom
      ? 'Add exercise at end'
      : 'Insert exercise here'

  return (
    <div style={{ position: 'relative', height: 22, margin: '4px 0' }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: '50%',
          height: 1,
          background: BORDER,
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {showSuperset && (
          <BarButton
            onClick={handleSuperset}
            disabled={pending}
            label="Superset"
          >
            <Link2 size={12} aria-hidden />
          </BarButton>
        )}
        <BarButton
          onClick={handleAddExercise}
          disabled={pending}
          label={addLabel}
          active={isActiveSlot}
        >
          <Plus size={12} aria-hidden />
        </BarButton>
      </div>
    </div>
  )
}

function BarButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 22,
        height: 22,
        background: active ? 'var(--color-slate)' : 'var(--color-card)',
        color: active ? '#fff' : disabled ? FAINT : MUTED,
        border: `1px solid ${active ? 'var(--color-slate)' : BORDER}`,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        transition: 'background 150ms, color 150ms, border-color 150ms',
      }}
    >
      {children}
    </button>
  )
}

/* ====================== Section title ====================== */

/**
 * Section title for a card. Free text on the column (the dropdown is a UI
 * helper, not an FK), so legacy ad-hoc values still render. Two modes:
 * select (native dropdown + "+ Add new section…" sentinel) and creating
 * (inline text input). The apply/add are injected so the storage table
 * (session vs. template) is the consumer's concern; the consumer's apply is
 * expected to fan a grouped card's section out to its superset siblings.
 */
function SectionTitleField({
  initialValue,
  options,
  onApply,
  onAddSection,
}: {
  initialValue: string
  options: SectionTitleOption[]
  onApply: (next: string | null) => Promise<SaveResult>
  onAddSection: (
    name: string,
  ) => Promise<{ data: { id: string; name: string } | null; error: string | null }>
}) {
  const [value, setValue] = useState(initialValue)
  const [mode, setMode] = useState<'select' | 'creating'>('select')
  const [draft, setDraft] = useState('')
  const [, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()

  // Sync when the server pushes a new initialValue (a superset sibling adopting
  // a section via the fan-out). Skip mid-create so the draft survives.
  useEffect(() => {
    if (mode === 'creating') return
    setValue(initialValue)
  }, [initialValue, mode])

  const valueInOptions = value !== '' && options.some((o) => o.name === value)

  function applyValue(next: string) {
    setValue(next)
    startTransition(async () => {
      const res = await run(onApply(next === '' ? null : next))
      if (res.error) {
        notify(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value
    if (v === '__add__') {
      setDraft('')
      setMode('creating')
      return
    }
    if (v === value) return
    applyValue(v)
  }

  function commitDraft() {
    const name = draft.trim()
    if (!name) {
      setMode('select')
      return
    }
    setMode('select')
    setValue(name)
    startTransition(async () => {
      // Add to the org's list AND apply to this card in parallel. Duplicate
      // on add is soft-failed (the section already exists ⇒ intent satisfied).
      const [addRes, applyRes] = await Promise.all([
        onAddSection(name),
        run(onApply(name)),
      ])
      if (
        addRes.error &&
        !addRes.error.toLowerCase().includes('already exists')
      ) {
        notify(addRes.error)
      }
      if (applyRes.error) {
        notify(applyRes.error)
        return
      }
      router.refresh()
    })
  }

  if (mode === 'creating') {
    return (
      <input
        autoFocus
        type="text"
        value={draft}
        placeholder="New section name"
        maxLength={60}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setDraft('')
            setMode('select')
          }
        }}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px dashed ${BORDER}`,
          padding: '4px 0',
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: MUTED,
          outline: 'none',
          marginBottom: 12,
        }}
      />
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        marginBottom: 12,
      }}
    >
      <select
        value={value}
        onChange={handleSelectChange}
        aria-label="Section"
        style={{
          flex: 1,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          borderBottom: `1px dashed ${BORDER}`,
          padding: '4px 0',
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: value ? MUTED : FAINT,
          outline: 'none',
          appearance: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="">— Section —</option>
        {!valueInOptions && value !== '' && <option value={value}>{value}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
          </option>
        ))}
        <option value="__add__">+ Add new section…</option>
      </select>
      {value !== '' && (
        <button
          type="button"
          aria-label="Clear section title"
          title="Clear section title"
          onClick={() => applyValue('')}
          style={{
            width: 16,
            height: 16,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-alert)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            flexShrink: 0,
          }}
        >
          <X size={11} aria-hidden />
        </button>
      )}
    </div>
  )
}

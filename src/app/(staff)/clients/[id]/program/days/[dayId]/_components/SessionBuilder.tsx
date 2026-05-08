'use client'

import React, { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  GripVertical,
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  addExerciseToDayAction,
  addProgramExerciseSetAction,
  addSectionTitleAction,
  groupAcrossActionBarAction,
  moveProgramExerciseAction,
  removeProgramExerciseAction,
  removeProgramExerciseSetAction,
  reorderProgramExercisesAction,
  swapProgramExerciseAction,
  ungroupFromSupersetAction,
  updateProgramExerciseAction,
  updateProgramExerciseMetricAction,
  updateProgramExerciseSetAction,
  updateSectionTitleAction,
  type InsertSlot,
  type ProgramExercisePatch,
  type ProgramExerciseSetPatch,
} from '../actions'
import {
  NotesPanel,
  type ClinicalNoteSummary,
} from '../../../../_components/NotesPanel'
import {
  ReportsPanel,
  type SessionReport,
} from '../../../../_components/ReportsPanel'
import type { ClientTestHistory } from '@/lib/testing/loader-types'
import { timeAgo } from '../../../../_components/reports/helpers'

/*
 * Session Builder — light/cream skeleton.
 *
 * Cards are white on warm parchment. The sequencing pill / superset spine
 * uses slate (var(--color-slate)) — a notch lighter than charcoal so it
 * reads as structural without going harsh. Green accent letters (B1, B2…)
 * run down the spine for supersets. All colours reference design-system
 * tokens (defined in globals.css); the named constants below are aliases,
 * not raw hex.
 */
const INK = 'var(--color-primary)'
const CREAM = 'var(--color-surface)'
const CREAM_DEEP = 'var(--color-surface-2)'
const BORDER = 'var(--color-border-hairline)'
const MUTED = 'var(--color-muted)'
const FAINT = 'var(--color-text-faint)'
const GREEN = 'var(--color-accent)'

/* ====================== Drag-and-drop plumbing ====================== */

/**
 * Phase G — drag-and-drop reorder via @dnd-kit.
 *
 * The grip handle inside ExerciseBody is the drag activator. It lives a
 * few JSX layers below the white card div that owns the useSortable
 * lifecycle (setNodeRef, transform). React Context bridges the two:
 * SortableCardShell publishes the drag-handle props; <DragHandle /> deep
 * inside the card consumes them and spreads them onto the grip button.
 *
 * Alternative considered: render-prop / cloneElement to inject
 * dragHandleProps. Rejected because ExerciseBody is far enough below
 * SortableCardShell that prop-drilling pollutes three intermediate
 * component signatures with no other use for the props.
 */
type DragHandleApi = {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
  setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef']
}

const DragHandleContext = React.createContext<DragHandleApi | null>(null)

export type PrescriptionSet = {
  id: string
  set_number: number
  reps: string | null
  optional_metric: string | null
  optional_value: string | null
}

/**
 * Phase H (2026-05-08): "Last logged" footer source data. The page loader
 * looks up the most recent completed exercise_log for this client +
 * exercise_id and passes its set_logs along. We keep the raw per-set
 * shape (weight + metric + reps) here so the renderer can decide
 * uniform-vs-range and bodyweight-vs-load purely on what was performed.
 */
export type LastLoggedSet = {
  weightValue: number | null
  weightMetric: string | null
  repsPerformed: number | null
}

export type LastLogged = {
  completedAt: string
  sets: LastLoggedSet[]
}

export type ProgramExercise = {
  id: string
  sort_order: number
  section_title: string | null
  superset_group_id: string | null
  rest_seconds: number | null
  tempo: string | null
  instructions: string | null
  exercise_id: string
  exercise_name: string
  exercise_video_url: string | null
  prescriptionSets: PrescriptionSet[]
  lastLogged: LastLogged | null
}

export type LibraryPick = {
  id: string
  name: string
  movement_pattern_id: string | null
  movement_pattern_name: string | null
  tag_ids: string[]
}

/**
 * Lookup options sourced from the org's tenant-configurable tables. All
 * are loaded by the page.tsx Promise.all and passed in via props.
 *
 * Phase E (2026-05-07) — section_titles drives SectionTitleField,
 * movement_patterns + exercise_tags drive LibraryPanel chip filters.
 *
 * Phase F (2026-05-07) — exercise_metric_units drives the SetMetricCell
 * dropdown for the Load/Notes column. Same source the new-exercise form
 * uses (library/new/page.tsx). `code` is the stable machine identifier
 * stored in program_exercise_sets.optional_metric; `display_label` is
 * what the EP sees in the dropdown and in the read-only display.
 */
export type SectionTitleOption = { id: string; name: string }
export type MovementPatternOption = { id: string; name: string }
export type ExerciseTagOption = { id: string; name: string }
export type MetricUnitOption = { code: string; display_label: string }

interface SessionBuilderProps {
  clientId: string
  dayId: string
  programExercises: ProgramExercise[]
  libraryOptions: LibraryPick[]
  clinicalNotes: ClinicalNoteSummary[]
  reports: SessionReport[]
  testHistory: ClientTestHistory
  sectionTitles: SectionTitleOption[]
  movementPatterns: MovementPatternOption[]
  exerciseTags: ExerciseTagOption[]
  metricUnits: MetricUnitOption[]
}

export function SessionBuilder({
  clientId,
  dayId,
  programExercises,
  libraryOptions,
  clinicalNotes,
  reports,
  testHistory,
  sectionTitles,
  movementPatterns,
  exerciseTags,
  metricUnits,
}: SessionBuilderProps) {
  const router = useRouter()
  const [tab, setTab] = useState<'notes' | 'reports' | 'library'>('library')

  // Phase D: an insertion slot can be armed by a between-cards bar's
  // "+ Add exercise" click. The next library-pick consumes the slot. Cleared
  // by the LibraryPanel's Cancel button or after a successful add.
  const [insertSlot, setInsertSlotState] = useState<InsertSlot | null>(null)

  // Phase F: a swap target can be armed by clicking an exercise name. The
  // next library-pick consumes the swap target via swapProgramExerciseAction.
  // Mutually exclusive with insertSlot — arming one clears the other so the
  // EP only ever has one armed library action at a time.
  const [swapTarget, setSwapTargetState] = useState<string | null>(null)

  function setInsertSlot(slot: InsertSlot | null) {
    setInsertSlotState(slot)
    if (slot !== null) setSwapTargetState(null)
  }

  function setSwapTarget(peId: string | null) {
    setSwapTargetState(peId)
    if (peId !== null) setInsertSlotState(null)
  }

  // Phase G: id of the card currently being dragged. Drives the
  // DragOverlay ghost render. null means no drag in progress.
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [, startReorderTransition] = useTransition()

  // Phase G: three sensors so reorder works for mouse, touch, and keyboard.
  // PointerSensor — primary desktop input; the small distance threshold lets
  //   the user click the grip without instantly starting a drag.
  // TouchSensor — tablets in the gym; the delay+tolerance pair lets a
  //   tap-then-drag start cleanly without hijacking scrolls.
  // KeyboardSensor — a11y fallback; sortableKeyboardCoordinates is the
  //   stock vertical-list coordinate getter from @dnd-kit/sortable.
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

    const oldIndex = programExercises.findIndex((e) => e.id === active.id)
    const newIndex = programExercises.findIndex((e) => e.id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

    const reordered = arrayMove(programExercises, oldIndex, newIndex)
    const orderedIds = reordered.map((e) => e.id)
    const movedPeId = active.id as string

    startReorderTransition(async () => {
      const res = await reorderProgramExercisesAction(
        clientId,
        dayId,
        orderedIds,
        movedPeId,
      )
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  // Phase I §2.12: bumped by the empty-state "Browse the library" button.
  // The right-panel overlay re-keys, the panel-flash keyframe runs once.
  // Stays at 0 unless the EP triggers it; never auto-fires.
  const [panelFlashKey, setPanelFlashKey] = useState(0)

  // When a bar arms a slot, the user expects the library panel to be
  // ready for them. Force the right-panel tab to library + focus the search
  // input. focusLibrarySearch's DOM query relies on aria-label so it
  // survives wrapper changes.
  function focusLibrarySearch() {
    setTab('library')
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        'input[aria-label="Search exercises"]',
      )
      el?.focus()
    })
  }

  const activeDragPe =
    activeDragId !== null
      ? programExercises.find((e) => e.id === activeDragId) ?? null
      : null

  function handleSwapClick(peId: string) {
    // Click again on the same name = cancel (toggle). Click a different
    // name = re-arm (latest wins). Same toggle pattern as insertSlot.
    setSwapTarget(swapTarget === peId ? null : peId)
    if (swapTarget !== peId) focusLibrarySearch()
  }

  // Phase I §2.12 — empty-state "Browse the library" handler.
  // Switches to the library tab + focuses the search input + bumps the
  // panel-flash counter so the right-panel border pulses once.
  function browseFromEmptyState() {
    focusLibrarySearch()
    setPanelFlashKey((n) => n + 1)
  }

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
        {programExercises.length === 0 ? (
          <EmptyState onBrowse={browseFromEmptyState} />
        ) : (
          <DndContext
            // Stable id so DndContext's accessibility-announcement element
            // gets a deterministic aria-describedby across SSR + client
            // hydration. Without this, @dnd-kit's internal counter starts
            // at different points on the two passes and React fires a
            // hydration mismatch on every DragHandle button.
            id="session-builder-dnd"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={programExercises.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              <ExerciseList
                exercises={programExercises}
                clientId={clientId}
                dayId={dayId}
                insertSlot={insertSlot}
                setInsertSlot={setInsertSlot}
                focusLibrarySearch={focusLibrarySearch}
                sectionTitles={sectionTitles}
                metricUnits={metricUnits}
                swapTarget={swapTarget}
                onSwapClick={handleSwapClick}
              />
            </SortableContext>
            <DragOverlay>
              {activeDragPe ? <DraggedCardGhost pe={activeDragPe} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/*
        Phase I §2.15: panel always fills the visible area to the right of
        the exercise list — sticky-pinned at top: 20, height locked to
        100vh-40px, content scrolls inside. Long Notes / Reports / Library
        scroll within the panel; the page scroll only moves the exercise
        list. Without this, scrolling past the panel's natural height
        floated Library/Notes/Reports off-screen and lost the load-bearing
        right-panel adjacency.

        position: relative is added so the §2.12 panel-flash overlay can
        be absolutely positioned against this aside (re-keyed by
        panelFlashKey when the empty-state CTA fires).
      */}
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
                animation: 'panel-flash 1000ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
              }}
            />
          </span>
        )}
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: CREAM_DEEP,
            padding: 3,
            borderRadius: 'var(--radius-input)',
            marginBottom: 14,
          }}
        >
          {(['notes', 'reports', 'library'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              style={{
                flex: 1,
                padding: '7px 10px',
                border: 'none',
                borderRadius: 5,
                fontSize: '.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: tab === k ? '#fff' : 'transparent',
                color: tab === k ? INK : MUTED,
                boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
                textTransform: 'capitalize',
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {tab === 'library' && (
          <LibraryPanel
            options={libraryOptions}
            clientId={clientId}
            dayId={dayId}
            insertSlot={insertSlot}
            setInsertSlot={setInsertSlot}
            programExercises={programExercises}
            movementPatterns={movementPatterns}
            exerciseTags={exerciseTags}
            swapTarget={swapTarget}
            setSwapTarget={setSwapTarget}
          />
        )}
        {tab === 'notes' && <NotesPanel notes={clinicalNotes} />}
        {tab === 'reports' && (
          <ReportsPanel reports={reports} history={testHistory} />
        )}
      </aside>
    </div>
  )
}

function EmptyState({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div
      style={{
        background: '#fff',
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
        Pick exercises from the Library panel on the right. Defaults are
        copied in; you can tweak them per exercise inline.
      </p>
      {/*
        Phase I §2.12: explicit affordance into the right-panel library.
        Reuses focusLibrarySearch (already used by between-cards "+ Add
        exercise") so the search input is focused on first click; the panel
        border pulses once via the panel-flash keyframe so the EP's eye
        snaps to where the next action lives.
      */}
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
 * BetweenCardsBar slots and exercise cards (or superset blocks):
 *
 *   [top bar] [card A] [bar] [card B] [bar] [group(C1, [in-group bar], C2)]
 *   [bar] [card D] [bottom bar]
 *
 * Standalone exercises render as a solo card with a single floating slate
 * pill (A, B…). A group of 2+ contiguous same-group exercises renders as
 * one SupersetBlock with a continuous slate spine carrying B1, B2… letters
 * down its length, and bars between members inside the group (in-group
 * bars carry only the "+ Add exercise" affordance — supersetting members
 * already grouped is a no-op).
 *
 * Phase D (2026-05-07): replaces the prior renderGroupedExercises function
 * which emitted only cards; bars used to live as CardActions below each
 * card and groups-with-above-only.
 */
function ExerciseList({
  exercises,
  clientId,
  dayId,
  insertSlot,
  setInsertSlot,
  focusLibrarySearch,
  sectionTitles,
  metricUnits,
  swapTarget,
  onSwapClick,
}: {
  exercises: ProgramExercise[]
  clientId: string
  dayId: string
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  focusLibrarySearch: () => void
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
  swapTarget: string | null
  onSwapClick: (peId: string) => void
}) {
  const nodes: React.ReactNode[] = []
  let lastSection: string | null | undefined = undefined

  // Letter assignment + group counts (existing logic, preserved verbatim).
  const groupCounts = new Map<string, number>()
  for (const pe of exercises) {
    if (pe.superset_group_id) {
      groupCounts.set(
        pe.superset_group_id,
        (groupCounts.get(pe.superset_group_id) ?? 0) + 1,
      )
    }
  }

  // Top bar (kind='top'): "+ Add exercise" arms an atStart slot. No Superset.
  nodes.push(
    <BetweenCardsBar
      key="bar-top"
      beforePeId={null}
      beforeGroupId={null}
      afterPeId={exercises[0]!.id}
      afterGroupId={exercises[0]!.superset_group_id}
      clientId={clientId}
      dayId={dayId}
      insertSlot={insertSlot}
      setInsertSlot={setInsertSlot}
      focusLibrarySearch={focusLibrarySearch}
    />,
  )

  let groupLetterIndex = -1
  let i = 0
  while (i < exercises.length) {
    const pe = exercises[i]!
    const section = pe.section_title?.trim() || null
    if (section && section !== lastSection) {
      nodes.push(<SectionStrip key={`sec-${i}`}>{section}</SectionStrip>)
    }
    lastSection = section ?? null

    const groupId = pe.superset_group_id
    const memberCount = groupId ? (groupCounts.get(groupId) ?? 1) : 1
    groupLetterIndex += 1
    const baseLetter = String.fromCharCode(65 + groupLetterIndex)

    if (groupId && memberCount > 1) {
      // Collect contiguous group members.
      const members: ProgramExercise[] = []
      let j = i
      while (j < exercises.length && exercises[j]!.superset_group_id === groupId) {
        members.push(exercises[j]!)
        j += 1
      }

      const isFirstOverall = i === 0
      const isLastOverall = j === exercises.length

      // Defensive key: include the index of the first member so a
      // non-contiguous group (legacy data from before the Phase G arrow
      // hot-fix routed moves through reorder_program_exercises) renders
      // as two visually separate blocks rather than crashing on a
      // duplicate React key. The next reorder via arrow or DnD will
      // normalise the data via singleton cleanup + group re-derivation.
      nodes.push(
        <SupersetBlock
          key={`grp-${groupId}-${i}`}
          baseLetter={baseLetter}
          members={members}
          clientId={clientId}
          dayId={dayId}
          insertSlot={insertSlot}
          setInsertSlot={setInsertSlot}
          focusLibrarySearch={focusLibrarySearch}
          isFirstOverall={isFirstOverall}
          isLastOverall={isLastOverall}
          sectionTitles={sectionTitles}
          metricUnits={metricUnits}
          swapTarget={swapTarget}
          onSwapClick={onSwapClick}
        />,
      )
      i = j
    } else {
      const isFirstOverall = i === 0
      const isLastOverall = i === exercises.length - 1
      nodes.push(
        <SoloExercise
          key={pe.id}
          pe={pe}
          letter={baseLetter}
          clientId={clientId}
          dayId={dayId}
          isFirst={isFirstOverall}
          isLast={isLastOverall}
          sectionTitles={sectionTitles}
          metricUnits={metricUnits}
          swapTarget={swapTarget}
          onSwapClick={onSwapClick}
        />,
      )
      i += 1
    }

    // Between-cards bar after every card/group except the last. The
    // before/after groupIds let the bar decide whether to show the
    // "Superset" affordance (hidden when both share a group_id).
    if (i < exercises.length) {
      const before = exercises[i - 1]!
      const after = exercises[i]!
      nodes.push(
        <BetweenCardsBar
          key={`bar-${before.id}-${after.id}`}
          beforePeId={before.id}
          beforeGroupId={before.superset_group_id}
          afterPeId={after.id}
          afterGroupId={after.superset_group_id}
          clientId={clientId}
          dayId={dayId}
          insertSlot={insertSlot}
          setInsertSlot={setInsertSlot}
          focusLibrarySearch={focusLibrarySearch}
        />,
      )
    }
  }

  // Bottom bar (kind='bottom'): "+ Add exercise" clears the slot (today's
  // append behaviour). No Superset.
  const last = exercises[exercises.length - 1]!
  nodes.push(
    <BetweenCardsBar
      key="bar-bottom"
      beforePeId={last.id}
      beforeGroupId={last.superset_group_id}
      afterPeId={null}
      afterGroupId={null}
      clientId={clientId}
      dayId={dayId}
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

/* ====================== Sequencing pills ====================== */

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

/**
 * Letter that sits in the spine column, aligned with a single card's row.
 * Phase D layout: lifted out of the previous SupersetSpine flex
 * distribution because in-group bars in the right column push the spine
 * letters out of vertical alignment with their cards. Letters now live
 * in their own grid cells in SupersetBlock; this is the rendered glyph.
 */
function SpineLetter({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: 12,
        color: GREEN,
      }}
    >
      {children}
    </span>
  )
}

/* ====================== Sortable card shell + drag handle ====================== */

/**
 * Wraps the white-card div with @dnd-kit's useSortable. Used by both
 * SoloExercise (flex layout) and SupersetBlock members (grid layout) — the
 * caller passes the layout-specific style via `layoutStyle` and the shell
 * merges it with the always-on card chrome (white bg, hairline border,
 * 12px radius).
 *
 * Publishes the drag-handle props via DragHandleContext so the
 * <DragHandle /> deep inside ExerciseBody can pick them up without prop
 * drilling.
 *
 * Phase G — drag-and-drop reorder. /docs/polish/session-builder.md §4 row G.
 */
function SortableCardShell({
  pe,
  layoutStyle,
  children,
}: {
  pe: ProgramExercise
  layoutStyle?: React.CSSProperties
  children: React.ReactNode
}) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
    setActivatorNodeRef,
  } = useSortable({ id: pe.id })

  const handle = useMemo<DragHandleApi>(
    () => ({ attributes, listeners, setActivatorNodeRef }),
    [attributes, listeners, setActivatorNodeRef],
  )

  // The dragged card itself fades to a stub while the DragOverlay ghost
  // tracks the cursor. Non-dragged cards still receive transform/transition
  // so they slide out of the way.
  return (
    <DragHandleContext.Provider value={handle}>
      <div
        ref={setNodeRef}
        style={{
          background: '#fff',
          borderRadius: 12,
          border: `1px solid ${BORDER}`,
          display: 'flex',
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.35 : 1,
          ...layoutStyle,
        }}
      >
        {children}
      </div>
    </DragHandleContext.Provider>
  )
}

/**
 * The grip icon, now an active drag activator rather than a decorative
 * glyph. Reads useSortable's attributes/listeners from DragHandleContext
 * and spreads them onto a button so the affordance is keyboard- and
 * screen-reader-friendly.
 *
 * touchAction:'none' is load-bearing on touch devices — without it the
 * browser's native scroll/gesture handler races @dnd-kit's TouchSensor and
 * the drag never starts.
 */
function DragHandle() {
  const ctx = React.useContext(DragHandleContext)
  return (
    <button
      ref={ctx?.setActivatorNodeRef}
      type="button"
      aria-label="Drag to reorder"
      title="Drag to reorder"
      {...(ctx?.attributes ?? {})}
      {...(ctx?.listeners ?? {})}
      style={{
        background: 'transparent',
        border: 'none',
        color: FAINT,
        cursor: 'grab',
        padding: 4,
        marginLeft: 2,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 4,
        touchAction: 'none',
      }}
    >
      <GripVertical size={14} aria-hidden />
    </button>
  )
}

/**
 * The translucent floating card that follows the cursor while a drag is in
 * progress. Deliberately sparse — name + a "dragging" cue. The full card
 * (with set table, instructions, etc.) would be expensive to re-render on
 * every pointer-move and visually noisy.
 */
function DraggedCardGhost({ pe }: { pe: ProgramExercise }) {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
        cursor: 'grabbing',
        // Match the card width loosely; @dnd-kit will size the overlay to
        // the active node's box anyway, so this is a fallback only.
        minWidth: 240,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: 14,
          color: INK,
        }}
      >
        {pe.exercise_name}
      </div>
    </div>
  )
}

/* ====================== Solo exercise wrapper ====================== */

function SoloExercise({
  pe,
  letter,
  clientId,
  dayId,
  isFirst,
  isLast,
  sectionTitles,
  metricUnits,
  swapTarget,
  onSwapClick,
}: {
  pe: ProgramExercise
  letter: string
  clientId: string
  dayId: string
  isFirst: boolean
  isLast: boolean
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
  swapTarget: string | null
  onSwapClick: (peId: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
      <SoloPill letter={letter} />
      <SortableCardShell pe={pe} layoutStyle={{ flex: 1 }}>
        <ExerciseBody
          pe={pe}
          clientId={clientId}
          dayId={dayId}
          isFirst={isFirst}
          isLast={isLast}
          sectionTitles={sectionTitles}
          metricUnits={metricUnits}
          swapTarget={swapTarget}
          onSwapClick={onSwapClick}
        />
      </SortableCardShell>
    </div>
  )
}

/* ====================== Superset wrapper ====================== */

function SupersetBlock({
  baseLetter,
  members,
  clientId,
  dayId,
  insertSlot,
  setInsertSlot,
  focusLibrarySearch,
  isFirstOverall,
  isLastOverall,
  sectionTitles,
  metricUnits,
  swapTarget,
  onSwapClick,
}: {
  baseLetter: string
  members: ProgramExercise[]
  clientId: string
  dayId: string
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  focusLibrarySearch: () => void
  isFirstOverall: boolean
  isLastOverall: boolean
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
  swapTarget: string | null
  onSwapClick: (peId: string) => void
}) {
  // members[0]'s superset_group_id is non-null and equal across all members
  // by construction (the walker only enters this branch for memberCount > 1).
  const groupId = members[0]!.superset_group_id!

  // Phase D layout: CSS grid with paired rows so each letter sits on the
  // same row as its card. Pre-Phase-D the spine was a flex column with
  // its letters distributed evenly across the block height, which was
  // fine when the right column was just stacked cards but broke once
  // we interleaved bars between members — the bars added height the
  // spine didn't account for. Grid pins each letter to its card row,
  // and the bar rows between get the existing dash separator.
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '34px 1fr',
        columnGap: 10,
        position: 'relative',
      }}
    >
      {/* Continuous slate spine that sits behind every grid row in the
          left column. Absolute-positioned so it stretches the full block
          height regardless of the per-row content. */}
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
      {members.map((pe, idx) => {
        const cardRow = idx * 2 + 1
        const barRow = idx * 2 + 2
        return (
          <React.Fragment key={pe.id}>
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
              pe={pe}
              layoutStyle={{
                gridColumn: 2,
                gridRow: cardRow,
                position: 'relative',
                zIndex: 1,
              }}
            >
              <ExerciseBody
                pe={pe}
                clientId={clientId}
                dayId={dayId}
                isFirst={isFirstOverall && idx === 0}
                isLast={isLastOverall && idx === members.length - 1}
                sectionTitles={sectionTitles}
                metricUnits={metricUnits}
                swapTarget={swapTarget}
                onSwapClick={onSwapClick}
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
                  <span
                    style={{
                      color: GREEN,
                      fontSize: 16,
                      lineHeight: 1,
                    }}
                  >
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
                    beforePeId={pe.id}
                    beforeGroupId={groupId}
                    afterPeId={members[idx + 1]!.id}
                    afterGroupId={groupId}
                    clientId={clientId}
                    dayId={dayId}
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

function ExerciseBody({
  pe,
  clientId,
  dayId,
  isFirst,
  isLast,
  sectionTitles,
  metricUnits,
  swapTarget,
  onSwapClick,
}: {
  pe: ProgramExercise
  clientId: string
  dayId: string
  isFirst: boolean
  isLast: boolean
  sectionTitles: SectionTitleOption[]
  metricUnits: MetricUnitOption[]
  swapTarget: string | null
  onSwapClick: (peId: string) => void
}) {
  const isSwapping = swapTarget === pe.id
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Server actions invalidate the route cache via revalidatePath; the
  // client component still needs router.refresh() to actually re-fetch
  // and re-render the page with the new data.

  function handleRemove() {
    if (!confirm(`Remove ${pe.exercise_name} from this session?`)) return
    startTransition(async () => {
      const res = await removeProgramExerciseAction(clientId, dayId, pe.id)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleMove(direction: 'up' | 'down') {
    startTransition(async () => {
      const res = await moveProgramExerciseAction(clientId, dayId, pe.id, direction)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  // Phase D: per-card ungroup. Hidden when the card isn't in a group;
  // visible icon-button alongside the existing arrow/trash strip otherwise.
  // The action stays single-card-scoped (this card leaves its group; if
  // only one member remains, that member is also cleared — handled inside
  // ungroupFromSupersetAction).
  function handleUngroup() {
    startTransition(async () => {
      const res = await ungroupFromSupersetAction(clientId, dayId, pe.id)
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
          {/* Phase F: clickable name arms a swap-in-place. Click again on
              the same name = cancel; click a different name = re-arm.
              Renders as an underlined button when armed; hover-only
              underline at rest so the surface stays calm. */}
          <button
            type="button"
            onClick={() => onSwapClick(pe.id)}
            aria-label={`Swap ${pe.exercise_name}`}
            title={isSwapping ? 'Cancel swap' : 'Swap exercise'}
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 15,
              color: INK,
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              textDecoration: isSwapping ? 'underline' : 'none',
              textDecorationStyle: 'dashed',
              textDecorationColor: 'var(--color-slate)',
              textUnderlineOffset: 4,
            }}
            onMouseEnter={(e) => {
              if (!isSwapping)
                e.currentTarget.style.textDecoration = 'underline'
            }}
            onMouseLeave={(e) => {
              if (!isSwapping) e.currentTarget.style.textDecoration = 'none'
            }}
          >
            {pe.exercise_name}
          </button>
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
          {pe.superset_group_id && (
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
            onClick={handleRemove}
            label="Remove exercise"
          >
            <Trash2 size={14} aria-hidden />
          </IconButton>
          <DragHandle />
        </div>

        <SectionTitleField
          programExerciseId={pe.id}
          initialValue={pe.section_title ?? ''}
          options={sectionTitles}
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
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'flex-end',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <EditableTextarea
              programExerciseId={pe.id}
              field="instructions"
              initialValue={pe.instructions ?? ''}
              placeholder="Add a coaching cue…"
            />
          </div>
          {pe.exercise_video_url ? (
            <a
              href={pe.exercise_video_url}
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

      {/* RIGHT: set table + stepper */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <SetTable
          pe={pe}
          metricUnits={metricUnits}
          clientId={clientId}
          dayId={dayId}
        />
        <SetStepper pe={pe} clientId={clientId} dayId={dayId} />
        <ExtrasRow pe={pe} />
        <LastLoggedFooter pe={pe} />
      </div>
    </div>
  )
}

/* ====================== Set table (skeleton) ====================== */

function ColHeader({
  children,
  narrow,
}: {
  children: React.ReactNode
  narrow?: boolean
}) {
  return (
    <div
      style={{
        background: INK,
        color: '#fff',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        height: 26,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 8,
        padding: narrow ? '0 6px' : '0 12px',
      }}
    >
      {children}
    </div>
  )
}

/**
 * Renders one row per live set on the program_exercise. Each row is
 * independently editable for value (Phase C, 2026-05-07).
 *
 * Phase F (2026-05-07): metric is column-level, not per-set. The third
 * column's HEADER becomes the metric dropdown; picking a metric writes
 * it to every set in this exercise via updateProgramExerciseMetricAction.
 * Per-row cells are value-only. This is how an EP actually thinks: "the
 * column is kg, log values" — wave loading varies the value across sets,
 * not the metric.
 *
 * Storage stays per-set (the per-set table is unchanged). The action
 * writes the same metric to all sets in one bulk UPDATE; reads pull from
 * the first set. Logger's portal-side prefill keeps working unchanged
 * because all sets share the metric.
 */
function SetTable({
  pe,
  metricUnits,
  clientId,
  dayId,
}: {
  pe: ProgramExercise
  metricUnits: MetricUnitOption[]
  clientId: string
  dayId: string
}) {
  // Column-level metric is read from the first live set — they're all in
  // sync since updateProgramExerciseMetricAction is the only writer and
  // does a bulk UPDATE. addExerciseToDayAction / swap_program_exercise /
  // addProgramExerciseSetAction all seed the same metric across rows.
  const columnMetric = pe.prescriptionSets[0]?.optional_metric ?? ''

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 1fr 1.4fr',
        columnGap: 6,
        rowGap: 6,
      }}
    >
      <ColHeader narrow>Set</ColHeader>
      <ColHeader>Reps</ColHeader>
      <MetricColumnDropdown
        peId={pe.id}
        clientId={clientId}
        dayId={dayId}
        metric={columnMetric}
        metricUnits={metricUnits}
      />

      {pe.prescriptionSets.map((set) => (
        <SetRow key={set.id} set={set} />
      ))}
    </div>
  )
}

function SetRow({ set }: { set: PrescriptionSet }) {
  return (
    <>
      <div
        style={{
          height: 26,
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 600,
          color: INK,
          background: CREAM_DEEP,
          borderRadius: 8,
        }}
      >
        {set.set_number}
      </div>
      <SetCell
        setId={set.id}
        field="reps"
        initialValue={set.reps ?? ''}
        placeholder="—"
      />
      <SetCell
        setId={set.id}
        field="optional_value"
        initialValue={set.optional_value ?? ''}
        placeholder="—"
      />
    </>
  )
}

function SetCell({
  setId,
  field,
  initialValue,
  placeholder,
}: {
  setId: string
  field: keyof ProgramExerciseSetPatch
  initialValue: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  // Phase I §2.16: bumped on each successful save. Re-keyed SaveTick
  // remounts and the keyframe runs once. No setTimeout, no cleanup.
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()
  const empty = value.trim() === ''

  function handleBlur() {
    if (value === initialValue) return
    const trimmed = value.trim()
    const patch: ProgramExerciseSetPatch = {
      [field]: trimmed === '' ? null : trimmed,
    }
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseSetAction(setId, patch)
      if (res.error) {
        setStatus('error')
      } else {
        setStatus('idle')
        setSavedAt((n) => n + 1)
      }
    })
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          background: CREAM,
          borderRadius: 8,
          height: 26,
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          color: empty ? FAINT : INK,
          border:
            status === 'error' ? '1px solid var(--color-alert)' : '1px solid transparent',
          outline: 'none',
          padding: '0 10px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      <SaveTick savedAt={savedAt} placement="inline" />
    </div>
  )
}

/**
 * Phase I §2.16 — autosave success indicator. Renders nothing on first
 * mount (savedAt === 0). On each save, the parent bumps savedAt; React
 * remounts this component (key={savedAt}) and the CSS keyframe `save-tick`
 * runs once: 200ms in / 600ms hold / 400ms out. Pointer-events none so it
 * never intercepts a click.
 *
 * Two placements:
 *   - inline   — small inputs (SetCell, SmallField). Vertically centered
 *                on the right edge of the cell.
 *   - corner   — taller surfaces (EditableTextarea). Top-right corner.
 */
function SaveTick({
  savedAt,
  placement,
}: {
  savedAt: number
  placement: 'inline' | 'corner'
}) {
  if (savedAt === 0) return null
  const positionStyle =
    placement === 'inline'
      ? { top: '50%', right: 6, transform: 'translateY(-50%)' }
      : { top: 8, right: 8 }
  return (
    <span
      key={savedAt}
      aria-hidden
      style={{
        position: 'absolute',
        ...positionStyle,
        display: 'grid',
        placeItems: 'center',
        pointerEvents: 'none',
        color: GREEN,
        animation: 'save-tick 1200ms cubic-bezier(0.4, 0, 0.2, 1) forwards',
      }}
    >
      <Check size={12} strokeWidth={2.5} aria-hidden />
    </span>
  )
}

/**
 * Phase F: the third column's HEADER is the metric dropdown. Picking a
 * metric writes it to every set in this exercise via the column-wide
 * updateProgramExerciseMetricAction (one bulk UPDATE on
 * program_exercise_sets). Closed state shows the metric's display_label
 * uppercased so it reads like a column header; empty state shows the
 * default "Load / Notes" label.
 *
 * Visual: same black slab as the other column headers (background INK,
 * white text, Barlow Condensed 700, uppercase). Custom chevron overlay
 * — appearance:none on the native <select> + a Lucide ChevronDown
 * positioned absolutely at the right.
 *
 * The metric storage stays per-set; this component is just the writer
 * that keeps all rows in sync. Logger's portal-side prefill (Phase C
 * routing on optional_metric === 'rpe') keeps working unchanged.
 */
function MetricColumnDropdown({
  peId,
  clientId,
  dayId,
  metric,
  metricUnits,
}: {
  peId: string
  clientId: string
  dayId: string
  metric: string
  metricUnits: MetricUnitOption[]
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // Legacy-value fallback: same pattern as SectionTitleField from Phase E.
  // If the saved metric isn't in the org's current list (renamed,
  // soft-deleted, etc.), keep it as a selectable option so the closed
  // state doesn't silently drop to "—".
  const metricInOptions =
    metric !== '' && metricUnits.some((u) => u.code === metric)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === '' ? null : e.target.value
    startTransition(async () => {
      const res = await updateProgramExerciseMetricAction(
        clientId,
        dayId,
        peId,
        next,
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
        position: 'relative',
        height: 26,
      }}
    >
      <select
        value={metric}
        onChange={handleChange}
        disabled={pending}
        aria-label="Load / Notes metric"
        style={{
          background: INK,
          color: '#fff',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          height: '100%',
          width: '100%',
          padding: '0 22px 0 12px',
          border: 'none',
          borderRadius: 8,
          outline: 'none',
          appearance: 'none',
          WebkitAppearance: 'none',
          MozAppearance: 'none',
          cursor: pending ? 'wait' : 'pointer',
          boxSizing: 'border-box',
          textAlign: 'center',
          textAlignLast: 'center',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}
      >
        <option value="">Load / Notes</option>
        {!metricInOptions && metric !== '' && (
          <option value={metric}>{metric}</option>
        )}
        {metricUnits.map((u) => (
          <option key={u.code} value={u.code}>
            {u.display_label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        aria-hidden
        style={{
          position: 'absolute',
          right: 7,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#fff',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function SetStepper({
  pe,
  clientId,
  dayId,
}: {
  pe: ProgramExercise
  clientId: string
  dayId: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const current = pe.prescriptionSets.length

  function handleAdd() {
    startTransition(async () => {
      const res = await addProgramExerciseSetAction(clientId, dayId, pe.id)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleRemove() {
    if (current <= 1) return
    const last = pe.prescriptionSets[pe.prescriptionSets.length - 1]
    if (!last) return
    startTransition(async () => {
      const res = await removeProgramExerciseSetAction(clientId, dayId, last.id)
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
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
        alignSelf: 'flex-end',
        opacity: pending ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        onClick={handleRemove}
        disabled={current <= 1 || pending}
        aria-label="Remove set"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          color: MUTED,
          cursor: current <= 1 ? 'not-allowed' : 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        −
      </button>
      <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
        {current} {current === 1 ? 'set' : 'sets'}
      </span>
      <button
        type="button"
        onClick={handleAdd}
        disabled={pending}
        aria-label="Add set"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          color: MUTED,
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        +
      </button>
    </div>
  )
}

/* ====================== Extras row (Rest / Tempo) ====================== */

/**
 * Per-exercise extras. RPE is no longer here — it moves to per-set storage
 * via the Load/Notes cell, which becomes a [value][metric] dropdown in
 * Phase F (with 'rpe' as one of the metric options). Until then the
 * Phase C UI keeps Load/Notes freetext per set; the EP can type 'RPE 8'
 * inline when prescribing perceived effort.
 */
function ExtrasRow({ pe }: { pe: ProgramExercise }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 6,
        marginTop: 8,
      }}
    >
      <SmallField
        programExerciseId={pe.id}
        field="rest_seconds"
        label="Rest (s)"
        kind="number"
        initialValue={pe.rest_seconds?.toString() ?? ''}
      />
      <SmallField
        programExerciseId={pe.id}
        field="tempo"
        label="Tempo"
        kind="text"
        initialValue={pe.tempo ?? ''}
      />
    </div>
  )
}

function SmallField({
  programExerciseId,
  field,
  label,
  kind,
  initialValue,
}: {
  programExerciseId: string
  field: keyof ProgramExercisePatch
  label: string
  kind: 'number' | 'text'
  initialValue: string
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  // Phase I §2.16 — autosave success indicator (see SaveTick below).
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()
  const empty = value.trim() === ''

  function handleBlur() {
    if (value === initialValue) return
    const patch = buildPatch(field, value, kind)
    if (patch === null) {
      setStatus('error')
      return
    }
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseAction(programExerciseId, patch)
      if (res.error) {
        setStatus('error')
      } else {
        setStatus('idle')
        setSavedAt((n) => n + 1)
      }
    })
  }

  return (
    <label style={{ display: 'block' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: FAINT,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type={kind === 'number' ? 'number' : 'text'}
          inputMode={kind === 'number' ? 'numeric' : undefined}
          value={value}
          placeholder="—"
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          style={{
            width: '100%',
            height: 28,
            padding: '0 8px',
            background: CREAM,
            border:
              status === 'error' ? '1px solid var(--color-alert)' : '1px solid transparent',
            borderRadius: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: empty ? FAINT : INK,
            textAlign: 'center',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <SaveTick savedAt={savedAt} placement="inline" />
      </div>
    </label>
  )
}

/* ====================== Last-logged footer ====================== */

/**
 * Phase H (2026-05-08): a single-line "Last: …" readout pinned to the
 * bottom of the prescription column. Reads the most recent completed
 * exercise_log for THIS client + exercise_id (loaded by page.tsx) and
 * renders the actuals so the EP can see what the client did last time
 * without leaving the builder.
 *
 * Format conventions (sign-off 2026-05-08, Q1a + Q2a):
 *   - Reps/weight uniform across sets → single value (`4 × 6 @ 80 kg`).
 *   - Reps/weight varying          → low-high range (`4 × 6 @ 75-80 kg`).
 *   - weight_metric === 'bodyweight' → drop `@`, append `BW` (`3 × 8 BW`).
 *   - Mixed metrics across sets   → use set 1's metric (defensive).
 *   - Date is relative ("9 days ago") — CLAUDE.md voice rule.
 *
 * Returns null when there is no history. Pre-launch this is true for
 * every card; post-launch it surfaces only on cards the client has
 * completed at least once.
 */
function LastLoggedFooter({ pe }: { pe: ProgramExercise }) {
  if (pe.lastLogged === null) return null
  const summary = formatLastLoggedSummary(pe.lastLogged)
  if (summary === null) return null

  return (
    <div
      style={{
        marginTop: 'auto',
        paddingTop: 8,
        borderTop: `1px solid ${BORDER}`,
        fontFamily: 'var(--font-sans)',
        fontSize: 11,
        lineHeight: 1.4,
        color: MUTED,
      }}
    >
      <span style={{ color: INK, fontWeight: 600 }}>Last:</span>{' '}
      <span>{summary}</span>{' '}
      <span style={{ color: FAINT }}>· {timeAgo(pe.lastLogged.completedAt)}</span>
    </div>
  )
}

/**
 * Builds the body text between "Last:" and the time-ago suffix. Returns
 * null when there's nothing meaningful to show (no live sets at all —
 * the loader already filters this case, but the renderer is defensive).
 */
function formatLastLoggedSummary(ll: LastLogged): string | null {
  const sets = ll.sets
  const N = sets.length
  if (N === 0) return null

  // Reps: collapse to single value if uniform, otherwise low-high range.
  const reps: number[] = []
  for (const s of sets) if (s.repsPerformed !== null) reps.push(s.repsPerformed)
  let countLabel: string
  if (reps.length > 0) {
    const min = Math.min(...reps)
    const max = Math.max(...reps)
    countLabel = `${N} × ${min === max ? min : `${min}-${max}`}`
  } else {
    // No reps logged on any set — fall back to bare set count.
    countLabel = `${N} ${N === 1 ? 'set' : 'sets'}`
  }

  // Load: bodyweight short-circuits to "BW", otherwise uniform/range value
  // followed by metric. Set 1's metric wins on the (rare) mixed case.
  const metric = sets[0]?.weightMetric ?? null
  if (metric === 'bodyweight') {
    return `${countLabel} BW`
  }
  const weights: number[] = []
  for (const s of sets) if (s.weightValue !== null) weights.push(s.weightValue)
  if (weights.length === 0) {
    // No load data, no bodyweight flag — append "reps" only when we have
    // a reps value, otherwise leave as bare count (defensive, rare).
    return reps.length > 0 ? `${countLabel} reps` : countLabel
  }
  const wMin = Math.min(...weights)
  const wMax = Math.max(...weights)
  const fmtN = (n: number) => parseFloat(n.toFixed(2)).toString()
  const valueStr = wMin === wMax ? fmtN(wMin) : `${fmtN(wMin)}-${fmtN(wMax)}`
  const unitStr = metric ? ` ${metric}` : ''
  return `${countLabel} @ ${valueStr}${unitStr}`
}

/* ====================== Between-cards action bar ====================== */

/**
 * The Phase D action bar — replaces the prior CardActions which lived below
 * each card and was ambiguous about which cards it acted on.
 *
 * Three positions:
 *   - top    (beforePeId == null) — "+ Add exercise" arms an atStart slot.
 *   - between (both ids set)      — "+ Add exercise" arms an after-anchor
 *                                    slot; "Superset" groups the two cards
 *                                    on either side per Q3 sign-off
 *                                    2026-05-07. Hidden when both share a
 *                                    group_id (already grouped — bar shows
 *                                    only "+ Add exercise" inside a group).
 *   - bottom (afterPeId == null)  — "+ Add exercise" clears the slot
 *                                    (today's append-at-MAX behaviour).
 *
 * The bar is a 1px hairline + small icon-only buttons centered on top.
 * Always-on per Q2 sign-off: discoverability beats restraint here, the bar
 * is the only insertion affordance now.
 */
function BetweenCardsBar({
  beforePeId,
  beforeGroupId,
  afterPeId,
  afterGroupId,
  clientId,
  dayId,
  insertSlot,
  setInsertSlot,
  focusLibrarySearch,
}: {
  beforePeId: string | null
  beforeGroupId: string | null
  afterPeId: string | null
  afterGroupId: string | null
  clientId: string
  dayId: string
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  focusLibrarySearch: () => void
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const isTop = beforePeId === null
  const isBottom = afterPeId === null
  const isBetween = !isTop && !isBottom

  // Same group ⇒ already supersetted ⇒ the Superset button is meaningless.
  // Render it only on between-cards bars where grouping the pair changes
  // something (different groups merge; ungrouped + grouped joins; both
  // ungrouped mints fresh).
  const sameGroup =
    isBetween && beforeGroupId !== null && beforeGroupId === afterGroupId
  const showSuperset = isBetween && !sameGroup

  // Visual feedback: which bar's "+ Add exercise" is currently armed for
  // the next library-pick. Subtle but explicit.
  const isActiveSlot =
    (isTop && insertSlot?.kind === 'atStart') ||
    (isBetween &&
      insertSlot?.kind === 'after' &&
      insertSlot.afterPeId === beforePeId)

  function handleAddExercise() {
    if (isTop) setInsertSlot({ kind: 'atStart' })
    else if (isBottom) setInsertSlot(null) // bottom = today's append
    else setInsertSlot({ kind: 'after', afterPeId: beforePeId! })
    focusLibrarySearch()
  }

  function handleSuperset() {
    if (!isBetween || sameGroup) return
    startTransition(async () => {
      const res = await groupAcrossActionBarAction(
        clientId,
        dayId,
        beforePeId!,
        afterPeId!,
      )
      if (res.error) {
        alert(res.error)
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
    <div
      style={{
        position: 'relative',
        height: 22,
        margin: '4px 0',
      }}
    >
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
        background: active ? 'var(--color-slate)' : '#fff',
        color: active ? '#fff' : disabled ? FAINT : MUTED,
        border: `1px solid ${active ? 'var(--color-slate)' : BORDER}`,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        transition:
          'background 150ms, color 150ms, border-color 150ms',
      }}
    >
      {children}
    </button>
  )
}

/* ====================== Editable bits shared across the card ====================== */

function EditableTextarea({
  programExerciseId,
  field,
  initialValue,
  placeholder,
}: {
  programExerciseId: string
  field: keyof ProgramExercisePatch
  initialValue: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  // Phase I §2.16 — autosave success indicator (see SaveTick).
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()

  function handleBlur() {
    if (value === initialValue) return
    const patch: ProgramExercisePatch = {
      [field]: value.trim() === '' ? null : value,
    } as ProgramExercisePatch
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseAction(programExerciseId, patch)
      if (res.error) {
        setStatus('error')
      } else {
        setStatus('idle')
        setSavedAt((n) => n + 1)
      }
    })
  }

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        rows={3}
        style={{
          background: CREAM,
          border:
            status === 'error' ? '1px solid var(--color-alert)' : '1px solid transparent',
          borderRadius: 8,
          padding: '10px 12px',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          lineHeight: 1.5,
          color: value ? INK : FAINT,
          fontWeight: 400,
          width: '100%',
          minHeight: 60,
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
          display: 'block',
        }}
      />
      <SaveTick savedAt={savedAt} placement="corner" />
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
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        background: 'transparent',
        border: 'none',
        color: disabled ? 'var(--color-border-subtle)' : MUTED,
        cursor: disabled ? 'not-allowed' : 'pointer',
        padding: 4,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 4,
        transition: 'color 120ms',
      }}
    >
      {children}
    </button>
  )
}

/**
 * Section title is a tenant-configurable label per program_exercise. Free
 * text on the column (Q1 sign-off 2026-05-07 — the dropdown is a UI helper,
 * not an FK), so legacy ad-hoc values still render even if they're not in
 * the org's section_titles list.
 *
 * Two modes:
 *   - select   — native <select>: sentinel "(none)" + the org's seeded
 *                titles + the value-as-option fallback (when the saved
 *                value isn't in the list, e.g. legacy free-text) + a
 *                trailing "+ Add new section…" sentinel.
 *   - creating — inline text input. Enter submits via addSectionTitleAction
 *                AND applies via updateProgramExerciseAction in parallel;
 *                Esc cancels. Duplicate names soft-fail (the existing
 *                section is the wanted state — apply anyway).
 *
 * Phase E (/docs/polish/session-builder.md §2.6).
 */
function SectionTitleField({
  programExerciseId,
  initialValue,
  options,
}: {
  programExerciseId: string
  initialValue: string
  options: SectionTitleOption[]
}) {
  const [value, setValue] = useState(initialValue)
  const [mode, setMode] = useState<'select' | 'creating'>('select')
  const [draft, setDraft] = useState('')
  const [, startTransition] = useTransition()
  const router = useRouter()

  // Sync local state when the server pushes a new initialValue — happens
  // when a sibling in our superset group adopts a section title via
  // updateSectionTitleAction's fan-out path. Without this, useState only
  // honours initialValue on the first render and the prop change is
  // silently ignored, leaving siblings showing stale "(— Section —)".
  // Skip while the user is mid-create to not blow away their draft.
  useEffect(() => {
    if (mode === 'creating') return
    setValue(initialValue)
  }, [initialValue, mode])

  // Render a legacy free-text option when the saved value isn't in the
  // org's section_titles list. Without this the <select> would silently
  // reset on first render to the empty option.
  const valueInOptions = value !== '' && options.some((o) => o.name === value)

  function applyValue(next: string) {
    setValue(next)
    startTransition(async () => {
      // Section is a property of the block. The action fans out to every
      // live member of the superset group when this card is grouped, so
      // siblings stay in sync. router.refresh() pulls those siblings'
      // updated section_title into their own SectionTitleField instances.
      const res = await updateSectionTitleAction(
        programExerciseId,
        next === '' ? null : next,
      )
      if (res.error) {
        alert(res.error)
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
      // Both server actions are independent. Run in parallel — the section
      // title persists to section_titles for the org's dropdown; the
      // updateSectionTitle action applies the name to this card AND fans
      // out to its superset siblings if grouped. Duplicate-name on add is
      // soft-failed: the section already exists in the org's list ⇒ the
      // EP's intent is satisfied without an alert.
      const [addRes, updateRes] = await Promise.all([
        addSectionTitleAction(name),
        updateSectionTitleAction(programExerciseId, name),
      ])
      if (
        addRes.error &&
        !addRes.error.toLowerCase().includes('already exists')
      ) {
        alert(addRes.error)
      }
      if (updateRes.error) {
        alert(updateRes.error)
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
    <select
      value={value}
      onChange={handleSelectChange}
      aria-label="Section"
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
        color: value ? MUTED : FAINT,
        outline: 'none',
        marginBottom: 12,
        appearance: 'none',
        cursor: 'pointer',
      }}
    >
      <option value="">— Section —</option>
      {!valueInOptions && value !== '' && (
        <option value={value}>{value}</option>
      )}
      {options.map((o) => (
        <option key={o.id} value={o.name}>
          {o.name}
        </option>
      ))}
      <option value="__add__">+ Add new section…</option>
    </select>
  )
}

function buildPatch(
  field: keyof ProgramExercisePatch,
  raw: string,
  kind: 'number' | 'text',
): ProgramExercisePatch | null {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { [field]: null } as ProgramExercisePatch
  }
  if (kind === 'number') {
    const n = parseInt(trimmed, 10)
    if (!Number.isFinite(n) || n < 0) return null
    return { [field]: n } as ProgramExercisePatch
  }
  return { [field]: trimmed } as ProgramExercisePatch
}

/* ====================== Right column: Library / Notes / Reports ====================== */

function LibraryPanel({
  options,
  clientId,
  dayId,
  insertSlot,
  setInsertSlot,
  programExercises,
  movementPatterns,
  exerciseTags,
  swapTarget,
  setSwapTarget,
}: {
  options: LibraryPick[]
  clientId: string
  dayId: string
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  programExercises: ProgramExercise[]
  movementPatterns: MovementPatternOption[]
  exerciseTags: ExerciseTagOption[]
  swapTarget: string | null
  setSwapTarget: (peId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  // Chip filter state. Multi-select within each category. AND across
  // categories, OR within (Q3 sign-off 2026-05-07).
  const [selectedPatternIds, setSelectedPatternIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [, startTransition] = useTransition()
  const router = useRouter()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return options.filter((o) => {
      if (q && !o.name.toLowerCase().includes(q)) return false
      if (selectedPatternIds.size > 0) {
        if (
          !o.movement_pattern_id ||
          !selectedPatternIds.has(o.movement_pattern_id)
        ) {
          return false
        }
      }
      if (selectedTagIds.size > 0) {
        const hasAny = o.tag_ids.some((id) => selectedTagIds.has(id))
        if (!hasAny) return false
      }
      return true
    })
  }, [options, query, selectedPatternIds, selectedTagIds])

  const filtersActive =
    selectedPatternIds.size > 0 || selectedTagIds.size > 0

  function togglePattern(id: string) {
    setSelectedPatternIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleTag(id: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function resetFilters() {
    setSelectedPatternIds(new Set())
    setSelectedTagIds(new Set())
  }

  function handleAdd(exerciseId: string) {
    setAdding(exerciseId)
    // Swap takes priority — the two states are mutually exclusive at the
    // setter level but the runtime check is defensive.
    if (swapTarget) {
      startTransition(async () => {
        const res = await swapProgramExerciseAction(
          clientId,
          dayId,
          swapTarget,
          exerciseId,
        )
        if (res.error) {
          alert(res.error)
        } else {
          setSwapTarget(null)
          router.refresh()
        }
        setAdding(null)
      })
      return
    }
    const slot: InsertSlot = insertSlot ?? { kind: 'append' }
    startTransition(async () => {
      const res = await addExerciseToDayAction(clientId, dayId, exerciseId, slot)
      if (res.error) {
        alert(res.error)
      } else {
        setInsertSlot(null)
        router.refresh()
      }
      setAdding(null)
    })
  }

  // Slot/swap status banner. The label tells the EP exactly what the next
  // pick will do; Cancel returns to default (append-at-end, no swap).
  // Swap wins over insert when both armed (defensive — setters enforce
  // mutual exclusion upstream).
  let slotLabel: string | null = null
  let cancelHandler: (() => void) | null = null
  if (swapTarget) {
    const target = programExercises.find((p) => p.id === swapTarget)
    slotLabel = target
      ? `Replacing: ${target.exercise_name}`
      : 'Replacing exercise'
    cancelHandler = () => setSwapTarget(null)
  } else if (insertSlot?.kind === 'atStart') {
    slotLabel = 'Inserting at top'
    cancelHandler = () => setInsertSlot(null)
  } else if (insertSlot?.kind === 'after') {
    const anchor = programExercises.find((p) => p.id === insertSlot.afterPeId)
    slotLabel = anchor
      ? `Inserting after ${anchor.exercise_name}`
      : 'Inserting at slot'
    cancelHandler = () => setInsertSlot(null)
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Library — pick to add
      </div>
      {slotLabel && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
            padding: '6px 10px',
            background: CREAM_DEEP,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
          }}
        >
          <span
            style={{
              flex: 1,
              fontFamily: 'var(--font-sans)',
              fontSize: '.76rem',
              fontWeight: 500,
              color: INK,
            }}
          >
            {slotLabel}
          </span>
          <button
            type="button"
            onClick={() => cancelHandler?.()}
            aria-label={swapTarget ? 'Cancel swap' : 'Cancel insert'}
            title={swapTarget ? 'Cancel swap' : 'Cancel insert'}
            style={{
              width: 18,
              height: 18,
              background: 'transparent',
              border: 'none',
              color: MUTED,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              padding: 0,
            }}
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      )}
      {/* Movement-pattern chips above the search. Multi-select; OR within. */}
      <FilterChipRow
        chips={movementPatterns}
        selected={selectedPatternIds}
        onToggle={togglePattern}
        ariaLabel="Filter by movement pattern"
      />

      <div style={{ position: 'relative', marginTop: 8, marginBottom: 8 }}>
        <Search
          size={14}
          aria-hidden
          style={{ position: 'absolute', left: 10, top: 9, color: MUTED }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search exercises…"
          aria-label="Search exercises"
          style={{
            width: '100%',
            height: 32,
            padding: '0 12px 0 30px',
            border: `1px solid ${BORDER}`,
            borderRadius: 'var(--radius-input)',
            fontFamily: 'var(--font-sans)',
            fontSize: '.82rem',
            background: CREAM,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Exercise-tag chips below the search. Multi-select; OR within.
          Tag filter is AND'd with the pattern filter (Q3 sign-off
          2026-05-07). */}
      <FilterChipRow
        chips={exerciseTags}
        selected={selectedTagIds}
        onToggle={toggleTag}
        prefix="#"
        ariaLabel="Filter by tag"
      />

      {filtersActive && (
        <button
          type="button"
          onClick={resetFilters}
          style={{
            background: 'transparent',
            border: 'none',
            color: MUTED,
            fontSize: '.72rem',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '2px 0',
            marginBottom: 8,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          Reset filters
        </button>
      )}

      {options.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: MUTED,
            padding: '12px 0',
            lineHeight: 1.5,
          }}
        >
          Your exercise library is empty. Add exercises in /library first,
          then come back here.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, padding: '12px 0' }}>
          No matches.
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {filtered.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => handleAdd(o.id)}
              disabled={adding !== null}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 0',
                borderTop: `1px solid ${BORDER}`,
                borderLeft: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                background: 'transparent',
                textAlign: 'left',
                cursor: adding === o.id ? 'wait' : 'pointer',
                opacity: adding !== null && adding !== o.id ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: '.84rem', fontWeight: 600 }}>
                {o.name}
              </div>
              {o.movement_pattern_name && (
                <div
                  style={{
                    fontSize: '.72rem',
                    color: MUTED,
                    marginTop: 1,
                  }}
                >
                  {o.movement_pattern_name}
                  {adding === o.id && ' · adding…'}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Multi-select chip row used by the LibraryPanel for movement-pattern and
 * tag filters. Local-first: filter state lives in LibraryPanel; this
 * component is purely presentational.
 *
 * Visual: small pill chips, hairline border, charcoal-on when selected
 * (matches the .chip token in globals.css but tightened for the session-
 * builder's denser right-panel context — 3px/9px padding vs the global
 * 6px/14px).
 */
function FilterChipRow({
  chips,
  selected,
  onToggle,
  prefix,
  ariaLabel,
}: {
  chips: { id: string; name: string }[]
  selected: Set<string>
  onToggle: (id: string) => void
  prefix?: string
  ariaLabel: string
}) {
  if (chips.length === 0) return null
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
      }}
    >
      {chips.map((c) => {
        const on = selected.has(c.id)
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(c.id)}
            style={{
              padding: '3px 9px',
              borderRadius: 999,
              border: `1px solid ${on ? 'var(--color-charcoal)' : BORDER}`,
              background: on ? 'var(--color-charcoal)' : '#fff',
              color: on ? '#fff' : MUTED,
              fontFamily: 'var(--font-sans)',
              fontSize: '.7rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {prefix}
            {c.name}
          </button>
        )
      })}
    </div>
  )
}

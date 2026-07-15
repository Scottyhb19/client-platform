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
  Lock,
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
  addProgramExerciseSetAction,
  addSectionTitleAction,
  autofillProgramExerciseSetColumnAction,
  groupAcrossActionBarAction,
  moveProgramExerciseAction,
  removeProgramExerciseAction,
  removeProgramExerciseSetAction,
  reorderProgramExercisesAction,
  ungroupFromSupersetAction,
  updateProgramExerciseAction,
  updateProgramExerciseMetricAction,
  updateProgramExerciseRepMetricAction,
  updateProgramExerciseSetAction,
  updateSectionTitleAction,
  type AutofillableSetField,
  type InsertSlot,
  type ProgramExercisePatch,
  type ProgramExerciseSetPatch,
} from '../actions'
import { LibraryPanel } from './LibraryPanel'
import { SaveAsCircuitButton } from './CircuitControls'
import type { LibraryExercise } from '@/app/(staff)/library/types'
import {
  VOLUME_UNIT_OPTIONS,
  volumeUnitLabel,
  volumeUnitSuffix,
} from '@/lib/prescription/volume-units'
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
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'
import { notify } from '@/app/(staff)/_components/Notice'

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

/**
 * Read-only lock (2026-07-15). True when the client has completed this
 * session and it is still assigned (see the day page's `locked` compute).
 * Every write control in the builder reads this via useSessionLocked() and
 * renders read-only — value inputs become static text, action affordances
 * hide. A completed session's prescription is the record the client actually
 * performed against, so freezing it keeps that record honest.
 *
 * This is a UI guardrail, not a DB constraint: the Unassign button in the
 * page header is the deliberate escape hatch — unassigning drops
 * published_at, so `locked` goes false and editing re-opens. DB-level
 * enforcement is deferred with a re-trigger (docs/go-live-checklist.md §8).
 */
const SessionLockContext = React.createContext(false)
function useSessionLocked(): boolean {
  return React.useContext(SessionLockContext)
}

export type PrescriptionSet = {
  id: string
  set_number: number
  reps: string | null
  rep_metric: string | null
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
  repMetric: string | null
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

/**
 * Library options are the full LibraryExercise card shape (G-7,
 * 2026-06-12) — the right-panel Library tab composes the standalone
 * library's atoms, so it renders the same cards. Loaded by page.tsx via
 * the shared library/_lib/exercise-query module.
 */

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
  libraryOptions: LibraryExercise[]
  clinicalNotes: ClinicalNoteSummary[]
  reports: SessionReport[]
  testHistory: ClientTestHistory
  sectionTitles: SectionTitleOption[]
  movementPatterns: MovementPatternOption[]
  exerciseTags: ExerciseTagOption[]
  metricUnits: MetricUnitOption[]
  // Read-only lock — the client has completed this (still-assigned) session,
  // so its prescription is frozen. Threaded down via SessionLockContext.
  locked: boolean
  // ISO timestamp of the completion, for the lock banner. Null when unlocked.
  completedAt: string | null
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
  locked,
  completedAt,
}: SessionBuilderProps) {
  const router = useRouter()
  // §6.5.2: Notes is the default tab — clinical context visible while
  // programming is the differentiator's thesis. Was 'library' until G-6
  // (2026-06-12); the empty-day state still routes to the library in one
  // click via "Browse the library", and arming any slot/swap force-switches
  // the panel to the library tab.
  const [tab, setTab] = useState<'notes' | 'reports' | 'library'>('notes')

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
    // Belt on top of hiding the drag handle when locked — a completed
    // session's exercise order is part of the frozen record.
    if (locked) return
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
        notify(res.error)
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

  // pe id → exercise name, for the LibraryPanel's swap/insert banner
  // labels (the panel no longer receives the full programExercises array).
  const exerciseNameById = useMemo(
    () =>
      new Map(programExercises.map((pe) => [pe.id, pe.exercise_name] as const)),
    [programExercises],
  )

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
    <SessionLockContext.Provider value={locked}>
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 28,
        alignItems: 'start',
      }}
    >
      <div>
        {locked && <LockedBanner completedAt={completedAt} />}
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
                background: tab === k ? 'var(--color-card)' : 'transparent',
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
            exerciseNameById={exerciseNameById}
            movementPatterns={movementPatterns}
            exerciseTags={exerciseTags}
            swapTarget={swapTarget}
            setSwapTarget={setSwapTarget}
            onSwapComplete={() => setTab('notes')}
            locked={locked}
          />
        )}
        {tab === 'notes' && <NotesPanel notes={clinicalNotes} />}
        {tab === 'reports' && (
          <ReportsPanel reports={reports} history={testHistory} />
        )}
      </aside>
    </div>
    </SessionLockContext.Provider>
  )
}

/**
 * Lock banner (2026-07-15). Sits above the exercise list when the session
 * is read-only. Quiet surface + muted copy per the design voice — factual,
 * no alarm. Points the EP at the Unassign button in the page header, which
 * is the only way back to editing.
 */
function LockedBanner({ completedAt }: { completedAt: string | null }) {
  const dateLabel = completedAt
    ? new Intl.DateTimeFormat('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(completedAt))
    : null
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        marginBottom: 16,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-card-dense)',
        fontSize: '.84rem',
        lineHeight: 1.5,
        color: 'var(--color-text-light)',
      }}
    >
      <Lock
        size={15}
        aria-hidden
        style={{ flexShrink: 0, color: 'var(--color-muted)' }}
      />
      <span>
        This session is locked
        {dateLabel ? ` — completed ${dateLabel}` : ''}. Unassign it above to
        make changes.
      </span>
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
          background: 'var(--color-card)',
          borderRadius: 'var(--radius-card-dense)',
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
        background: 'var(--color-card)',
        border: `1px solid ${BORDER}`,
        borderRadius: 'var(--radius-card-dense)',
        padding: '10px 14px',
        // The system's single sanctioned card shadow — the previous
        // 0 8px 24px elevation sat outside "one subtle shadow on cards
        // and nothing else" (G-9).
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
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
      {/* C-5: save the whole group as a reusable circuit. Card column (2)
          ONLY — column 1 carries the absolute slate spine, which paints over
          any text placed there (the clipped-button bug). */}
      <div style={{ gridColumn: 2, gridRow: members.length * 2, marginTop: 2 }}>
        <SaveAsCircuitButton memberIds={members.map((m) => m.id)} />
      </div>
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
  const locked = useSessionLocked()
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // On-system confirm (CN-13 pattern, shared ConfirmDialog) in place of the
  // browser-native confirm()/alert(). A delete failure surfaces inside the
  // open dialog so the EP can retry or cancel — no transient alert().
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Server actions invalidate the route cache via revalidatePath; the
  // client component still needs router.refresh() to actually re-fetch
  // and re-render the page with the new data.

  function doRemove() {
    if (locked) return
    setRemoveError(null)
    startTransition(async () => {
      const res = await removeProgramExerciseAction(clientId, dayId, pe.id)
      if (res.error) {
        setRemoveError(res.error)
        return
      }
      setConfirmRemove(false)
      router.refresh()
    })
  }

  function handleMove(direction: 'up' | 'down') {
    if (locked) return
    startTransition(async () => {
      const res = await moveProgramExerciseAction(clientId, dayId, pe.id, direction)
      if (res.error) {
        notify(res.error)
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
    if (locked) return
    startTransition(async () => {
      const res = await ungroupFromSupersetAction(clientId, dayId, pe.id)
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
              underline at rest so the surface stays calm. When locked, the
              name is plain static text — no swap. */}
          {locked ? (
            <div
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 15,
                color: INK,
                flex: 1,
              }}
            >
              {pe.exercise_name}
            </div>
          ) : (
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
              {/* §6.5.2 (G-6): while this card's swap is armed, the name
                  blanks to the brief-literal placeholder; cancelling the
                  swap (click again / banner Cancel) restores it. */}
              {isSwapping ? (
                <span style={{ color: MUTED, fontStyle: 'italic' }}>
                  Select exercise…
                </span>
              ) : (
                pe.exercise_name
              )}
            </button>
          )}
          {/* Reorder / ungroup / remove / drag — all hidden when the session
              is locked (read-only record). */}
          {!locked && (
            <>
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
                onClick={() => {
                  setRemoveError(null)
                  setConfirmRemove(true)
                }}
                label="Remove exercise"
              >
                <Trash2 size={14} aria-hidden />
              </IconButton>
              <DragHandle />
            </>
          )}
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

      {confirmRemove && (
        <ConfirmDialog
          title="Remove exercise?"
          body={
            <>
              <strong>{pe.exercise_name}</strong> will be removed from this
              session, along with its sets.
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
  // Column-level volume unit, read from the first live set (kept in sync by
  // the bulk updateProgramExerciseRepMetricAction, same as the load metric).
  const columnRepMetric = pe.prescriptionSets[0]?.rep_metric ?? ''

  const [, startTransition] = useTransition()

  // Column autofill: a committed value follows DOWNWARD — into the cells
  // below the edited set that are empty or still hold the edited cell's
  // previous value. Sets above never move (that's what makes 8/6/4
  // enterable top-down), and a below-cell customised to a different value
  // never moves either. This props-based check only skips the round-trip
  // when nothing below could follow at last render; the authoritative
  // below / empty / matches-previous filters run server-side, so a stale
  // view can never overwrite a sibling's saved value — the worst
  // staleness does is leave a sibling unfollowed.
  function handleCellCommitted(
    setId: string,
    field: AutofillableSetField,
    value: string,
    previousValue: string,
  ) {
    const edited = pe.prescriptionSets.find((s) => s.id === setId)
    if (!edited) return
    const followable = pe.prescriptionSets.some((s) => {
      if (s.set_number <= edited.set_number) return false
      const sibling = s[field] ?? ''
      return sibling === '' || sibling === previousValue
    })
    if (!followable) return
    startTransition(async () => {
      const res = await autofillProgramExerciseSetColumnAction(
        clientId,
        dayId,
        pe.id,
        field,
        value,
        previousValue,
        edited.set_number,
      )
      // Best-effort sugar: on failure the sibling cells simply keep their
      // current values (the pre-autofill behaviour) — nothing the EP typed
      // is lost, so no error UI beyond the console.
      if (res.error) console.error(res.error)
    })
  }

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
      <VolumeColumnDropdown
        peId={pe.id}
        clientId={clientId}
        dayId={dayId}
        repMetric={columnRepMetric}
      />
      <MetricColumnDropdown
        peId={pe.id}
        clientId={clientId}
        dayId={dayId}
        metric={columnMetric}
        metricUnits={metricUnits}
      />

      {pe.prescriptionSets.map((set) => (
        <SetRow key={set.id} set={set} onCommitted={handleCellCommitted} />
      ))}
    </div>
  )
}

function SetRow({
  set,
  onCommitted,
}: {
  set: PrescriptionSet
  onCommitted: (
    setId: string,
    field: AutofillableSetField,
    value: string,
    previousValue: string,
  ) => void
}) {
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
        onCommitted={(field, value, previous) =>
          onCommitted(set.id, field, value, previous)
        }
      />
      <SetCell
        setId={set.id}
        field="optional_value"
        initialValue={set.optional_value ?? ''}
        placeholder="—"
        onCommitted={(field, value, previous) =>
          onCommitted(set.id, field, value, previous)
        }
      />
    </>
  )
}

function SetCell({
  setId,
  field,
  initialValue,
  placeholder,
  onCommitted,
}: {
  setId: string
  field: AutofillableSetField
  initialValue: string
  placeholder?: string
  /** Fires after a successful save of a non-empty value — column autofill.
   *  previousValue is the server value the edit replaced, so the action
   *  can carry along siblings still holding it. */
  onCommitted?: (
    field: AutofillableSetField,
    value: string,
    previousValue: string,
  ) => void
}) {
  const [value, setValue] = useState(initialValue)
  // Last server value this cell knows — moves on its OWN successful save.
  // Single-cell saves keep the prop stale on purpose (no revalidate), so
  // after a save this deliberately runs ahead of initialValue.
  const [serverValue, setServerValue] = useState(initialValue)
  // The prop value this cell last reconciled with. Only a CHANGE in the
  // prop (a genuine revalidate — e.g. a sibling's autofill) is server
  // news; prop ≠ serverValue alone is not, it's the normal stale-prop
  // state after an own save. Comparing against serverValue here was the
  // 2026-07-03 revert bug: an own save made the stale prop look like
  // fresh data and snapped the cell back to its pre-edit value.
  const [lastSeenProp, setLastSeenProp] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  // Phase I §2.16: bumped on each successful save. Re-keyed SaveTick
  // remounts and the keyframe runs once. No setTimeout, no cleanup.
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()
  const locked = useSessionLocked()
  const empty = value.trim() === ''

  if (initialValue !== lastSeenProp) {
    if (initialValue === serverValue) {
      // The revalidate caught up with this cell's own save — resync the
      // baseline, nothing to adopt.
      setLastSeenProp(initialValue)
    } else if (
      !focused &&
      status === 'idle' &&
      value === serverValue &&
      serverValue === lastSeenProp
    ) {
      // Genuine refresh over an untouched cell (no own save since the
      // last sync) — adopt it, e.g. a sibling's autofill filled this cell.
      setLastSeenProp(initialValue)
      setServerValue(initialValue)
      setValue(initialValue)
    }
    // Otherwise hold: the cell is focused (re-checked on the blur render)
    // or has its own newer save in flight relative to this payload — a
    // stale payload must never overwrite what the EP just did.
  }

  function handleBlur() {
    if (value === serverValue) return
    const trimmed = value.trim()
    const previous = serverValue
    const patch: ProgramExerciseSetPatch = {
      [field]: trimmed === '' ? null : trimmed,
    }
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseSetAction(setId, patch)
      if (res.error) {
        // G-8: never leave a local value the database doesn't hold —
        // revert to the last-known server value and flag the cell. The
        // border clears on the next keystroke.
        setValue(previous)
        setStatus('error')
      } else {
        setStatus('idle')
        // Normalise display to what was saved so the dirty check stays
        // meaningful (" 8 " saved as "8").
        setValue(trimmed)
        setServerValue(trimmed)
        setSavedAt((n) => n + 1)
        if (trimmed !== '') onCommitted?.(field, trimmed, previous)
      }
    })
  }

  // Locked: static value in the same cell box, no input.
  if (locked) {
    return (
      <div
        style={{
          background: CREAM,
          borderRadius: 8,
          height: 26,
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          color: empty ? FAINT : INK,
          padding: '0 10px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {empty ? placeholder ?? '—' : value}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        title={
          status === 'error'
            ? 'Save failed — value reverted. Edit to try again.'
            : undefined
        }
        onChange={(e) => {
          setValue(e.target.value)
          if (status === 'error') setStatus('idle')
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          handleBlur()
        }}
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
  const locked = useSessionLocked()
  // Legacy-value fallback: same pattern as SectionTitleField from Phase E.
  // If the saved metric isn't in the org's current list (renamed,
  // soft-deleted, etc.), keep it as a selectable option so the closed
  // state doesn't silently drop to "—".
  const metricInOptions =
    metric !== '' && metricUnits.some((u) => u.code === metric)

  // Locked: static column header, no dropdown.
  if (locked) {
    const label =
      metric === ''
        ? 'Load / Notes'
        : metricUnits.find((u) => u.code === metric)?.display_label ?? metric
    return <ColHeader>{label}</ColHeader>
  }

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
        notify(res.error)
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

/**
 * The Reps column HEADER is the volume-unit picker (Reps / Seconds / Metres) —
 * the volume-axis sibling of MetricColumnDropdown. Picking a unit writes
 * rep_metric to every set via the column-wide updateProgramExerciseRepMetricAction,
 * so a timed hold / distance carry logs in its own unit and the Load column
 * stays free for weight. Closed state shows the unit (default "Reps"). Same
 * black-slab styling as the load-metric header so the columns read
 * symmetrically. VOLUME_UNIT_OPTIONS is the single source (shared with the
 * library form + portal logger).
 */
function VolumeColumnDropdown({
  peId,
  clientId,
  dayId,
  repMetric,
}: {
  peId: string
  clientId: string
  dayId: string
  repMetric: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const locked = useSessionLocked()
  // Legacy-value fallback (mirrors MetricColumnDropdown): a saved unit not in
  // the surfaced options (e.g. km/mi) stays selectable so the closed state
  // doesn't silently drop to a different unit.
  const repMetricInOptions = VOLUME_UNIT_OPTIONS.some(
    (u) => u.value === repMetric,
  )

  // Locked: static column header, no dropdown.
  if (locked) {
    const label =
      VOLUME_UNIT_OPTIONS.find((u) => u.value === repMetric)?.label ??
      (repMetric === '' ? 'Reps' : volumeUnitLabel(repMetric))
    return <ColHeader>{label}</ColHeader>
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === '' ? null : e.target.value
    startTransition(async () => {
      const res = await updateProgramExerciseRepMetricAction(
        clientId,
        dayId,
        peId,
        next,
      )
      if (res.error) {
        notify(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ position: 'relative', height: 26 }}>
      <select
        value={repMetric}
        onChange={handleChange}
        disabled={pending}
        aria-label="Measure — reps, seconds, or metres"
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
        {VOLUME_UNIT_OPTIONS.map((u) => (
          <option key={u.value || 'reps'} value={u.value}>
            {u.label}
          </option>
        ))}
        {!repMetricInOptions && repMetric !== '' && (
          <option value={repMetric}>{volumeUnitLabel(repMetric)}</option>
        )}
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
  const locked = useSessionLocked()
  const current = pe.prescriptionSets.length

  // Locked: show the set count, drop the add/remove steppers.
  if (locked) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          marginTop: 8,
          alignSelf: 'flex-end',
        }}
      >
        <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
          {current} {current === 1 ? 'set' : 'sets'}
        </span>
      </div>
    )
  }

  function handleAdd() {
    startTransition(async () => {
      const res = await addProgramExerciseSetAction(clientId, dayId, pe.id)
      if (res.error) {
        notify(res.error)
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
        notify(res.error)
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
  const locked = useSessionLocked()
  const empty = value.trim() === ''

  // Locked: label + static value, no input.
  if (locked) {
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
        <div
          style={{
            width: '100%',
            height: 28,
            padding: '0 8px',
            background: CREAM,
            borderRadius: 6,
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            fontWeight: 500,
            color: empty ? FAINT : INK,
            display: 'grid',
            placeItems: 'center',
            boxSizing: 'border-box',
          }}
        >
          {empty ? '—' : value}
        </div>
      </label>
    )
  }

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
        // G-8: revert to the last-known server value; never leave a
        // local value the database doesn't hold.
        setValue(initialValue)
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
          title={
            status === 'error'
              ? 'Save failed — value reverted. Edit to try again.'
              : undefined
          }
          onChange={(e) => {
            setValue(e.target.value)
            if (status === 'error') setStatus('idle')
          }}
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
  // Append the volume-unit suffix so a timed/distance set reads "3 × 30s" /
  // "3 × 20m" rather than a bare count.
  const reps: number[] = []
  for (const s of sets) if (s.repsPerformed !== null) reps.push(s.repsPerformed)
  let countLabel: string
  if (reps.length > 0) {
    const min = Math.min(...reps)
    const max = Math.max(...reps)
    const suffix = volumeUnitSuffix(sets[0]?.repMetric ?? null)
    countLabel = `${N} × ${min === max ? min : `${min}-${max}`}${suffix}`
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
  const locked = useSessionLocked()

  // Locked: no insertion / superset affordances at all.
  if (locked) return null

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
        background: active ? 'var(--color-slate)' : 'var(--color-card)',
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
  const locked = useSessionLocked()

  // Locked: static text block, no textarea. Preserves line breaks.
  if (locked) {
    const emptyText = value.trim() === ''
    return (
      <div
        style={{
          background: CREAM,
          borderRadius: 8,
          padding: '10px 12px',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          lineHeight: 1.5,
          color: emptyText ? FAINT : INK,
          fontWeight: 400,
          width: '100%',
          minHeight: 60,
          boxSizing: 'border-box',
          whiteSpace: 'pre-wrap',
        }}
      >
        {emptyText ? '—' : value}
      </div>
    )
  }

  function handleBlur() {
    if (value === initialValue) return
    const patch: ProgramExercisePatch = {
      [field]: value.trim() === '' ? null : value,
    } as ProgramExercisePatch
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseAction(programExerciseId, patch)
      if (res.error) {
        // G-8: revert to the last-known server value; never leave a
        // local value the database doesn't hold.
        setValue(initialValue)
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
        title={
          status === 'error'
            ? 'Save failed — text reverted. Edit to try again.'
            : undefined
        }
        onChange={(e) => {
          setValue(e.target.value)
          if (status === 'error') setStatus('idle')
        }}
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
  const locked = useSessionLocked()

  // Sync local state when the server pushes a new initialValue — happens
  // when a sibling in our superset group adopts a section title via
  // updateSectionTitleAction's fan-out path. Without this, useState only
  // honours initialValue on the first render and the prop change is
  // silently ignored, leaving siblings showing stale "(— Section —)".
  // Skip while the user is mid-create to not blow away their draft.
  useEffect(() => {
    if (mode === 'creating') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop->state sync for the superset-sibling section-title fan-out, guarded against mid-create; the effect's `mode` dep provides the on-exit catch-up. Locked component — deliberately not converted to a render-phase rewrite.
    setValue(initialValue)
  }, [initialValue, mode])

  // Render a legacy free-text option when the saved value isn't in the
  // org's section_titles list. Without this the <select> would silently
  // reset on first render to the empty option.
  const valueInOptions = value !== '' && options.some((o) => o.name === value)

  // Locked: static section eyebrow when one is set, nothing when blank.
  if (locked) {
    if (value === '') return null
    return (
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: 12,
        }}
      >
        {value}
      </div>
    )
  }

  function applyValue(next: string) {
    if (locked) return
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
        notify(addRes.error)
      }
      if (updateRes.error) {
        notify(updateRes.error)
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
      {/* §6.5.1 (G-10): "click ✘ (always red) to clear" — renders only
          while a title is set; the dropdown's "(— Section —)" option
          remains as the keyboard path to the same clear. */}
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


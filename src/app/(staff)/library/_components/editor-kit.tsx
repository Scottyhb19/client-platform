'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  VOLUME_UNIT_OPTIONS,
  volumeUnitLabel,
} from '@/lib/prescription/volume-units'
import { notify } from '@/app/(staff)/_components/Notice'

/*
 * Editor kit — the shared, client-agnostic card atoms behind the in-Library
 * editors (circuits, and — A-1/A-2 of docs/polish/library-sessions-programs.md —
 * sessions & program templates). These were carbon-copied into the circuit
 * editor from the session builder ("NEXT focused pass" 2026-06-24); this module
 * is the de-duplication of that copy. Each atom that persists is parameterised
 * over an `onCommit` callback, so a consumer supplies its own server action
 * while the autosave UX (idle/saving/error revert + green tick), the save-status
 * pill, the black-slab dropdowns, the set table, and the drag scaffolding stay
 * identical across every editor.
 *
 * SessionBuilder.tsx is deliberately NOT a consumer — it keeps its own inline
 * copy untouched (the protected differentiator). The grouping engine (solo /
 * superset / sections / insert bars) is cloned per-consumer, not shared here.
 *
 * The styling constants are aliases for design-system tokens (globals.css), not
 * raw values — copied verbatim from SessionBuilder.tsx:86-92 so the surfaces stay
 * pixel-identical.
 */
export const INK = 'var(--color-primary)'
export const CREAM = 'var(--color-surface)'
export const CREAM_DEEP = 'var(--color-surface-2)'
export const BORDER = 'var(--color-border-hairline)'
export const MUTED = 'var(--color-muted)'
export const FAINT = 'var(--color-text-faint)'
export const GREEN = 'var(--color-accent)'

/** Structural shape of one prescription set row. Consumers' richer set types
 * (e.g. the circuit editor's EditorSet) are assignable to this by duck typing. */
export type PrescriptionSet = {
  id: string
  set_number: number
  reps: string | null
  rep_metric: string | null
  optional_metric: string | null
  optional_value: string | null
}
export type MetricUnit = { code: string; display_label: string }

/** The two per-set value columns the downward autofill applies to. */
export type AutofillableSetField = 'reps' | 'optional_value'

/* ====================== Save-status reporter ======================
 * Autosave is silent except for the per-field green tick, which left the EP
 * unsure their work had persisted before leaving the page. A shared counter
 * tracks every in-flight save (text edits, dropdowns, stepper, structural
 * actions); the header pill reads "Saving…" while any is pending and
 * "All changes saved" when the queue is empty. Every mutating call routes
 * through `run()` so the indicator can never silently fall out of sync.
 */
export type SaveResult = { error: string | null }
export type SaveRun = (p: Promise<SaveResult>) => Promise<SaveResult>
export type SaveStatusValue = {
  pending: number
  error: boolean
  // false until the first save fires, so the pill stays hidden on a freshly
  // loaded page (nothing has been saved yet — showing "All changes saved"
  // there reads as a lie). Once true it stays true for the page's lifetime.
  touched: boolean
  run: SaveRun
}

export const SaveStatusContext = createContext<SaveStatusValue | null>(null)

const passthroughRun: SaveRun = (p) => p

export function useSaveRun(): SaveRun {
  return useContext(SaveStatusContext)?.run ?? passthroughRun
}

/**
 * Owns the save-status state. The consumer calls this once, provides `value`
 * through SaveStatusContext, and uses `run` for any top-level saves (e.g. the
 * editor's name field) that sit above the provider's own children.
 */
export function useSaveStatus(): { value: SaveStatusValue; run: SaveRun } {
  const [pending, setPending] = useState(0)
  const [error, setError] = useState(false)
  const [touched, setTouched] = useState(false)
  const run = useCallback<SaveRun>((p) => {
    setTouched(true)
    setPending((n) => n + 1)
    return p
      .then((res) => {
        setError(Boolean(res.error))
        return res
      })
      .catch((e) => {
        setError(true)
        throw e
      })
      .finally(() => setPending((n) => Math.max(0, n - 1)))
  }, [])
  const value = useMemo<SaveStatusValue>(
    () => ({ pending, error, touched, run }),
    [pending, error, touched, run],
  )
  return { value, run }
}

export function SaveStatusPill() {
  const ctx = useContext(SaveStatusContext)
  if (!ctx) return null
  // Nothing to reassure about until the EP has actually changed something.
  if (!ctx.touched) return null

  let label: string
  let color: string
  let dot: React.ReactNode = null
  if (ctx.pending > 0) {
    label = 'Saving…'
    color = MUTED
  } else if (ctx.error) {
    label = 'Save failed — retry the highlighted field'
    color = 'var(--color-alert)'
  } else {
    label = 'All changes saved'
    color = GREEN
    dot = <Check size={13} strokeWidth={2.5} aria-hidden />
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: 'var(--font-sans)',
        fontSize: '.78rem',
        fontWeight: 500,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      {dot}
      {label}
    </div>
  )
}

/* ====================== Drag scaffolding ======================
 * The 6-dot grip lives inside the card body, several layers below the card div
 * that owns the useSortable lifecycle. SortableCardShell publishes the handle
 * props via context; <DragHandle/> consumes them — same bridge the builder uses,
 * avoiding prop-drilling through the card body.
 */
export type DragHandleApi = {
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
  setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef']
}
export const DragHandleContext = createContext<DragHandleApi | null>(null)

/**
 * Wraps a white card div with @dnd-kit's useSortable and publishes the
 * drag-handle props via context. Carbon-copied from the builder's
 * SortableCardShell, keyed by the row id.
 */
export function SortableCardShell({
  id,
  layoutStyle,
  children,
}: {
  id: string
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
  } = useSortable({ id })

  const handle = useMemo<DragHandleApi>(
    () => ({ attributes, listeners, setActivatorNodeRef }),
    [attributes, listeners, setActivatorNodeRef],
  )

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
 * The 6-dot grip — an active drag activator (keyboard- + SR-friendly button),
 * reading useSortable's props from context. touchAction:'none' is load-bearing
 * on touch devices so the TouchSensor wins over native scroll.
 */
export function DragHandle() {
  const ctx = useContext(DragHandleContext)
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

/** Translucent card that follows the cursor while dragging — name only. */
export function DraggedCardGhost({ name }: { name: string }) {
  return (
    <div
      style={{
        background: 'var(--color-card)',
        border: `1px solid ${BORDER}`,
        borderRadius: 'var(--radius-card-dense)',
        padding: '10px 14px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
        cursor: 'grabbing',
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
        {name}
      </div>
    </div>
  )
}

export function SpineLetter({ children }: { children: React.ReactNode }) {
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

/* ====================== Set table ====================== */

export function ColHeader({
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
 * The reps + load grid. Column-level metrics read from the first live set and
 * are kept in sync across rows by the bulk rep-metric / load-metric writers.
 * Persistence is delegated to the consumer's commit callbacks.
 */
export function SetTable({
  sets,
  metricUnits,
  onRepsCommit,
  onValueCommit,
  onRepMetricCommit,
  onMetricCommit,
  onAutofill,
}: {
  sets: PrescriptionSet[]
  metricUnits: MetricUnit[]
  onRepsCommit: (setId: string, next: string | null) => Promise<SaveResult>
  onValueCommit: (setId: string, next: string | null) => Promise<SaveResult>
  onRepMetricCommit: (next: string | null) => Promise<SaveResult>
  onMetricCommit: (next: string | null) => Promise<SaveResult>
  /** Consumer's bulk column-autofill action (fills below the edited set,
   *  server-side guards) — see the SessionBuilder rule this clones. */
  onAutofill: (
    field: AutofillableSetField,
    value: string,
    previousValue: string,
    belowSetNumber: number,
  ) => Promise<SaveResult>
}) {
  const columnMetric = sets[0]?.optional_metric ?? ''
  const columnRepMetric = sets[0]?.rep_metric ?? ''
  const run = useSaveRun()
  const [, startTransition] = useTransition()

  // Column autofill — the session builder's downward follow-the-value rule
  // cloned onto the kit grid: a committed value follows into the cells
  // BELOW the edited set that are empty or still hold its previous value;
  // sets above and customised values never move (so 8/6/4 enters top-down
  // and wave loading survives). This props check only skips the round-trip
  // when nothing below could follow; the authoritative below / empty /
  // matches-previous filters run server-side in the consumer's action.
  function handleCellCommitted(
    setNumber: number,
    field: AutofillableSetField,
    value: string,
    previousValue: string,
  ) {
    const followable = sets.some((s) => {
      if (s.set_number <= setNumber) return false
      const sibling = s[field] ?? ''
      return sibling === '' || sibling === previousValue
    })
    if (!followable) return
    startTransition(async () => {
      // Through run() so the save pill covers the fill like any autosave.
      // On failure the sibling cells simply keep their current values —
      // nothing the EP typed is lost.
      await run(onAutofill(field, value, previousValue, setNumber))
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
        repMetric={columnRepMetric}
        onCommit={onRepMetricCommit}
      />
      <MetricColumnDropdown
        metric={columnMetric}
        metricUnits={metricUnits}
        onCommit={onMetricCommit}
      />

      {sets.map((set) => (
        <SetRow
          key={set.id}
          set={set}
          onRepsCommit={(next) => onRepsCommit(set.id, next)}
          onValueCommit={(next) => onValueCommit(set.id, next)}
          onCommitted={(field, value, previous) =>
            handleCellCommitted(set.set_number, field, value, previous)
          }
        />
      ))}
    </div>
  )
}

function SetRow({
  set,
  onRepsCommit,
  onValueCommit,
  onCommitted,
}: {
  set: PrescriptionSet
  onRepsCommit: (next: string | null) => Promise<SaveResult>
  onValueCommit: (next: string | null) => Promise<SaveResult>
  onCommitted: (
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
        initialValue={set.reps ?? ''}
        placeholder="—"
        onCommit={onRepsCommit}
        onCommitted={(value, previous) => onCommitted('reps', value, previous)}
      />
      <SetCell
        initialValue={set.optional_value ?? ''}
        placeholder="—"
        onCommit={onValueCommit}
        onCommitted={(value, previous) =>
          onCommitted('optional_value', value, previous)
        }
      />
    </>
  )
}

/**
 * One autosaving text cell. On blur, if the value changed, it calls onCommit
 * with the trimmed value (or null when emptied). On failure it reverts to the
 * last-known server value and flags the cell — never leaving a local value the
 * database doesn't hold.
 */
export function SetCell({
  initialValue,
  placeholder,
  onCommit,
  onCommitted,
}: {
  initialValue: string
  placeholder?: string
  onCommit: (next: string | null) => Promise<SaveResult>
  /** Fires after a successful save of a non-empty value — column autofill.
   *  previousValue is the server value the edit replaced. */
  onCommitted?: (value: string, previousValue: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  // Last server value this cell knows — moves on its OWN successful save,
  // running ahead of the prop until the revalidated payload arrives.
  const [serverValue, setServerValue] = useState(initialValue)
  // The prop value this cell last reconciled with. Only a CHANGE in the
  // prop (a revalidate — an own save landing, or a sibling's autofill) is
  // server news; prop ≠ serverValue alone is the normal stale window after
  // an own save. Keying adoption on serverValue instead was the
  // SessionBuilder revert bug (2026-07-03) — keep this clone in sync with
  // the builder's SetCell.
  const [lastSeenProp, setLastSeenProp] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()
  const run = useSaveRun()
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
    // or has its own newer save relative to this payload — a stale payload
    // must never overwrite what the EP just did.
  }

  function handleBlur() {
    if (value === serverValue) return
    const trimmed = value.trim()
    const previous = serverValue
    const next = trimmed === '' ? null : trimmed
    setStatus('saving')
    startTransition(async () => {
      const res = await run(onCommit(next))
      if (res.error) {
        setValue(previous)
        setStatus('error')
      } else {
        setStatus('idle')
        // Normalise display to what was saved so the dirty check stays
        // meaningful (" 8 " saved as "8").
        setValue(trimmed)
        setServerValue(trimmed)
        setSavedAt((n) => n + 1)
        if (trimmed !== '') onCommitted?.(trimmed, previous)
      }
    })
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
            status === 'error'
              ? '1px solid var(--color-alert)'
              : '1px solid transparent',
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
 * Per-field autosave success indicator. Renders nothing on first mount
 * (savedAt === 0); on each save the parent bumps savedAt, this remounts
 * (key={savedAt}) and the `save-tick` keyframe runs once.
 */
export function SaveTick({
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
 * The Reps column HEADER is the volume-unit picker (Reps / Seconds / Metres),
 * writing rep_metric to every set via the consumer's bulk commit. Same
 * black-slab styling as the load-metric header so the columns read symmetrically.
 */
export function VolumeColumnDropdown({
  repMetric,
  onCommit,
}: {
  repMetric: string
  onCommit: (next: string | null) => Promise<SaveResult>
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()
  const repMetricInOptions = VOLUME_UNIT_OPTIONS.some((u) => u.value === repMetric)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === '' ? null : e.target.value
    startTransition(async () => {
      const res = await run(onCommit(next))
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
        style={selectSlabStyle(pending)}
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
      <SlabChevron />
    </div>
  )
}

/**
 * The Load column HEADER is the load-unit picker (kg / lb / % / RPE / …),
 * writing optional_metric to every set via the consumer's bulk commit. A saved
 * unit not in the org's current list stays selectable (legacy-value fallback).
 */
export function MetricColumnDropdown({
  metric,
  metricUnits,
  onCommit,
}: {
  metric: string
  metricUnits: MetricUnit[]
  onCommit: (next: string | null) => Promise<SaveResult>
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()
  const metricInOptions =
    metric !== '' && metricUnits.some((u) => u.code === metric)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === '' ? null : e.target.value
    startTransition(async () => {
      const res = await run(onCommit(next))
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
        value={metric}
        onChange={handleChange}
        disabled={pending}
        aria-label="Load / Notes metric"
        style={selectSlabStyle(pending)}
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
      <SlabChevron />
    </div>
  )
}

/** Shared black-slab <select> styling for the two column-header dropdowns. */
export function selectSlabStyle(pending: boolean): React.CSSProperties {
  return {
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
  }
}

function SlabChevron() {
  return (
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
  )
}

/** − N sets + stepper. The consumer supplies add/remove; the kit owns the
 * "at least one set" floor and the pending lock, then refreshes on success
 * (the set count and any new row must re-read from the server). */
export function SetStepper({
  count,
  onAdd,
  onRemove,
}: {
  count: number
  onAdd: () => Promise<SaveResult>
  onRemove: () => Promise<SaveResult>
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()

  function handleAdd() {
    startTransition(async () => {
      const res = await run(onAdd())
      if (res.error) {
        notify(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleRemove() {
    if (count <= 1) return
    startTransition(async () => {
      const res = await run(onRemove())
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
        disabled={count <= 1 || pending}
        aria-label="Remove set"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          color: MUTED,
          cursor: count <= 1 ? 'not-allowed' : 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        −
      </button>
      <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
        {count} {count === 1 ? 'set' : 'sets'}
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

export function ExtrasRow({
  restSeconds,
  tempo,
  onRestCommit,
  onTempoCommit,
}: {
  restSeconds: number | null
  tempo: string | null
  onRestCommit: (next: number | null) => Promise<SaveResult>
  onTempoCommit: (next: string | null) => Promise<SaveResult>
}) {
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
        label="Rest (s)"
        kind="number"
        initialValue={restSeconds?.toString() ?? ''}
        onCommit={(next) => onRestCommit(next as number | null)}
      />
      <SmallField
        label="Tempo"
        kind="text"
        initialValue={tempo ?? ''}
        onCommit={(next) => onTempoCommit(next as string | null)}
      />
    </div>
  )
}

/**
 * A small labelled autosave field (rest, tempo, …). For kind="number" it parses
 * a non-negative integer and refuses to persist anything else (flags the cell,
 * no call). Empty commits null. The committed value is handed to onCommit typed
 * `string | number | null`; the consumer maps it onto its action's patch.
 */
export function SmallField({
  label,
  kind,
  initialValue,
  onCommit,
}: {
  label: string
  kind: 'number' | 'text'
  initialValue: string
  onCommit: (next: string | number | null) => Promise<SaveResult>
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()
  const run = useSaveRun()
  const empty = value.trim() === ''

  function handleBlur() {
    if (value === initialValue) return
    const trimmed = value.trim()
    let next: string | number | null
    if (trimmed === '') {
      next = null
    } else if (kind === 'number') {
      const n = parseInt(trimmed, 10)
      if (!Number.isFinite(n) || n < 0) {
        setStatus('error')
        return
      }
      next = n
    } else {
      next = trimmed
    }
    setStatus('saving')
    startTransition(async () => {
      const res = await run(onCommit(next))
      if (res.error) {
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
              status === 'error'
                ? '1px solid var(--color-alert)'
                : '1px solid transparent',
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

/* ====================== Editable instructions ====================== */

export function EditableTextarea({
  initialValue,
  placeholder,
  onCommit,
}: {
  initialValue: string
  placeholder?: string
  onCommit: (next: string | null) => Promise<SaveResult>
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState(0)
  const [, startTransition] = useTransition()
  const run = useSaveRun()

  function handleBlur() {
    if (value === initialValue) return
    // Preserve internal whitespace/newlines — only an all-blank value is null.
    const next = value.trim() === '' ? null : value
    setStatus('saving')
    startTransition(async () => {
      const res = await run(onCommit(next))
      if (res.error) {
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
            status === 'error'
              ? '1px solid var(--color-alert)'
              : '1px solid transparent',
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

export function IconButton({
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

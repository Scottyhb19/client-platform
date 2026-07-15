'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { SearchInput } from '@/app/(staff)/library/_components/SearchInput'
import { PatternChips } from '@/app/(staff)/library/_components/PatternChips'
import { TagChips } from '@/app/(staff)/library/_components/TagChips'
import { ExerciseGrid } from '@/app/(staff)/library/_components/ExerciseGrid'
import type { LibraryExercise } from '@/app/(staff)/library/types'
import {
  addExerciseToDayAction,
  swapProgramExerciseAction,
  type InsertSlot,
} from '../actions'
import { notify } from '@/app/(staff)/_components/Notice'

/**
 * Session-builder right-panel Library tab (§6.5.2).
 *
 * G-7 of the program-engine polish pass (2026-06-12): composes the shared
 * library atoms — SearchInput / PatternChips / TagChips / ExerciseGrid
 * with the onPick contract — instead of the inline fork that previously
 * lived inside SessionBuilder.tsx. One source of truth for search, chips,
 * and card content across the standalone library and this panel; the
 * panel keeps its multi-select filter model (AND across categories, OR
 * within — Q3 sign-off 2026-05-07) via the atoms' multiSelect mode
 * (Q-C sign-off). The brief's bottom-of-list "+ Create New Exercise"
 * (§6.6 / exercise-library G-11 rider) renders below the list.
 *
 * Pick semantics: an armed swap target wins over an armed insert slot
 * (mutually exclusive at the setter level upstream; the runtime check is
 * defensive). No armed state = append at end.
 */
export function LibraryPanel({
  options,
  clientId,
  dayId,
  insertSlot,
  setInsertSlot,
  exerciseNameById,
  movementPatterns,
  exerciseTags,
  swapTarget,
  setSwapTarget,
  onSwapComplete,
  locked = false,
}: {
  options: LibraryExercise[]
  clientId: string
  dayId: string
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  /** pe id → exercise name, for the swap/insert banner labels. */
  exerciseNameById: ReadonlyMap<string, string>
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  swapTarget: string | null
  setSwapTarget: (peId: string | null) => void
  /** Fires after a successful swap — §6.5.2: panel returns to Notes. */
  onSwapComplete: () => void
  /** Read-only lock — the session is completed. Browse stays live; picking
   *  an exercise (add/swap) is inert with an on-system notice. */
  locked?: boolean
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

  const filtersActive = selectedPatternIds.size > 0 || selectedTagIds.size > 0

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

  function handlePick(exerciseId: string) {
    // Read-only lock — the completed session's prescription is frozen. Browse
    // stays live for reference; adding/swapping is inert with a factual notice.
    if (locked) {
      notify('This session is locked — unassign it above to add or swap exercises.')
      return
    }
    if (adding !== null) return
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
          notify(res.error)
        } else {
          setSwapTarget(null)
          onSwapComplete()
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
        notify(res.error)
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
    const targetName = exerciseNameById.get(swapTarget)
    slotLabel = targetName ? `Replacing: ${targetName}` : 'Replacing exercise'
    cancelHandler = () => setSwapTarget(null)
  } else if (insertSlot?.kind === 'atStart') {
    slotLabel = 'Inserting at top'
    cancelHandler = () => setInsertSlot(null)
  } else if (insertSlot?.kind === 'after') {
    const anchorName = exerciseNameById.get(insertSlot.afterPeId)
    slotLabel = anchorName ? `Inserting after ${anchorName}` : 'Inserting at slot'
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
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border-hairline)',
            borderRadius: 6,
          }}
        >
          <span
            style={{
              flex: 1,
              fontFamily: 'var(--font-sans)',
              fontSize: '.76rem',
              fontWeight: 500,
              color: 'var(--color-primary)',
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
              color: 'var(--color-muted)',
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
      <PatternChips
        patterns={movementPatterns}
        multiSelect
        dense
        selectedIds={selectedPatternIds}
        onToggle={togglePattern}
      />

      <div style={{ marginTop: 8, marginBottom: 8 }}>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search exercises…"
          dense
        />
      </div>

      {/* Exercise-tag chips below the search. Multi-select; OR within.
          Tag filter is AND'd with the pattern filter (Q3 sign-off
          2026-05-07). */}
      <TagChips
        tags={exerciseTags}
        multiSelect
        dense
        selectedIds={selectedTagIds}
        onToggle={toggleTag}
      />

      {filtersActive && (
        <button
          type="button"
          onClick={resetFilters}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-muted)',
            fontSize: '.72rem',
            fontWeight: 500,
            cursor: 'pointer',
            padding: '2px 0',
            marginTop: 6,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          Reset filters
        </button>
      )}

      <div
        style={{
          marginTop: 10,
          maxHeight: 480,
          overflowY: 'auto',
          // Quiet the list while a pick is in flight — the action is
          // already running; a second click would double-add.
          opacity: adding !== null ? 0.55 : 1,
          pointerEvents: adding !== null ? 'none' : undefined,
        }}
      >
        <ExerciseGrid
          exercises={filtered}
          totalAvailable={options.length}
          onPick={handlePick}
          dense
        />

        {/* Bottom-of-list create CTA — brief §6.6 / exercise-library G-11
            rider. Suppressed alongside the grid's own empty-library state,
            which carries its own create CTA. returnTo brings the EP back
            to this builder after the save instead of dumping them in the
            library (dogfooding capture 2026-07-03). */}
        {options.length > 0 && (
          <Link
            href={`/library/new?returnTo=${encodeURIComponent(
              `/clients/${clientId}/program/days/${dayId}`,
            )}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 10,
              padding: '9px 0',
              border: '1px dashed var(--color-border-subtle)',
              borderRadius: 'var(--radius-button)',
              color: 'var(--color-text-light)',
              fontSize: '.8rem',
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            <Plus size={14} aria-hidden />
            Create New Exercise
          </Link>
        )}
      </div>
    </div>
  )
}

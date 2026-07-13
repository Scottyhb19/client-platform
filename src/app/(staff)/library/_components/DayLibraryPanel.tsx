'use client'

import { useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, X } from 'lucide-react'
import { SearchInput } from './SearchInput'
import { PatternChips } from './PatternChips'
import { TagChips } from './TagChips'
import { ExerciseGrid } from './ExerciseGrid'
import type { LibraryExercise } from '../types'
import { useSaveRun, type SaveResult } from './editor-kit'
import type { InsertSlot } from './DayContentEditor'
import { notify } from '@/app/(staff)/_components/Notice'

/**
 * Slot-aware Library picker for the in-Library day editors (sessions &
 * program templates). Cloned from the session builder's right-panel
 * LibraryPanel, with swap-in-place removed (the editors add via the picker
 * and remove via the card's trash — same as the circuit editor). Composes
 * the shared library atoms (SearchInput / PatternChips / TagChips /
 * ExerciseGrid) so search + chips + card content match the standalone
 * library exactly.
 *
 * Pick semantics: an armed insert slot (from a between-cards "+ Add
 * exercise") targets the pick; no armed slot = append at the end. The actual
 * write is the consumer's `onAdd` callback (a session/template add action),
 * so the panel is storage-agnostic.
 */
export function DayLibraryPanel({
  options,
  insertSlot,
  setInsertSlot,
  exerciseNameById,
  movementPatterns,
  exerciseTags,
  onAdd,
  createReturnTo,
}: {
  options: LibraryExercise[]
  insertSlot: InsertSlot | null
  setInsertSlot: (s: InsertSlot | null) => void
  /** exercise-row id → name, for the insert banner label. */
  exerciseNameById: ReadonlyMap<string, string>
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  onAdd: (exerciseId: string, slot: InsertSlot) => Promise<SaveResult>
  /** Override for the create-exercise CTA's returnTo (defaults to the
   *  hosting page's pathname). The program-template editor passes
   *  `?day=<template_day_id>` so the create action knows which of the
   *  template's days to append the new exercise to. */
  createReturnTo?: string
}) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  // Chip filter state. Multi-select within each category. AND across
  // categories, OR within (same model as the builder's panel).
  const [selectedPatternIds, setSelectedPatternIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [, startTransition] = useTransition()
  const router = useRouter()
  const run = useSaveRun()
  // The hosting editor's path (a session or program-template editor) — the
  // create-exercise CTA returns here after the save instead of dumping the
  // EP in the library (parity with the session builder's panel).
  const pathname = usePathname()

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
    if (adding !== null) return
    setAdding(exerciseId)
    const slot: InsertSlot = insertSlot ?? { kind: 'append' }
    startTransition(async () => {
      const res = await run(onAdd(exerciseId, slot))
      if (res.error) {
        notify(res.error)
      } else {
        setInsertSlot(null)
        router.refresh()
      }
      setAdding(null)
    })
  }

  // Slot status banner — the label tells the EP exactly what the next pick
  // will do; Cancel returns to default (append at the end).
  let slotLabel: string | null = null
  if (insertSlot?.kind === 'atStart') {
    slotLabel = 'Inserting at top'
  } else if (insertSlot?.kind === 'after') {
    const anchorName = exerciseNameById.get(insertSlot.afterId)
    slotLabel = anchorName ? `Inserting after ${anchorName}` : 'Inserting at slot'
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
            onClick={() => setInsertSlot(null)}
            aria-label="Cancel insert"
            title="Cancel insert"
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

      {/* Exercise-tag chips below the search. Multi-select; OR within;
          AND'd with the pattern filter. */}
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
          // Quiet the list while a pick is in flight — a second click would
          // double-add.
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

        {options.length > 0 && (
          <Link
            href={`/library/new?returnTo=${encodeURIComponent(createReturnTo ?? pathname)}`}
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

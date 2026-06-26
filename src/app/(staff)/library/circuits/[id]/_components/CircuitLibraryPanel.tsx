'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { SearchInput } from '@/app/(staff)/library/_components/SearchInput'
import { PatternChips } from '@/app/(staff)/library/_components/PatternChips'
import { TagChips } from '@/app/(staff)/library/_components/TagChips'
import { ExerciseGrid } from '@/app/(staff)/library/_components/ExerciseGrid'
import type { LibraryExercise } from '@/app/(staff)/library/types'
import { addExerciseToCircuitAction } from '../../../circuit-actions'
import { notify } from '@/app/(staff)/_components/Notice'

/**
 * Circuit-editor right-panel Library tab — a carbon-copy of the session
 * builder's LibraryPanel (clients/.../_components/LibraryPanel.tsx) composing
 * the same shared atoms (SearchInput / PatternChips / TagChips / ExerciseGrid),
 * so search, chips, and card content read identically across both surfaces.
 *
 * Deliberately a duplicate, not a generalisation of LibraryPanel: that panel is
 * wired to the program-day insert-slot / swap machinery (a load-bearing part of
 * the differentiator), and the standing decision is to copy rather than refactor
 * shared builder code. The circuit picker is simpler — no insert slots, no swap,
 * no "armed" banner: picking an exercise always appends it to the circuit
 * (addExerciseToCircuitAction → MAX(sort_order)+1).
 */
export function CircuitLibraryPanel({
  options,
  circuitId,
  movementPatterns,
  exerciseTags,
}: {
  options: LibraryExercise[]
  circuitId: string
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
}) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  // Chip filter state. Multi-select within each category. AND across
  // categories, OR within — same model as the builder's LibraryPanel.
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
    if (adding !== null) return
    setAdding(exerciseId)
    startTransition(async () => {
      const res = await addExerciseToCircuitAction(circuitId, exerciseId)
      if (res.error) {
        notify(res.error)
      } else {
        router.refresh()
      }
      setAdding(null)
    })
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Library — pick to add
      </div>

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

      {/* Exercise-tag chips below the search. Multi-select; OR within; AND'd
          with the pattern filter. */}
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
          // Quiet the list while a pick is in flight — the action is already
          // running; a second click would double-add.
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

        {/* Bottom-of-list create CTA — mirrors the builder's panel. */}
        {options.length > 0 && (
          <Link
            href="/library/new"
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

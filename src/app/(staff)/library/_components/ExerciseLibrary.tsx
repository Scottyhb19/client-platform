'use client'

import { useMemo, useState } from 'react'
import type { LibraryExercise, Pattern, Tag } from '../types'
import { ExerciseGrid } from './ExerciseGrid'
import { PatternChips } from './PatternChips'
import { SearchInput } from './SearchInput'
import { TagChips } from './TagChips'

interface ExerciseLibraryProps {
  exercises: LibraryExercise[]
  patterns: Pattern[]
  tags: Tag[]
}

/**
 * Standalone library composer: search + pattern chips + tag chips + grid.
 * Card click → /library/[id]; CardMenu top-right per card. The session-
 * builder Library tab will compose the same atoms with an `onPick` handler
 * passed through to ExerciseGrid → ExerciseCard instead of the Link path.
 */
export function ExerciseLibrary({
  exercises,
  patterns,
  tags,
}: ExerciseLibraryProps) {
  const [query, setQuery] = useState('')
  const [patternId, setPatternId] = useState<string | null>(null)
  const [tagId, setTagId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return exercises.filter((e) => {
      if (patternId && e.movement_pattern_id !== patternId) return false
      if (tagId && !e.tag_ids.includes(tagId)) return false
      if (!q) return true
      return e.name.toLowerCase().includes(q)
    })
  }, [exercises, query, patternId, tagId])

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <SearchInput value={query} onChange={setQuery} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <PatternChips
          patterns={patterns}
          selectedId={patternId}
          onChange={setPatternId}
        />
      </div>
      <div style={{ marginBottom: 20 }}>
        <TagChips tags={tags} selectedId={tagId} onChange={setTagId} />
      </div>

      <ExerciseGrid
        exercises={filtered}
        totalAvailable={exercises.length}
      />
    </>
  )
}

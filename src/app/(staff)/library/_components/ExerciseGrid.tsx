'use client'

import Link from 'next/link'
import type { LibraryExercise } from '../types'
import { ExerciseCard } from './ExerciseCard'

interface ExerciseGridProps {
  exercises: LibraryExercise[]
  /** Total before filters were applied — drives "empty library" vs "no
   *  matches". Standalone library passes the unfiltered count; pickers
   *  can pass exercises.length to suppress the empty-library CTA. */
  totalAvailable: number
  onPick?: (exerciseId: string) => void
}

export function ExerciseGrid({
  exercises,
  totalAvailable,
  onPick,
}: ExerciseGridProps) {
  if (totalAvailable === 0) return <EmptyState />

  if (exercises.length === 0) {
    return (
      <div
        className="card"
        style={{
          padding: '28px',
          textAlign: 'center',
          color: 'var(--color-text-light)',
          fontSize: '.88rem',
        }}
      >
        No exercises match your search. Try clearing filters.
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 14,
      }}
    >
      {exercises.map((e) => (
        <ExerciseCard key={e.id} exercise={e} onPick={onPick} />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="card"
      style={{
        padding: '44px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.2rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        Your library is empty
      </div>
      <p
        style={{
          fontSize: '.9rem',
          margin: '0 auto 18px',
          lineHeight: 1.6,
          maxWidth: 420,
        }}
      >
        Sets, reps, load, RPE — defaults that auto-populate every prescription.
        Optional video link and tags.
      </p>
      <Link href="/library/new" className="btn primary">
        Create your first exercise
      </Link>
    </div>
  )
}

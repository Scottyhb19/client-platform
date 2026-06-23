'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ExerciseLibrary } from './ExerciseLibrary'
import { ProgramsTab } from './ProgramsTab'
import { CircuitsTab } from './CircuitsTab'
import { SessionsTab } from './SessionsTab'
import type {
  CircuitSummary,
  ClientOption,
  LibraryExercise,
  Pattern,
  ProgramTemplateSummary,
  SessionTemplateSummary,
  Tag,
} from '../types'

type Section = 'exercises' | 'circuits' | 'sessions' | 'programs'

const SECTIONS: Array<{ key: Section; label: string }> = [
  { key: 'exercises', label: 'Exercises' },
  { key: 'circuits', label: 'Circuits' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'programs', label: 'Programs' },
]

interface LibraryViewProps {
  exercises: LibraryExercise[]
  patterns: Pattern[]
  tags: Tag[]
  programTemplates: ProgramTemplateSummary[]
  circuits: CircuitSummary[]
  sessions: SessionTemplateSummary[]
  clients: ClientOption[]
  total: number
  patternCount: number
}

/**
 * Library is a building-blocks container: exercises, circuits, saved
 * sessions, and program templates. Only the Exercises tab is live —
 * the others scaffold for when Session Builder + Program engine ship.
 */
export function LibraryView({
  exercises,
  patterns,
  tags,
  programTemplates,
  circuits,
  sessions,
  clients,
  total,
  patternCount,
}: LibraryViewProps) {
  const [section, setSection] = useState<Section>('exercises')

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {sectionEyebrow(section, { total, patternCount })}
          </div>
          <h1>Library</h1>
          <div className="sub">{sectionSub(section)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <HeaderActions section={section} />
        </div>
      </div>

      {/* Sub-section tabs */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          borderBottom: '1px solid var(--color-border-subtle)',
          margin: '0 0 24px',
        }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            style={{
              padding: '10px 18px',
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${
                section === s.key ? 'var(--color-primary)' : 'transparent'
              }`,
              marginBottom: -1,
              color:
                section === s.key
                  ? 'var(--color-primary)'
                  : 'var(--color-text-light)',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: '.86rem',
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'exercises' && (
        <ExerciseLibrary
          exercises={exercises}
          patterns={patterns}
          tags={tags}
        />
      )}
      {section === 'circuits' && <CircuitsTab circuits={circuits} />}
      {section === 'sessions' && <SessionsTab sessions={sessions} />}
      {section === 'programs' && (
        <ProgramsTab templates={programTemplates} clients={clients} />
      )}
    </>
  )
}

function HeaderActions({ section }: { section: Section }) {
  if (section === 'exercises') {
    return (
      <Link href="/library/new" className="btn primary">
        <Plus size={14} aria-hidden />
        New exercise
      </Link>
    )
  }
  // Circuits, sessions, and programs are authored from their own tabs ("New
  // circuit" / "New session") or saved from real work ("Save as template" /
  // "Save as circuit" / "Save as session"), never via a header button here.
  return null
}

function sectionEyebrow(
  section: Section,
  ctx: { total: number; patternCount: number },
): string {
  if (section === 'exercises') {
    return ctx.total === 0
      ? 'No exercises yet'
      : `${ctx.total} ${ctx.total === 1 ? 'exercise' : 'exercises'}${
          ctx.patternCount > 0 ? ` · ${ctx.patternCount} movement patterns` : ''
        }`
  }
  return `${section.charAt(0).toUpperCase()}${section.slice(1)} library`
}

function sectionSub(section: Section): string {
  return {
    exercises:
      'Shared across all clients · defaults, tags, and video links.',
    circuits:
      'Reusable groups of exercises — supersets, trisets, finishers — dropped in by name when building sessions.',
    sessions:
      'Saved session layouts — recurring day templates you can apply to any client.',
    programs:
      'Training block templates — full week-by-week structures to apply to a new client.',
  }[section]
}


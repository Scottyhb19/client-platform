'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import {
  ExerciseLibrary,
  type LibraryExercise,
  type Pattern,
  type Tag,
} from './ExerciseLibrary'

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
      {section === 'circuits' && <CircuitsPlaceholder />}
      {section === 'sessions' && <SessionsPlaceholder />}
      {section === 'programs' && <ProgramsPlaceholder />}
    </>
  )
}

function HeaderActions({ section }: { section: Section }) {
  if (section === 'exercises') {
    return (
      <>
        <button type="button" className="btn outline" disabled>
          Import CSV
        </button>
        <Link href="/library/new" className="btn primary">
          <Plus size={14} aria-hidden />
          New exercise
        </Link>
      </>
    )
  }
  return (
    <button type="button" className="btn primary" disabled>
      <Plus size={14} aria-hidden />
      {section === 'circuits'
        ? 'New circuit'
        : section === 'sessions'
          ? 'Save session'
          : 'New program'}
    </button>
  )
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
      'Mesocycle templates — full week-by-week structures to apply to a new client.',
  }[section]
}

function CircuitsPlaceholder() {
  return (
    <PlaceholderCard
      title="Circuits land with Session Builder"
      body="Supersets, trisets, and finishers live here. When you build a superset in the Session Builder, you'll be able to 'save as circuit' so you can drop the same group into any future session with one click."
    />
  )
}

function SessionsPlaceholder() {
  return (
    <PlaceholderCard
      title="Sessions land after Session Builder"
      body="Once Session Builder is live, any finished session can be saved as a template — 'Day A — Lower', 'Return-to-sport assessment', 'Bone-loading circuit'. Drop the template into a new program day and it pre-fills."
    />
  )
}

function ProgramsPlaceholder() {
  return (
    <PlaceholderCard
      title="Program templates land with Program engine"
      body="Mesocycles you want to re-use across clients (e.g. '4-week strength base', '12-week ACL return-to-sport'). Apply to a new client with the start date and it scaffolds the whole calendar."
    />
  )
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
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
        {title}
      </div>
      <p
        style={{
          fontSize: '.92rem',
          margin: '0 auto',
          lineHeight: 1.6,
          maxWidth: 520,
        }}
      >
        {body}
      </p>
    </div>
  )
}

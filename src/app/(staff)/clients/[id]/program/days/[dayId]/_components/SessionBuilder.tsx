'use client'

import { useMemo, useState, useTransition } from 'react'
import { Play, Search, Trash2 } from 'lucide-react'
import {
  addExerciseToDayAction,
  removeProgramExerciseAction,
} from '../actions'

/*
 * Session Builder design constants (match .design-ref SessionBuilder.jsx).
 * Page stays on warm parchment; exercise cards are dark slabs that read
 * as strong horizontal objects on the page.
 */
const CARD_BG = '#1E1A18'
const CARD_INSET = '#15110F'
const CARD_BORDER = '#2A2522'
const CREAM = '#EDE8E2'
const MUTED = '#78746F'

export type ProgramExercise = {
  id: string
  sort_order: number
  section_title: string | null
  superset_group_id: string | null
  sets: number | null
  reps: string | null
  optional_value: string | null
  rpe: number | null
  rest_seconds: number | null
  instructions: string | null
  exercise_id: string
  exercise_name: string
  exercise_video_url: string | null
}

export type LibraryPick = {
  id: string
  name: string
  movement_pattern_name: string | null
}

export type PinnedNote = {
  id: string
  body: string
  flag_body_region: string | null
}

interface SessionBuilderProps {
  clientId: string
  dayId: string
  programExercises: ProgramExercise[]
  libraryOptions: LibraryPick[]
  pinnedNotes: PinnedNote[]
}

export function SessionBuilder({
  clientId,
  dayId,
  programExercises,
  libraryOptions,
  pinnedNotes,
}: SessionBuilderProps) {
  const [tab, setTab] = useState<'notes' | 'library'>('library')

  // Group exercises: rendered as flat list for C11a; supersets + section
  // headers wire in C11c.
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
          <div
            style={{
              border: '1px dashed var(--color-border-subtle)',
              borderRadius: 14,
              padding: '40px 24px',
              textAlign: 'center',
              color: 'var(--color-text-light)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '1.1rem',
                color: 'var(--color-charcoal)',
                marginBottom: 4,
              }}
            >
              No exercises yet
            </div>
            <p
              style={{
                fontSize: '.86rem',
                lineHeight: 1.55,
                margin: '0 auto',
                maxWidth: 360,
              }}
            >
              Pick exercises from the Library panel on the right. Defaults
              are copied in; you can tweak them per exercise in the next
              commit.
            </p>
          </div>
        ) : (
          programExercises.map((pe, i) => (
            <ExerciseSlab
              key={pe.id}
              pe={pe}
              letter={letterFor(i)}
              clientId={clientId}
              dayId={dayId}
            />
          ))
        )}
      </div>

      <aside style={{ position: 'sticky', top: 20 }}>
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: '#E2DDD7',
            padding: 3,
            borderRadius: 7,
            marginBottom: 14,
          }}
        >
          {(['notes', 'library'] as const).map((k) => (
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
                color: tab === k ? 'var(--color-primary)' : 'var(--color-text-light)',
                boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
                textTransform: 'capitalize',
              }}
            >
              {k}
            </button>
          ))}
        </div>

        {tab === 'library' ? (
          <LibraryPanel
            options={libraryOptions}
            clientId={clientId}
            dayId={dayId}
          />
        ) : (
          <NotesPanel notes={pinnedNotes} />
        )}
      </aside>
    </div>
  )
}

/* ====================== Left column: exercise slab ====================== */

function ExerciseSlab({
  pe,
  letter,
  clientId,
  dayId,
}: {
  pe: ProgramExercise
  letter: string
  clientId: string
  dayId: string
}) {
  const rx = buildRxString(pe)
  const [pending, startTransition] = useTransition()

  function handleRemove() {
    if (!confirm(`Remove ${pe.exercise_name} from this session?`)) return
    startTransition(async () => {
      await removeProgramExerciseAction(clientId, dayId, pe.id)
    })
  }

  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        padding: '18px 20px',
        marginBottom: 14,
        color: '#fff',
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr',
        gap: 22,
        opacity: pending ? 0.5 : 1,
        transition: 'opacity 150ms',
      }}
    >
      {/* LEFT: badge, name, instructions, media */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: CARD_INSET,
              border: `1px solid ${CARD_BORDER}`,
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--color-accent)',
              flexShrink: 0,
            }}
          >
            {letter}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 17,
              color: '#fff',
              flex: 1,
            }}
          >
            {pe.exercise_name}
          </span>
          <button
            type="button"
            onClick={handleRemove}
            aria-label="Remove exercise"
            disabled={pending}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer',
              padding: 4,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 4,
            }}
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: MUTED,
            marginBottom: 8,
          }}
        >
          Instructions
        </div>
        <div
          style={{
            background: CARD_INSET,
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.85)',
            fontWeight: 300,
            marginBottom: 14,
            minHeight: 52,
          }}
        >
          {pe.instructions || (
            <span style={{ color: MUTED, fontStyle: 'italic' }}>
              No cues — inherits from the library.
            </span>
          )}
        </div>

        {pe.exercise_video_url ? (
          <a
            href={pe.exercise_video_url}
            target="_blank"
            rel="noreferrer"
            style={{
              background: CARD_INSET,
              border: `1px solid ${CARD_BORDER}`,
              borderRadius: 10,
              height: 140,
              display: 'grid',
              placeItems: 'center',
              position: 'relative',
              textDecoration: 'none',
            }}
          >
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.9)',
                display: 'grid',
                placeItems: 'center',
                color: '#1E1A18',
              }}
            >
              <Play size={20} aria-hidden fill="currentColor" />
            </span>
            <span
              style={{
                position: 'absolute',
                bottom: 10,
                left: 14,
                fontSize: 12,
                color: MUTED,
              }}
            >
              Demo video
            </span>
          </a>
        ) : (
          <div
            style={{
              background: CARD_INSET,
              border: `1px dashed ${CARD_BORDER}`,
              borderRadius: 10,
              height: 64,
              display: 'grid',
              placeItems: 'center',
              fontSize: 12,
              color: MUTED,
            }}
          >
            No demo video linked
          </div>
        )}
      </div>

      {/* RIGHT: prescription */}
      <div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 18,
            color: '#fff',
            marginBottom: 12,
            letterSpacing: '.02em',
          }}
        >
          {rx}
        </div>

        <PrescriptionGrid pe={pe} />

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: MUTED,
            lineHeight: 1.5,
          }}
        >
          Inline editing (sets / reps / load / RPE / rest / tempo) lands in
          the next commit.
        </div>
      </div>
    </div>
  )
}

function PrescriptionGrid({ pe }: { pe: ProgramExercise }) {
  const rows: Array<[string, string]> = [
    ['Sets', pe.sets?.toString() ?? '—'],
    ['Reps', pe.reps ?? '—'],
    ['Load', pe.optional_value ?? '—'],
    ['RPE', pe.rpe?.toString() ?? '—'],
    ['Rest', pe.rest_seconds ? `${pe.rest_seconds}s` : '—'],
  ]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 6,
      }}
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            background: CARD_INSET,
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 8,
            padding: '8px 6px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: MUTED,
              marginBottom: 3,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: value === '—' ? MUTED : CREAM,
            }}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ====================== Right column: Library panel ====================== */

function LibraryPanel({
  options,
  clientId,
  dayId,
}: {
  options: LibraryPick[]
  clientId: string
  dayId: string
}) {
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.name.toLowerCase().includes(q))
  }, [options, query])

  function handleAdd(exerciseId: string) {
    setAdding(exerciseId)
    startTransition(async () => {
      const res = await addExerciseToDayAction(clientId, dayId, exerciseId)
      if (res.error) {
        alert(res.error)
      }
      setAdding(null)
    })
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        className="eyebrow"
        style={{ fontSize: '.66rem', marginBottom: 10 }}
      >
        Library — pick to add
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search
          size={14}
          aria-hidden
          style={{
            position: 'absolute',
            left: 10,
            top: 9,
            color: 'var(--color-muted)',
          }}
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
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 7,
            fontFamily: 'var(--font-sans)',
            fontSize: '.82rem',
            background: 'var(--color-surface)',
            outline: 'none',
          }}
        />
      </div>

      {options.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-muted)',
            padding: '12px 0',
            lineHeight: 1.5,
          }}
        >
          Your exercise library is empty. Add exercises in /library first,
          then come back here.
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-muted)',
            padding: '12px 0',
          }}
        >
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
                borderTop: '1px solid var(--color-border-subtle)',
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
                    color: 'var(--color-muted)',
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

/* ====================== Right column: Notes panel ====================== */

function NotesPanel({ notes }: { notes: PinnedNote[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        className="eyebrow"
        style={{ fontSize: '.66rem', marginBottom: 10 }}
      >
        Pinned clinical notes
      </div>
      {notes.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-muted)',
            lineHeight: 1.5,
          }}
        >
          No pinned notes for this client. Pin a note from the profile to
          have it visible here while you build the session.
        </div>
      ) : (
        notes.map((n) => (
          <div
            key={n.id}
            style={{
              background: 'rgba(214,64,69,.05)',
              borderLeft: '3px solid var(--color-alert)',
              padding: '8px 12px',
              borderRadius: '0 6px 6px 0',
              fontSize: '.78rem',
              lineHeight: 1.45,
              marginBottom: 6,
            }}
          >
            {n.flag_body_region && (
              <div
                style={{
                  fontSize: '.62rem',
                  fontWeight: 700,
                  color: 'var(--color-alert)',
                  textTransform: 'uppercase',
                  letterSpacing: '.04em',
                  marginBottom: 2,
                }}
              >
                {n.flag_body_region}
              </div>
            )}
            {n.body}
          </div>
        ))
      )}
    </div>
  )
}

/* ====================== Helpers ====================== */

function buildRxString(pe: ProgramExercise): string {
  const parts: string[] = []
  if (pe.sets && pe.reps) parts.push(`${pe.sets} × ${pe.reps}`)
  else if (pe.sets) parts.push(`${pe.sets} sets`)
  else if (pe.reps) parts.push(pe.reps)
  if (pe.optional_value) parts.push(pe.optional_value)
  if (pe.rpe) parts.push(`RPE ${pe.rpe}`)
  return parts.join(' · ') || 'No prescription yet'
}

function letterFor(index: number): string {
  return String.fromCharCode(65 + index)
}

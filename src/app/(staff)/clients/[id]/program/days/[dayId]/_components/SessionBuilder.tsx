'use client'

import { useMemo, useState, useTransition } from 'react'
import { Play, Search, Trash2 } from 'lucide-react'
import {
  addExerciseToDayAction,
  removeProgramExerciseAction,
  updateProgramExerciseAction,
  type ProgramExercisePatch,
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
  tempo: string | null
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
        <EditableTextarea
          programExerciseId={pe.id}
          field="instructions"
          initialValue={pe.instructions ?? ''}
          placeholder="No cues — inherits from the library."
        />
        <div style={{ marginBottom: 14 }} />

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

        <div style={{ marginTop: 10 }}>
          <EditableRow pe={pe} />
        </div>
      </div>
    </div>
  )
}

function PrescriptionGrid({ pe }: { pe: ProgramExercise }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 6,
      }}
    >
      <EditableCell
        programExerciseId={pe.id}
        field="sets"
        label="Sets"
        kind="number"
        initialValue={pe.sets?.toString() ?? ''}
        placeholder="—"
      />
      <EditableCell
        programExerciseId={pe.id}
        field="reps"
        label="Reps"
        kind="text"
        initialValue={pe.reps ?? ''}
        placeholder="—"
      />
      <EditableCell
        programExerciseId={pe.id}
        field="optional_value"
        label="Load"
        kind="text"
        initialValue={pe.optional_value ?? ''}
        placeholder="—"
      />
      <EditableCell
        programExerciseId={pe.id}
        field="rpe"
        label="RPE"
        kind="number"
        initialValue={pe.rpe?.toString() ?? ''}
        placeholder="—"
      />
      <EditableCell
        programExerciseId={pe.id}
        field="rest_seconds"
        label="Rest (s)"
        kind="number"
        initialValue={pe.rest_seconds?.toString() ?? ''}
        placeholder="—"
      />
    </div>
  )
}

function EditableRow({ pe }: { pe: ProgramExercise }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: 8,
      }}
    >
      <EditableInlineField
        programExerciseId={pe.id}
        field="tempo"
        label="Tempo"
        initialValue={pe.tempo ?? ''}
        placeholder="e.g. 3-1-1-0"
      />
    </div>
  )
}

/* ====================== Editable primitives ====================== */

type EditableField = keyof ProgramExercisePatch

function EditableCell({
  programExerciseId,
  field,
  label,
  kind,
  initialValue,
  placeholder,
}: {
  programExerciseId: string
  field: EditableField
  label: string
  kind: 'number' | 'text'
  initialValue: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [, startTransition] = useTransition()
  const empty = value.trim() === ''

  function handleBlur() {
    if (value === initialValue) return
    const patch = buildPatch(field, value, kind)
    if (patch === null) {
      setStatus('error')
      return
    }
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseAction(
        programExerciseId,
        patch,
      )
      setStatus(res.error ? 'error' : 'idle')
    })
  }

  return (
    <div
      style={{
        background: CARD_INSET,
        border: `1px solid ${
          status === 'error' ? '#B04040' : CARD_BORDER
        }`,
        borderRadius: 8,
        padding: '8px 6px',
        textAlign: 'center',
        transition: 'border-color 120ms',
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
        {status === 'saving' && (
          <span
            aria-hidden
            style={{ color: '#6B7A6B', marginLeft: 4 }}
            title="Saving"
          >
            •
          </span>
        )}
      </div>
      <input
        type={kind === 'number' ? 'number' : 'text'}
        inputMode={kind === 'number' ? 'numeric' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 14,
          fontWeight: 600,
          color: empty ? MUTED : CREAM,
          padding: 0,
        }}
      />
    </div>
  )
}

function EditableInlineField({
  programExerciseId,
  field,
  label,
  initialValue,
  placeholder,
}: {
  programExerciseId: string
  field: EditableField
  label: string
  initialValue: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [, startTransition] = useTransition()

  function handleBlur() {
    if (value === initialValue) return
    const patch: ProgramExercisePatch = {
      [field]: value.trim() === '' ? null : value.trim(),
    } as ProgramExercisePatch
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseAction(
        programExerciseId,
        patch,
      )
      setStatus(res.error ? 'error' : 'idle')
    })
  }

  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 1fr',
        gap: 10,
        alignItems: 'center',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: MUTED,
        }}
      >
        {label}
        {status === 'saving' && (
          <span
            aria-hidden
            style={{ color: '#6B7A6B', marginLeft: 4 }}
            title="Saving"
          >
            •
          </span>
        )}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          background: CARD_INSET,
          border: `1px solid ${
            status === 'error' ? '#B04040' : CARD_BORDER
          }`,
          borderRadius: 8,
          padding: '6px 10px',
          outline: 'none',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 500,
          color: value ? CREAM : MUTED,
          transition: 'border-color 120ms',
        }}
      />
    </label>
  )
}

function EditableTextarea({
  programExerciseId,
  field,
  initialValue,
  placeholder,
}: {
  programExerciseId: string
  field: EditableField
  initialValue: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initialValue)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [, startTransition] = useTransition()

  function handleBlur() {
    if (value === initialValue) return
    const patch: ProgramExercisePatch = {
      [field]: value.trim() === '' ? null : value,
    } as ProgramExercisePatch
    setStatus('saving')
    startTransition(async () => {
      const res = await updateProgramExerciseAction(
        programExerciseId,
        patch,
      )
      setStatus(res.error ? 'error' : 'idle')
    })
  }

  return (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      rows={3}
      style={{
        background: CARD_INSET,
        border: `1px solid ${
          status === 'error' ? '#B04040' : CARD_BORDER
        }`,
        borderRadius: 10,
        padding: '12px 14px',
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        lineHeight: 1.5,
        color: value ? 'rgba(255,255,255,0.92)' : MUTED,
        fontWeight: 300,
        width: '100%',
        minHeight: 72,
        resize: 'vertical',
        outline: 'none',
        transition: 'border-color 120ms',
      }}
    />
  )
}

/** Build a type-safe patch for the right field, with sensible empty handling. */
function buildPatch(
  field: EditableField,
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

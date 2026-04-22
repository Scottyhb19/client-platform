'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Link2,
  Link2Off,
  Play,
  Search,
  Trash2,
} from 'lucide-react'
import {
  addExerciseToDayAction,
  groupWithAboveAction,
  moveProgramExerciseAction,
  removeProgramExerciseAction,
  ungroupFromSupersetAction,
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

export type SessionReport = {
  id: string
  title: string
  report_type: string
  test_date: string
  is_published: boolean
}

interface SessionBuilderProps {
  clientId: string
  dayId: string
  programExercises: ProgramExercise[]
  libraryOptions: LibraryPick[]
  pinnedNotes: PinnedNote[]
  reports: SessionReport[]
}

export function SessionBuilder({
  clientId,
  dayId,
  programExercises,
  libraryOptions,
  pinnedNotes,
  reports,
}: SessionBuilderProps) {
  const [tab, setTab] = useState<'notes' | 'reports' | 'library'>('library')

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
              are copied in; you can tweak them per exercise inline.
            </p>
          </div>
        ) : (
          renderGroupedExercises(programExercises, clientId, dayId)
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
          {(['notes', 'reports', 'library'] as const).map((k) => (
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

        {tab === 'library' && (
          <LibraryPanel
            options={libraryOptions}
            clientId={clientId}
            dayId={dayId}
          />
        )}
        {tab === 'notes' && <NotesPanel notes={pinnedNotes} />}
        {tab === 'reports' && <ReportsPanel reports={reports} />}
      </aside>
    </div>
  )
}

/* ====================== Left column: exercise slab ====================== */

/**
 * Renders program_exercises with section headers + superset grouping.
 *
 * Letter assignment walks the ordered list once:
 *   - Standalone exercise (no superset_group_id, or a "new" group) →
 *     advance the group letter (A → B → C…) and label the card with
 *     just that letter.
 *   - Exercise continuing the current superset → keep the group letter,
 *     increment the sub-index so the card reads "B2", "B3" etc.
 *
 * Grouping also shrinks the bottom margin between consecutive superset
 * cards so they read as one unit, and inserts a small "Superset B"
 * chip above the first card of each multi-member group.
 */
function renderGroupedExercises(
  exercises: ProgramExercise[],
  clientId: string,
  dayId: string,
) {
  const nodes: React.ReactNode[] = []
  let lastSection: string | null | undefined = undefined
  let groupLetterIndex = -1
  let currentGroupId: string | null = null
  let subIndex = 0

  // First pass: figure out which groups have >1 member so we know when
  // to label as "Superset" vs just a regular lettered exercise.
  const groupCounts = new Map<string, number>()
  for (const pe of exercises) {
    if (pe.superset_group_id) {
      groupCounts.set(
        pe.superset_group_id,
        (groupCounts.get(pe.superset_group_id) ?? 0) + 1,
      )
    }
  }

  exercises.forEach((pe, i) => {
    const section = pe.section_title?.trim() || null
    if (section && section !== lastSection) {
      nodes.push(<SectionStrip key={`sec-${i}`}>{section}</SectionStrip>)
    }
    lastSection = section ?? null

    const groupId = pe.superset_group_id
    const groupMembers = groupId ? (groupCounts.get(groupId) ?? 1) : 1
    const isSuperset = groupMembers > 1

    let letter: string
    let showSupersetHeader = false

    if (!groupId || groupId !== currentGroupId) {
      // New group starts (or standalone after group).
      groupLetterIndex += 1
      currentGroupId = groupId
      subIndex = 1
      const baseLetter = String.fromCharCode(65 + groupLetterIndex)
      letter = isSuperset ? `${baseLetter}1` : baseLetter
      showSupersetHeader = isSuperset
    } else {
      // Continuing the current superset.
      subIndex += 1
      const baseLetter = String.fromCharCode(65 + groupLetterIndex)
      letter = `${baseLetter}${subIndex}`
    }

    if (showSupersetHeader) {
      nodes.push(
        <div
          key={`ss-${i}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'rgba(45,178,76,0.12)',
            borderRadius: 20,
            padding: '3px 10px',
            fontSize: 11,
            fontWeight: 600,
            color: '#4A7A5A',
            letterSpacing: '.02em',
            marginBottom: 6,
          }}
        >
          Superset {String.fromCharCode(65 + groupLetterIndex)}
        </div>,
      )
    }

    const sharesGroupWithPrev =
      i > 0 && groupId && exercises[i - 1]!.superset_group_id === groupId
    const sharesGroupWithNext =
      i < exercises.length - 1 &&
      groupId &&
      exercises[i + 1]!.superset_group_id === groupId

    nodes.push(
      <ExerciseSlab
        key={pe.id}
        pe={pe}
        letter={letter}
        clientId={clientId}
        dayId={dayId}
        isFirst={i === 0}
        isLast={i === exercises.length - 1}
        supersetFlow={
          sharesGroupWithPrev && sharesGroupWithNext
            ? 'middle'
            : sharesGroupWithPrev
              ? 'bottom'
              : sharesGroupWithNext
                ? 'top'
                : 'solo'
        }
      />,
    )
  })

  return nodes
}

function SectionStrip({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '22px 0 10px',
        paddingLeft: 2,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#9A9490',
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-light)',
        }}
      >
        {children}
      </span>
    </div>
  )
}

type SupersetFlow = 'solo' | 'top' | 'middle' | 'bottom'

function ExerciseSlab({
  pe,
  letter,
  clientId,
  dayId,
  isFirst,
  isLast,
  supersetFlow,
}: {
  pe: ProgramExercise
  letter: string
  clientId: string
  dayId: string
  isFirst: boolean
  isLast: boolean
  supersetFlow: SupersetFlow
}) {
  const rx = buildRxString(pe)
  const [pending, startTransition] = useTransition()
  const grouped = !!pe.superset_group_id

  function handleRemove() {
    if (!confirm(`Remove ${pe.exercise_name} from this session?`)) return
    startTransition(async () => {
      await removeProgramExerciseAction(clientId, dayId, pe.id)
    })
  }

  function handleMove(direction: 'up' | 'down') {
    startTransition(async () => {
      await moveProgramExerciseAction(clientId, dayId, pe.id, direction)
    })
  }

  function handleGroup() {
    startTransition(async () => {
      const res = await groupWithAboveAction(clientId, dayId, pe.id)
      if (res.error) alert(res.error)
    })
  }

  function handleUngroup() {
    startTransition(async () => {
      const res = await ungroupFromSupersetAction(clientId, dayId, pe.id)
      if (res.error) alert(res.error)
    })
  }

  // Superset visuals: tight margins within a group, slightly inset left
  // border to read as a connected spine.
  const marginBottom =
    supersetFlow === 'top' || supersetFlow === 'middle' ? 6 : 14
  const borderLeftAccent =
    supersetFlow !== 'solo'
      ? { borderLeft: '3px solid var(--color-accent)' }
      : undefined

  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        padding: '18px 20px',
        marginBottom,
        color: '#fff',
        display: 'grid',
        gridTemplateColumns: '1fr 1.2fr',
        gap: 22,
        opacity: pending ? 0.5 : 1,
        transition: 'opacity 150ms',
        ...borderLeftAccent,
      }}
    >
      {/* LEFT: badge, name, instructions, media */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 10,
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
          <IconButton
            disabled={isFirst || pending}
            onClick={() => handleMove('up')}
            label="Move up"
          >
            <ArrowUp size={14} aria-hidden />
          </IconButton>
          <IconButton
            disabled={isLast || pending}
            onClick={() => handleMove('down')}
            label="Move down"
          >
            <ArrowDown size={14} aria-hidden />
          </IconButton>
          {grouped ? (
            <IconButton
              disabled={pending}
              onClick={handleUngroup}
              label="Ungroup from superset"
            >
              <Link2Off size={14} aria-hidden />
            </IconButton>
          ) : (
            <IconButton
              disabled={isFirst || pending}
              onClick={handleGroup}
              label="Group with above (superset)"
            >
              <Link2 size={14} aria-hidden />
            </IconButton>
          )}
          <IconButton
            disabled={pending}
            onClick={handleRemove}
            label="Remove exercise"
          >
            <Trash2 size={16} aria-hidden />
          </IconButton>
        </div>

        <SectionTitleField
          programExerciseId={pe.id}
          initialValue={pe.section_title ?? ''}
        />

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

function IconButton({
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
        color: disabled ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)',
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

function SectionTitleField({
  programExerciseId,
  initialValue,
}: {
  programExerciseId: string
  initialValue: string
}) {
  const [value, setValue] = useState(initialValue)
  const [, startTransition] = useTransition()

  function handleBlur() {
    if (value === initialValue) return
    const patch: ProgramExercisePatch = {
      section_title: value.trim() === '' ? null : value.trim(),
    }
    startTransition(async () => {
      await updateProgramExerciseAction(programExerciseId, patch)
    })
  }

  return (
    <input
      type="text"
      value={value}
      placeholder="Section (e.g. Strength, Upper, Stability)"
      onChange={(e) => setValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      style={{
        width: '100%',
        background: 'transparent',
        border: 'none',
        borderBottom: `1px dashed ${CARD_BORDER}`,
        padding: '4px 0',
        fontFamily: 'var(--font-display)',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: value ? 'rgba(255,255,255,0.7)' : MUTED,
        outline: 'none',
        marginBottom: 14,
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

/* ====================== Right column: Reports panel ====================== */

function ReportsPanel({ reports }: { reports: SessionReport[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        className="eyebrow"
        style={{ fontSize: '.66rem', marginBottom: 10 }}
      >
        Client reports
      </div>
      {reports.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-muted)',
            lineHeight: 1.5,
          }}
        >
          No reports filed for this client yet. Force-plate profiles,
          ForceFrame results, and movement reassessments will land here once
          the VALD integration is wired.
        </div>
      ) : (
        reports.map((r) => (
          <div
            key={r.id}
            style={{
              padding: '10px 0',
              borderBottom: '1px solid var(--color-border-subtle)',
              fontSize: '.82rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                {r.title}
              </span>
              {!r.is_published && (
                <span
                  style={{
                    fontSize: '.6rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '.04em',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(232,163,23,.1)',
                    color: '#9A7A0E',
                  }}
                >
                  Draft
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: '.72rem',
                color: 'var(--color-muted)',
                display: 'flex',
                gap: 8,
              }}
            >
              <span>{formatDateShort(r.test_date)}</span>
              <span>·</span>
              <span>{r.report_type}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function formatDateShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
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


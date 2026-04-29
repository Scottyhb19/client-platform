'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
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
 * Session Builder — light/cream skeleton.
 *
 * Design tokens lifted from .design-ref/odyssey SessionBuilder.jsx.
 * Cards are white on warm parchment. The ONE harsh-black element is the
 * sequencing pill that floats on the left of each card (solo = single
 * rounded pill; superset = a continuous black spine with green B1/B2
 * letters running down it). Everything else uses softer charcoal.
 */
const INK = '#1E1A18'
const INK_SOFT = '#2A2522'
const CREAM = '#F5F0EA'
const CREAM_DEEP = '#EDE8E2'
const BORDER = '#E2DDD7'
const MUTED = '#78746F'
const FAINT = '#A09890'
const GREEN = '#2DB24C'
const ALERT = '#D64045'

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
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: FAINT,
            marginBottom: 14,
          }}
        >
          Session Exercises
        </div>

        {programExercises.length === 0 ? (
          <EmptyState />
        ) : (
          renderGroupedExercises(programExercises, clientId, dayId)
        )}
      </div>

      <aside style={{ position: 'sticky', top: 20 }}>
        <div
          style={{
            display: 'flex',
            gap: 4,
            background: CREAM_DEEP,
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
                color: tab === k ? INK : MUTED,
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

function EmptyState() {
  return (
    <div
      style={{
        background: '#fff',
        border: `1px dashed ${BORDER}`,
        borderRadius: 14,
        padding: '40px 24px',
        textAlign: 'center',
        color: MUTED,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.1rem',
          color: INK,
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
        Pick exercises from the Library panel on the right. Defaults are
        copied in; you can tweak them per exercise inline.
      </p>
    </div>
  )
}

/* ====================== Left column: grouped exercise list ====================== */

/**
 * Walks the ordered list once and decides per-card layout:
 *   - Standalone exercise → solo card with single floating black pill (A, B…)
 *   - Group of 2+ exercises → one wrapper containing stacked white cards
 *     with a continuous black spine carrying green B1, B2… letters.
 */
function renderGroupedExercises(
  exercises: ProgramExercise[],
  clientId: string,
  dayId: string,
) {
  const nodes: React.ReactNode[] = []
  let lastSection: string | null | undefined = undefined

  // Letter assignment + group counts
  const groupCounts = new Map<string, number>()
  for (const pe of exercises) {
    if (pe.superset_group_id) {
      groupCounts.set(
        pe.superset_group_id,
        (groupCounts.get(pe.superset_group_id) ?? 0) + 1,
      )
    }
  }

  let groupLetterIndex = -1
  let i = 0
  while (i < exercises.length) {
    const pe = exercises[i]!
    const section = pe.section_title?.trim() || null
    if (section && section !== lastSection) {
      nodes.push(<SectionStrip key={`sec-${i}`}>{section}</SectionStrip>)
    }
    lastSection = section ?? null

    const groupId = pe.superset_group_id
    const memberCount = groupId ? (groupCounts.get(groupId) ?? 1) : 1
    groupLetterIndex += 1
    const baseLetter = String.fromCharCode(65 + groupLetterIndex)

    if (groupId && memberCount > 1) {
      // Collect contiguous group members
      const members: ProgramExercise[] = []
      let j = i
      while (j < exercises.length && exercises[j]!.superset_group_id === groupId) {
        members.push(exercises[j]!)
        j += 1
      }

      const isFirstOverall = i === 0
      const isLastOverall = j === exercises.length

      nodes.push(
        <SupersetBlock
          key={`grp-${groupId}`}
          baseLetter={baseLetter}
          members={members}
          clientId={clientId}
          dayId={dayId}
          isFirstOverall={isFirstOverall}
          isLastOverall={isLastOverall}
        />,
      )
      i = j
    } else {
      const isFirstOverall = i === 0
      const isLastOverall = i === exercises.length - 1
      nodes.push(
        <SoloExercise
          key={pe.id}
          pe={pe}
          letter={baseLetter}
          clientId={clientId}
          dayId={dayId}
          isFirst={isFirstOverall}
          isLast={isLastOverall}
        />,
      )
      i += 1
    }
  }

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

/* ====================== Sequencing pills ====================== */

function SoloPill({ letter }: { letter: string }) {
  return (
    <div
      style={{
        width: 34,
        minHeight: 34,
        background: '#000',
        color: GREEN,
        fontFamily: 'var(--font-display)',
        fontWeight: 800,
        fontSize: 13,
        letterSpacing: '.02em',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 18,
        alignSelf: 'center',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {letter}
    </div>
  )
}

function SupersetSpine({
  baseLetter,
  count,
}: {
  baseLetter: string
  count: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 34,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 34,
          background: '#000',
          borderRadius: 17,
        }}
      />
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'relative',
            zIndex: 1,
            padding: '12px 0',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 12,
              color: GREEN,
            }}
          >
            {`${baseLetter}${idx + 1}`}
          </span>
          {idx < count - 1 && (
            <span style={{ color: GREEN, fontSize: 16, lineHeight: 1 }}>−</span>
          )}
        </div>
      ))}
    </div>
  )
}

/* ====================== Solo exercise wrapper ====================== */

function SoloExercise({
  pe,
  letter,
  clientId,
  dayId,
  isFirst,
  isLast,
}: {
  pe: ProgramExercise
  letter: string
  clientId: string
  dayId: string
  isFirst: boolean
  isLast: boolean
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <SoloPill letter={letter} />
        <div
          style={{
            flex: 1,
            background: '#fff',
            borderRadius: 12,
            border: `1px solid ${BORDER}`,
            display: 'flex',
          }}
        >
          <ExerciseBody
            pe={pe}
            clientId={clientId}
            dayId={dayId}
            isFirst={isFirst}
            isLast={isLast}
          />
        </div>
      </div>
      <CardActions
        clientId={clientId}
        dayId={dayId}
        peId={pe.id}
        grouped={false}
        isFirst={isFirst}
      />
    </div>
  )
}

/* ====================== Superset wrapper ====================== */

function SupersetBlock({
  baseLetter,
  members,
  clientId,
  dayId,
  isFirstOverall,
  isLastOverall,
}: {
  baseLetter: string
  members: ProgramExercise[]
  clientId: string
  dayId: string
  isFirstOverall: boolean
  isLastOverall: boolean
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'stretch',
          position: 'relative',
        }}
      >
        <SupersetSpine baseLetter={baseLetter} count={members.length} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {members.map((pe, idx) => (
            <div
              key={pe.id}
              style={{
                background: '#fff',
                borderRadius: 12,
                border: `1px solid ${BORDER}`,
                display: 'flex',
              }}
            >
              <ExerciseBody
                pe={pe}
                clientId={clientId}
                dayId={dayId}
                isFirst={isFirstOverall && idx === 0}
                isLast={isLastOverall && idx === members.length - 1}
              />
            </div>
          ))}
        </div>
      </div>
      <CardActions
        clientId={clientId}
        dayId={dayId}
        peId={members[members.length - 1]!.id}
        grouped={true}
        isFirst={false}
      />
    </div>
  )
}

/* ====================== Card body (left + right grid) ====================== */

function ExerciseBody({
  pe,
  clientId,
  dayId,
  isFirst,
  isLast,
}: {
  pe: ProgramExercise
  clientId: string
  dayId: string
  isFirst: boolean
  isLast: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Server actions invalidate the route cache via revalidatePath; the
  // client component still needs router.refresh() to actually re-fetch
  // and re-render the page with the new data.

  function handleRemove() {
    if (!confirm(`Remove ${pe.exercise_name} from this session?`)) return
    startTransition(async () => {
      const res = await removeProgramExerciseAction(clientId, dayId, pe.id)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleMove(direction: 'up' | 'down') {
    startTransition(async () => {
      const res = await moveProgramExerciseAction(clientId, dayId, pe.id, direction)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1.1fr 1.2fr',
        gap: 20,
        flex: 1,
        padding: '16px 20px',
        opacity: pending ? 0.55 : 1,
        transition: 'opacity 150ms',
      }}
    >
      {/* LEFT: name, instructions, demo video */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 15,
              color: INK,
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
          <IconButton
            disabled={pending}
            onClick={handleRemove}
            label="Remove exercise"
          >
            <Trash2 size={14} aria-hidden />
          </IconButton>
          <GripVertical
            size={14}
            aria-hidden
            style={{ color: FAINT, marginLeft: 2 }}
          />
        </div>

        <SectionTitleField
          programExerciseId={pe.id}
          initialValue={pe.section_title ?? ''}
        />

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 10,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: FAINT,
            marginBottom: 6,
          }}
        >
          Instructions
        </div>
        <EditableTextarea
          programExerciseId={pe.id}
          field="instructions"
          initialValue={pe.instructions ?? ''}
          placeholder="Add a coaching cue…"
        />

        <div style={{ marginTop: 12 }}>
          {pe.exercise_video_url ? (
            <a
              href={pe.exercise_video_url}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'block',
                background: INK,
                borderRadius: 8,
                height: 140,
                position: 'relative',
                overflow: 'hidden',
                textDecoration: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.92)',
                  display: 'grid',
                  placeItems: 'center',
                  color: INK,
                }}
              >
                <Play size={16} aria-hidden fill="currentColor" />
              </span>
              <span
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 12,
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.65)',
                }}
              >
                Demo
              </span>
            </a>
          ) : (
            <div
              style={{
                background: INK,
                borderRadius: 8,
                height: 140,
                display: 'grid',
                placeItems: 'center',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 12,
                position: 'relative',
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.12)',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                <Play size={16} aria-hidden />
              </span>
              <span
                style={{
                  position: 'absolute',
                  bottom: 8,
                  left: 12,
                  fontSize: 11,
                  color: 'rgba(255,255,255,0.5)',
                }}
              >
                No demo
              </span>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: set table + stepper */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <SetTable pe={pe} />
        <SetStepper pe={pe} />
        <ExtrasRow pe={pe} />
      </div>
    </div>
  )
}

/* ====================== Set table (skeleton) ====================== */

function ColHeader({
  children,
  narrow,
}: {
  children: React.ReactNode
  narrow?: boolean
}) {
  return (
    <div
      style={{
        background: INK,
        color: '#fff',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        height: 30,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 8,
        padding: narrow ? '0 6px' : '0 12px',
      }}
    >
      {children}
    </div>
  )
}

function StaticCell({
  value,
  placeholder,
}: {
  value: string
  placeholder?: string
}) {
  const empty = !value
  return (
    <div
      style={{
        background: CREAM,
        borderRadius: 8,
        height: 32,
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 500,
        color: empty ? FAINT : INK,
        padding: '0 10px',
      }}
    >
      {value || placeholder || '—'}
    </div>
  )
}

/**
 * Renders one row per set. Row 1 is editable and writes to the master
 * pe.reps / pe.optional_value fields. Rows 2..N display the same value
 * as static text — they become independent inputs once per-set storage
 * lands.
 */
function SetTable({ pe }: { pe: ProgramExercise }) {
  const setCount = Math.max(1, pe.sets ?? 1)
  const reps = pe.reps ?? ''
  const load = pe.optional_value ?? ''
  const rpe = pe.rpe ? `RPE ${pe.rpe}` : ''
  const loadDisplay = load || rpe

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '48px 1fr 1.4fr',
        columnGap: 6,
        rowGap: 6,
      }}
    >
      <ColHeader narrow>Set</ColHeader>
      <ColHeader>Reps</ColHeader>
      <ColHeader>Load / Notes</ColHeader>

      {Array.from({ length: setCount }).map((_, idx) => (
        <SetRow
          key={idx}
          rowIndex={idx}
          pe={pe}
          reps={reps}
          load={load}
          loadPlaceholder={rpe || '—'}
          loadDisplay={loadDisplay}
        />
      ))}
    </div>
  )
}

function SetRow({
  rowIndex,
  pe,
  reps,
  load,
  loadPlaceholder,
  loadDisplay,
}: {
  rowIndex: number
  pe: ProgramExercise
  reps: string
  load: string
  loadPlaceholder: string
  loadDisplay: string
}) {
  const setLabel = String(rowIndex + 1)
  // Row 1 is the editable "master" row. Other rows display the same
  // values as static text until per-set data lands.
  const editable = rowIndex === 0

  return (
    <>
      <div
        style={{
          height: 32,
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 13,
          fontWeight: 600,
          color: INK,
          background: CREAM_DEEP,
          borderRadius: 8,
        }}
      >
        {setLabel}
      </div>
      {editable ? (
        <>
          <InlineCell
            programExerciseId={pe.id}
            field="reps"
            kind="text"
            initialValue={reps}
            placeholder="—"
          />
          <InlineCell
            programExerciseId={pe.id}
            field="optional_value"
            kind="text"
            initialValue={load}
            placeholder={loadPlaceholder}
          />
        </>
      ) : (
        <>
          <StaticCell value={reps} />
          <StaticCell value={loadDisplay} />
        </>
      )}
    </>
  )
}

function InlineCell({
  programExerciseId,
  field,
  kind,
  initialValue,
  placeholder,
}: {
  programExerciseId: string
  field: keyof ProgramExercisePatch
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
      const res = await updateProgramExerciseAction(programExerciseId, patch)
      setStatus(res.error ? 'error' : 'idle')
    })
  }

  return (
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
        background: CREAM,
        borderRadius: 8,
        height: 32,
        textAlign: 'center',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 500,
        color: empty ? FAINT : INK,
        border:
          status === 'error' ? '1px solid #B04040' : '1px solid transparent',
        outline: 'none',
        padding: '0 10px',
        width: '100%',
        boxSizing: 'border-box',
      }}
    />
  )
}

function SetStepper({ pe }: { pe: ProgramExercise }) {
  const [pending, startTransition] = useTransition()
  const current = pe.sets ?? 1

  function bump(delta: number) {
    const next = Math.max(1, current + delta)
    if (next === current) return
    startTransition(async () => {
      await updateProgramExerciseAction(pe.id, { sets: next })
    })
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginTop: 8,
        alignSelf: 'flex-end',
        opacity: pending ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => bump(-1)}
        disabled={current <= 1 || pending}
        aria-label="Remove set"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          color: MUTED,
          cursor: current <= 1 ? 'not-allowed' : 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        −
      </button>
      <span style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
        {current} {current === 1 ? 'set' : 'sets'}
      </span>
      <button
        type="button"
        onClick={() => bump(1)}
        disabled={pending}
        aria-label="Add set"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          color: MUTED,
          cursor: 'pointer',
          fontSize: 16,
          lineHeight: 1,
        }}
      >
        +
      </button>
    </div>
  )
}

/* ====================== Extras row (RPE / Rest / Tempo) ====================== */

/**
 * Less-prominent extras kept accessible without crowding the table. The
 * RPE input is duplicated visually inside the Load/Notes column when
 * there's no load value (matches the design's "RPE 8" placeholder
 * pattern), and stays editable here as the source of truth.
 */
function ExtrasRow({ pe }: { pe: ProgramExercise }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
        marginTop: 12,
      }}
    >
      <SmallField
        programExerciseId={pe.id}
        field="rpe"
        label="RPE"
        kind="number"
        initialValue={pe.rpe?.toString() ?? ''}
      />
      <SmallField
        programExerciseId={pe.id}
        field="rest_seconds"
        label="Rest (s)"
        kind="number"
        initialValue={pe.rest_seconds?.toString() ?? ''}
      />
      <SmallField
        programExerciseId={pe.id}
        field="tempo"
        label="Tempo"
        kind="text"
        initialValue={pe.tempo ?? ''}
      />
    </div>
  )
}

function SmallField({
  programExerciseId,
  field,
  label,
  kind,
  initialValue,
}: {
  programExerciseId: string
  field: keyof ProgramExercisePatch
  label: string
  kind: 'number' | 'text'
  initialValue: string
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
      const res = await updateProgramExerciseAction(programExerciseId, patch)
      setStatus(res.error ? 'error' : 'idle')
    })
  }

  return (
    <label style={{ display: 'block' }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: FAINT,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <input
        type={kind === 'number' ? 'number' : 'text'}
        inputMode={kind === 'number' ? 'numeric' : undefined}
        value={value}
        placeholder="—"
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        style={{
          width: '100%',
          height: 28,
          padding: '0 8px',
          background: CREAM,
          border:
            status === 'error' ? '1px solid #B04040' : '1px solid transparent',
          borderRadius: 6,
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
          fontWeight: 500,
          color: empty ? FAINT : INK,
          textAlign: 'center',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </label>
  )
}

/* ====================== Card actions (under each card) ====================== */

function CardActions({
  clientId,
  dayId,
  peId,
  grouped,
  isFirst,
}: {
  clientId: string
  dayId: string
  peId: string
  grouped: boolean
  isFirst: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function handleSuperset() {
    if (grouped) {
      startTransition(async () => {
        const res = await ungroupFromSupersetAction(clientId, dayId, peId)
        if (res.error) {
          alert(res.error)
          return
        }
        router.refresh()
      })
    } else {
      startTransition(async () => {
        const res = await groupWithAboveAction(clientId, dayId, peId)
        if (res.error) {
          alert(res.error)
          return
        }
        router.refresh()
      })
    }
  }

  function focusLibrarySearch() {
    const el = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search exercises"]',
    )
    el?.focus()
  }

  const supersetDisabled = !grouped && isFirst

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        justifyContent: 'center',
        marginTop: 10,
      }}
    >
      <button
        type="button"
        onClick={handleSuperset}
        disabled={pending || supersetDisabled}
        title={
          supersetDisabled
            ? 'Add this below another exercise to superset them'
            : grouped
              ? 'Remove from superset'
              : 'Group with the exercise above'
        }
        style={pillButtonStyle(pending || supersetDisabled)}
      >
        {grouped ? 'Remove superset' : 'Superset'}
      </button>
      <button
        type="button"
        onClick={focusLibrarySearch}
        style={pillButtonStyle(false)}
      >
        + Add exercise
      </button>
    </div>
  )
}

function pillButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 14px',
    background: '#fff',
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    color: disabled ? FAINT : INK,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font-sans)',
  }
}

/* ====================== Editable bits shared across the card ====================== */

function EditableTextarea({
  programExerciseId,
  field,
  initialValue,
  placeholder,
}: {
  programExerciseId: string
  field: keyof ProgramExercisePatch
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
      const res = await updateProgramExerciseAction(programExerciseId, patch)
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
        background: CREAM,
        border:
          status === 'error' ? '1px solid #B04040' : '1px solid transparent',
        borderRadius: 8,
        padding: '10px 12px',
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        lineHeight: 1.5,
        color: value ? INK : FAINT,
        fontWeight: 400,
        width: '100%',
        minHeight: 64,
        resize: 'vertical',
        outline: 'none',
        boxSizing: 'border-box',
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
        color: disabled ? '#D6D0C8' : MUTED,
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
        borderBottom: `1px dashed ${BORDER}`,
        padding: '4px 0',
        fontFamily: 'var(--font-display)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: value ? MUTED : FAINT,
        outline: 'none',
        marginBottom: 12,
      }}
    />
  )
}

function buildPatch(
  field: keyof ProgramExercisePatch,
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

/* ====================== Right column: Library / Notes / Reports ====================== */

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
      if (res.error) alert(res.error)
      setAdding(null)
    })
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Library — pick to add
      </div>
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search
          size={14}
          aria-hidden
          style={{ position: 'absolute', left: 10, top: 9, color: MUTED }}
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
            border: `1px solid ${BORDER}`,
            borderRadius: 7,
            fontFamily: 'var(--font-sans)',
            fontSize: '.82rem',
            background: CREAM,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {options.length === 0 ? (
        <div
          style={{
            fontSize: '.82rem',
            color: MUTED,
            padding: '12px 0',
            lineHeight: 1.5,
          }}
        >
          Your exercise library is empty. Add exercises in /library first,
          then come back here.
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, padding: '12px 0' }}>
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
                borderTop: `1px solid ${BORDER}`,
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
                    color: MUTED,
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

function ReportsPanel({ reports }: { reports: SessionReport[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Client reports
      </div>
      {reports.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
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
              borderBottom: `1px solid ${BORDER}`,
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
              <span style={{ fontWeight: 600, color: INK }}>{r.title}</span>
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
                color: MUTED,
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

function NotesPanel({ notes }: { notes: PinnedNote[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Pinned clinical notes
      </div>
      {notes.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No pinned notes for this client. Pin a note from the profile to
          have it visible here while you build the session.
        </div>
      ) : (
        notes.map((n) => (
          <div
            key={n.id}
            style={{
              background: 'rgba(214,64,69,.05)',
              borderLeft: `3px solid ${ALERT}`,
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
                  color: ALERT,
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

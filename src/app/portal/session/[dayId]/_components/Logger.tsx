'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Check, ChevronLeft, Play, X } from 'lucide-react'
import {
  completeSessionAction,
  logExerciseNoteAction,
  logSetAction,
} from '../actions'

export type PrescribedSet = {
  setNumber: number
  reps: string | null
  optionalMetric: string | null
  optionalValue: string | null
}

export type LoggerExercise = {
  programExerciseId: string
  name: string
  sectionTitle: string | null
  instructions: string | null
  prescribedSets: PrescribedSet[]
  letter: string
  // Superset/tri-set membership. Consecutive exercises sharing a non-null
  // id (group size > 1) render together as one on-screen group (P1-2,
  // §6.3.1). NULL = standalone (singleton group).
  supersetGroupId: string | null
  // YouTube link from the exercise library (NULL when unset). Rendered as
  // an expandable thumbnail per exercise (P1-3, §6.3.1).
  videoUrl: string | null
}

// One on-screen group: a superset/tri-set (>1 exercise, shared id) or a
// standalone exercise (a singleton group).
type LoggerGroup = {
  supersetGroupId: string | null
  exercises: LoggerExercise[]
}

export type LoggedSet = {
  programExerciseId: string
  setNumber: number
  reps: number | null
  weightValue: number | null
  weightMetric: string | null
  optionalValue: string | null
  rpe: number | null
}

// Editable strings for one set's three inputs (lifted to the Logger so
// carry-forward can update later rows; see saveSet).
type Draft = { reps: string; load: string; rpe: string }

interface LoggerProps {
  sessionId: string
  dayId: string
  dayLabel: string
  clientName: string
  exercises: LoggerExercise[]
  existingLogs: LoggedSet[]
  // Per-(program)exercise notes, keyed by programExerciseId — prefills the
  // per-group notes field on resume (P1-4, §6.3.1). Empty when none saved.
  exerciseNotes: Record<string, string>
  // Per-device "autofill" preference (server-read cookie). ON: seed each
  // set from your previous set / the prescription and carry your entries
  // forward on save. OFF: blank boxes. (Section 7 / P1-2 follow-up.)
  autofill: boolean
}

export function Logger({
  sessionId,
  dayId,
  dayLabel,
  clientName,
  exercises,
  existingLogs,
  exerciseNotes,
  autofill,
}: LoggerProps) {
  const initialLogs = useMemo(() => mapFromLogs(existingLogs), [existingLogs])

  // Group consecutive exercises that share a superset/tri-set id into one
  // on-screen group; standalone exercises are singleton groups (P1-2).
  const groups = useMemo(() => buildGroups(exercises), [exercises])

  const [logsByKey, setLogsByKey] = useState<Map<string, LoggedSet>>(
    () => initialLogs,
  )
  // Editable input drafts for every set, keyed by setKey. Open form (P1-2
  // follow-up): every set is editable in any order, not one gated "active"
  // set. Seeded from prior actuals / the prescription when autofill is on.
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() =>
    buildInitialDrafts(exercises, initialLogs, autofill),
  )
  // Sets the client has hand-edited — carry-forward never overwrites these.
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  // Which group's screen is showing. Manual nav (Back/Next) per the brief's
  // "Next" button; starts at the first group with an unlogged set on resume.
  const [currentGroupIdx, setCurrentGroupIdx] = useState<number>(() =>
    initialGroupIdx(groups, initialLogs),
  )

  function updateDraft(
    exerciseId: string,
    setNumber: number,
    field: keyof Draft,
    value: string,
  ) {
    const key = setKey(exerciseId, setNumber)
    setDrafts((prev) => {
      const next = new Map(prev)
      const cur = next.get(key) ?? { reps: '', load: '', rpe: '' }
      next.set(key, { ...cur, [field]: value })
      return next
    })
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  }

  async function saveSet(
    exerciseId: string,
    setNumber: number,
  ): Promise<{ error: string | null }> {
    const key = setKey(exerciseId, setNumber)
    const d = drafts.get(key) ?? { reps: '', load: '', rpe: '' }

    const repsNum = d.reps.trim() === '' ? null : parseInt(d.reps, 10)
    const rpeNum = d.rpe.trim() === '' ? null : parseInt(d.rpe, 10)
    if (repsNum !== null && (!Number.isFinite(repsNum) || repsNum < 0)) {
      return { error: 'Reps must be a whole number.' }
    }
    if (rpeNum !== null && (!Number.isFinite(rpeNum) || rpeNum < 1 || rpeNum > 10)) {
      return { error: 'RPE is 1–10.' }
    }
    const parsedLoad = parseLoad(d.load)

    const res = await logSetAction({
      sessionId,
      programExerciseId: exerciseId,
      setNumber,
      reps: repsNum,
      weightValue: parsedLoad.weightValue,
      weightMetric: parsedLoad.weightMetric,
      optionalValue: parsedLoad.optionalValue,
      rpe: rpeNum,
    })
    if (res.error) return { error: res.error }

    const log: LoggedSet = {
      programExerciseId: exerciseId,
      setNumber,
      reps: repsNum,
      weightValue: parsedLoad.weightValue,
      weightMetric: parsedLoad.weightMetric,
      optionalValue: parsedLoad.optionalValue,
      rpe: rpeNum,
    }
    setLogsByKey((prev) => new Map(prev).set(key, log))

    setDrafts((prev) => {
      const next = new Map(prev)
      // Canonicalise this set's draft to the stored form so it doesn't read
      // as "edited" right after saving ("82.5" → "82.5kg").
      const canonical = loggedToDraft(log)
      next.set(key, canonical)
      // Carry the entered numbers forward into later, still-untouched,
      // unlogged sets of the same exercise (autofill on only).
      if (autofill) {
        const ex = exercises.find((e) => e.programExerciseId === exerciseId)
        for (const ps of ex?.prescribedSets ?? []) {
          if (ps.setNumber <= setNumber) continue
          const k2 = setKey(exerciseId, ps.setNumber)
          if (!logsByKey.has(k2) && !touched.has(k2)) {
            next.set(k2, { ...canonical })
          }
        }
      }
      return next
    })
    return { error: null }
  }

  if (currentGroupIdx >= groups.length) {
    return (
      <CompletePrompt
        sessionId={sessionId}
        dayId={dayId}
        dayLabel={dayLabel}
        name={clientName}
        onBack={
          groups.length > 0
            ? () => setCurrentGroupIdx(groups.length - 1)
            : null
        }
      />
    )
  }

  const group = groups[currentGroupIdx]!
  const multi = group.exercises.length > 1
  const isLastGroup = currentGroupIdx === groups.length - 1

  return (
    <>
      <TopBar
        dayId={dayId}
        groupIdx={currentGroupIdx}
        totalGroups={groups.length}
      />
      <GroupHead group={group} />
      <div style={{ padding: '0 20px 20px' }}>
        {group.exercises.map((gex) => (
          <ExerciseBlock key={gex.programExerciseId} exercise={gex} compact={multi}>
            {gex.prescribedSets.map((prescribed) => {
              const sn = prescribed.setNumber
              const key = setKey(gex.programExerciseId, sn)
              return (
                <SetRow
                  key={sn}
                  setNumber={sn}
                  draft={drafts.get(key) ?? { reps: '', load: '', rpe: '' }}
                  logged={logsByKey.get(key)}
                  onChange={(field, value) =>
                    updateDraft(gex.programExerciseId, sn, field, value)
                  }
                  onSave={() => saveSet(gex.programExerciseId, sn)}
                />
              )
            })}
          </ExerciseBlock>
        ))}
        <GroupNotes
          key={group.exercises[0]!.programExerciseId}
          sessionId={sessionId}
          programExerciseId={group.exercises[0]!.programExerciseId}
          initial={exerciseNotes[group.exercises[0]!.programExerciseId] ?? ''}
        />
        <NavRow
          onBack={
            currentGroupIdx > 0
              ? () => setCurrentGroupIdx((i) => i - 1)
              : null
          }
          onNext={() => setCurrentGroupIdx((i) => i + 1)}
          nextLabel={isLastGroup ? 'Wrap up' : 'Next'}
        />
      </div>
    </>
  )
}

/* ====================== Sub-components ====================== */

function TopBar({
  dayId,
  groupIdx,
  totalGroups,
}: {
  dayId: string
  groupIdx: number
  totalGroups: number
}) {
  const pct = totalGroups === 0 ? 0 : ((groupIdx + 1) / totalGroups) * 100
  return (
    <>
      <div
        style={{
          padding: '16px 20px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Link
          href="/portal"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--session-text-muted)',
            fontSize: '.82rem',
            fontFamily: 'var(--font-sans)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <X size={14} aria-hidden /> Exit
        </Link>
        <div className="session-eyebrow">
          {groupIdx + 1} of {totalGroups}
        </div>
        <div style={{ width: 46 }} />
      </div>
      <div style={{ padding: '0 20px 16px' }}>
        <div className="session-progress">
          <div className="session-progress__fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {/* Dummy dayId reference so the hook's revalidation target stays
          typed; unused at runtime. */}
      <div data-session-day={dayId} style={{ display: 'none' }} />
    </>
  )
}

// Bottom navigation between exercise groups (P1-2 follow-up). "Next" is
// always tappable — the open form lets you advance with a set unlogged
// (deliberately skip); "Finish session" stays on the final RPE screen only
// (§6.3.1). Back returns to the previous group to finish a skipped set.
function NavRow({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: (() => void) | null
  onNext: () => void
  nextLabel: string
}) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '6px 0 8px' }}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            padding: '14px 18px',
            background: 'transparent',
            color: 'var(--session-text)',
            border: '1px solid var(--session-border)',
            borderRadius: 'var(--radius-chip)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            letterSpacing: '.02em',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ChevronLeft size={16} aria-hidden /> Back
        </button>
      )}
      <button
        type="button"
        onClick={onNext}
        style={{
          flex: 1,
          padding: 16,
          background: 'var(--session-cta-bg)',
          color: 'var(--session-cta-text)',
          border: 'none',
          borderRadius: 'var(--radius-chip)',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.1rem',
          letterSpacing: '.02em',
          cursor: 'pointer',
        }}
      >
        {nextLabel}
      </button>
    </div>
  )
}

// Expandable per-exercise video (P1-3, §6.3.1). Tap the thumbnail to expand
// to a 16:9 tile; tap that to open the YouTube link in a new tab (no
// embedded player — "YouTube links only"). Placeholder play tiles, no
// external poster fetch (fast on gym connections); no backdrop-filter.
function VideoThumb({ url }: { url: string }) {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 12px 7px 8px',
          background: 'var(--session-card)',
          border: '1px solid var(--session-border)',
          borderRadius: 'var(--radius-button)',
          color: 'var(--session-text)',
          fontFamily: 'var(--font-sans)',
          fontSize: '.8rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: 'var(--session-accent)',
            color: 'var(--session-on-accent)',
          }}
        >
          <Play size={12} aria-hidden />
        </span>
        Watch demo
      </button>
    )
  }

  return (
    <div style={{ marginTop: 10 }}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          aspectRatio: '16 / 9',
          background: 'var(--session-card)',
          border: '1px solid var(--session-border)',
          borderRadius: 'var(--radius-card-dense)',
          color: 'var(--session-text)',
          textDecoration: 'none',
        }}
      >
        <span
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'var(--session-accent)',
            color: 'var(--session-on-accent)',
          }}
        >
          <Play size={22} aria-hidden />
        </span>
        <span style={{ fontSize: '.78rem', fontWeight: 600 }}>
          Tap to watch on YouTube
        </span>
      </a>
      <button
        type="button"
        onClick={() => setOpen(false)}
        style={{
          marginTop: 6,
          background: 'none',
          border: 'none',
          color: 'var(--session-text-muted)',
          fontSize: '.76rem',
          cursor: 'pointer',
          padding: '2px 0',
        }}
      >
        Hide
      </button>
    </div>
  )
}

// Optional per-group notes (P1-4, §6.3.1). Saved on blur to the group's
// first exercise's exercise_logs.notes; prefilled on resume.
function GroupNotes({
  sessionId,
  programExerciseId,
  initial,
}: {
  sessionId: string
  programExerciseId: string
  initial: string
}) {
  const [notes, setNotes] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function save() {
    const trimmed = notes.trim()
    if (trimmed === saved.trim()) return
    setError(null)
    startTransition(async () => {
      const res = await logExerciseNoteAction(
        sessionId,
        programExerciseId,
        trimmed.length === 0 ? null : trimmed,
      )
      if (res.error) setError(res.error)
      else setSaved(trimmed)
    })
  }

  return (
    <div style={{ marginTop: 4, marginBottom: 12 }}>
      <div className="session-eyebrow" style={{ marginBottom: 6 }}>
        Notes · optional
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={save}
        placeholder="Anything to note for this block?"
        rows={2}
        maxLength={500}
        style={{
          width: '100%',
          border: '1px solid var(--session-border)',
          borderRadius: 'var(--radius-input)',
          background: 'var(--session-input-bg)',
          padding: '10px 12px',
          fontFamily: 'inherit',
          fontSize: '.84rem',
          lineHeight: 1.5,
          color: 'var(--session-input-text)',
          outline: 'none',
          resize: 'vertical',
          minHeight: 56,
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--session-error-text)',
            marginTop: 4,
          }}
        >
          Couldn&rsquo;t save that note — it&rsquo;ll retry when you tap away again.
        </div>
      )}
    </div>
  )
}

// Group header — section title (once for the whole group) + a Superset /
// Tri-set / Giant set badge when the group holds more than one exercise.
function GroupHead({ group }: { group: LoggerGroup }) {
  const size = group.exercises.length
  const sectionTitle = group.exercises[0]?.sectionTitle ?? null
  const badge =
    size <= 1
      ? null
      : size === 2
        ? 'Superset'
        : size === 3
          ? 'Tri-set'
          : 'Giant set'
  if (!sectionTitle && !badge) return null
  return (
    <div
      style={{
        padding: '0 20px',
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      {sectionTitle && (
        <span
          className="session-eyebrow"
          style={{ color: 'var(--session-text-muted)' }}
        >
          {sectionTitle}
        </span>
      )}
      {badge && (
        <span
          // Superset/tri-set badge — a sanctioned accent use (grouping
          // signal, not decoration): the group must read as one unit.
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.62rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--session-accent)',
            background: 'var(--session-card-done)',
            padding: '3px 8px',
            borderRadius: 'var(--radius-pill)',
          }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

// One exercise within the active group: its letter, name, instructions, rx
// summary, video, then its set rows (children).
function ExerciseBlock({
  exercise,
  compact,
  children,
}: {
  exercise: LoggerExercise
  compact: boolean
  children: React.ReactNode
}) {
  const rx = buildRxLabel(exercise)
  return (
    <div style={{ marginBottom: compact ? 18 : 4 }}>
      <div
        className="session-eyebrow"
        style={{ color: 'var(--session-accent)' }}
      >
        {exercise.letter}
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: compact ? '1.35rem' : '1.8rem',
          margin: '2px 0 6px',
          letterSpacing: '-.01em',
        }}
      >
        {exercise.name}
      </h2>
      {exercise.instructions && (
        <div
          style={{
            fontSize: '.84rem',
            color: 'var(--session-text-muted)',
            lineHeight: 1.5,
          }}
        >
          {exercise.instructions}
        </div>
      )}
      {rx && (
        <div
          style={{
            marginTop: 10,
            marginBottom: 10,
            display: 'inline-block',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.95rem',
            color: 'var(--session-text)',
            background: 'var(--session-card-active)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-button)',
          }}
        >
          {rx}
        </div>
      )}
      {exercise.videoUrl && <VideoThumb url={exercise.videoUrl} />}
      {children}
    </div>
  )
}

// One open, editable set row (P1-2 follow-up). Inputs are always editable;
// the check/log button saves them (upsert) in any order. A logged set shows
// a green check + quiet "Logged"; editing it re-exposes a "Save changes"
// button (dirty), since the backend upserts. Controlled by the parent's
// draft map so carry-forward updates show live.
function SetRow({
  setNumber,
  draft,
  logged,
  onChange,
  onSave,
}: {
  setNumber: number
  draft: Draft
  logged: LoggedSet | undefined
  onChange: (field: keyof Draft, value: string) => void
  onSave: () => Promise<{ error: string | null }>
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const dirty = logged !== undefined && !draftEqualsLogged(draft, logged)
  const done = logged !== undefined && !dirty

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const res = await onSave()
      setError(res?.error ?? null)
    })
  }

  return (
    <div
      style={{
        background: done
          ? 'var(--session-card-done)'
          : dirty
            ? 'var(--session-card-active)'
            : 'var(--session-card)',
        border: `1px solid ${
          dirty ? 'var(--session-border-active)' : 'var(--session-border)'
        }`,
        borderRadius: 'var(--radius-card-dense)',
        padding: '12px 14px',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.78rem',
            color: done
              ? 'var(--session-on-accent)'
              : 'var(--session-num-pending-text)',
            background: done
              ? 'var(--session-accent)'
              : 'var(--session-num-pending-bg)',
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {done ? <Check size={14} aria-hidden /> : setNumber}
        </span>
        <span style={{ fontWeight: 600, fontSize: '.88rem', flex: 1 }}>
          Set {setNumber}
        </span>
        {done && (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.72rem',
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              color: 'var(--session-text-muted)',
            }}
          >
            Logged
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '6px 10px',
            background: 'var(--session-error-bg)',
            border: '1px solid var(--session-error-border)',
            borderRadius: 'var(--radius-input)',
            color: 'var(--session-error-text)',
            fontSize: '.78rem',
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
          marginBottom: done ? 0 : 10,
        }}
      >
        <LogInput
          label="Reps"
          value={draft.reps}
          onChange={(v) => onChange('reps', v)}
          inputMode="numeric"
        />
        <LogInput
          label="Load"
          value={draft.load}
          onChange={(v) => onChange('load', v)}
        />
        <LogInput
          label="RPE"
          value={draft.rpe}
          onChange={(v) => onChange('rpe', v)}
          inputMode="numeric"
        />
      </div>

      {!done && (
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          style={{
            width: '100%',
            padding: 14,
            background: 'var(--session-cta-bg)',
            color: 'var(--session-cta-text)',
            border: 'none',
            borderRadius: 'var(--radius-chip)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
            letterSpacing: '.02em',
            cursor: 'pointer',
          }}
        >
          {pending ? 'Saving…' : dirty ? 'Save changes' : 'Log set'}
        </button>
      )}
    </div>
  )
}

function LogInput({
  label,
  value,
  onChange,
  inputMode,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: 'numeric' | 'decimal' | 'text'
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '.62rem',
          fontWeight: 600,
          color: 'var(--session-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        style={{
          width: '100%',
          height: 40,
          border: '1px solid var(--session-border)',
          borderRadius: 'var(--radius-input)',
          background: 'var(--session-input-bg)',
          textAlign: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.05rem',
          color: 'var(--session-input-text)',
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function CompletePrompt({
  sessionId,
  dayId,
  dayLabel,
  name,
  onBack,
}: {
  sessionId: string
  dayId: string
  dayLabel: string
  name: string
  onBack: (() => void) | null
}) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState('')
  const [sessionRpe, setSessionRpe] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleComplete() {
    const trimmed = feedback.trim()
    setError(null)
    startTransition(async () => {
      const res = await completeSessionAction(
        sessionId,
        dayId,
        trimmed.length === 0 ? null : trimmed,
        sessionRpe,
      )
      // completeSessionAction redirects on success; only an error returns.
      // P1-5: surface it inline (themed) rather than via a raw alert().
      if (res && res.error) setError(res.error)
    })
  }

  return (
    <div
      style={{
        padding: '20px 24px',
        textAlign: 'center',
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: 'var(--session-text-muted)',
            fontSize: '.82rem',
            cursor: 'pointer',
            marginBottom: 16,
            float: 'left',
          }}
        >
          <ChevronLeft size={14} aria-hidden /> Back
        </button>
      )}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--session-accent)',
          margin: '20px auto 20px',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--session-on-accent)',
          fontSize: '1.8rem',
        }}
      >
        <Check size={28} aria-hidden />
      </div>
      <div
        className="session-eyebrow"
        style={{ color: 'var(--session-accent)' }}
      >
        {dayLabel} · sets logged
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '2rem',
          margin: '6px 0 24px',
          letterSpacing: '-.01em',
        }}
      >
        Great work, {name}.
      </h2>

      {/* Optional session RPE — 1-10 chips. Null = skipped. */}
      <div style={{ marginBottom: 18, textAlign: 'left' }}>
        <div className="session-eyebrow" style={{ marginBottom: 8 }}>
          Session RPE · optional
        </div>
        <div
          className="portal-rpe-picker"
          role="radiogroup"
          aria-label="Session RPE, 1 to 10"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const sel = sessionRpe === n
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={sel}
                onClick={() => setSessionRpe(sel ? null : n)}
                className={
                  sel
                    ? 'portal-rpe-picker__btn is-selected'
                    : 'portal-rpe-picker__btn'
                }
              >
                {n}
              </button>
            )
          })}
        </div>
      </div>

      {/* Optional free-text feedback. Empty normalises to NULL on submit. */}
      <div style={{ marginBottom: 24, textAlign: 'left' }}>
        <div className="session-eyebrow" style={{ marginBottom: 8 }}>
          Feedback · optional
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="How did that feel? Anything to flag for your EP?"
          rows={3}
          maxLength={500}
          style={{
            width: '100%',
            border: '1px solid var(--session-border)',
            borderRadius: 'var(--radius-input)',
            background: 'var(--session-input-bg)',
            padding: '10px 12px',
            fontFamily: 'inherit',
            fontSize: '.88rem',
            lineHeight: 1.5,
            color: 'var(--session-input-text)',
            outline: 'none',
            resize: 'vertical',
            minHeight: 80,
            boxSizing: 'border-box',
          }}
        />
        {feedback.length > 400 && (
          <div
            style={{
              fontSize: '.7rem',
              color: 'var(--session-text-muted)',
              textAlign: 'right',
              marginTop: 4,
            }}
          >
            {feedback.length} / 500
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            marginBottom: 12,
            textAlign: 'left',
            background: 'var(--session-error-bg)',
            border: '1px solid var(--session-error-border)',
            borderRadius: 'var(--radius-input)',
            color: 'var(--session-error-text)',
            fontSize: '.82rem',
            lineHeight: 1.45,
          }}
        >
          Couldn&rsquo;t finish the session. Check your connection and try again.
        </div>
      )}
      <button
        type="button"
        onClick={handleComplete}
        disabled={pending}
        className="portal-btn-primary"
        style={{
          background: 'var(--session-cta-bg)',
          color: 'var(--session-cta-text)',
        }}
      >
        {pending ? 'Wrapping up…' : 'Finish session'}
      </button>
    </div>
  )
}

/* ====================== Helpers ====================== */

function setKey(programExerciseId: string, setNumber: number): string {
  return `${programExerciseId}#${setNumber}`
}

function mapFromLogs(logs: LoggedSet[]): Map<string, LoggedSet> {
  const m = new Map<string, LoggedSet>()
  for (const l of logs) m.set(setKey(l.programExerciseId, l.setNumber), l)
  return m
}

/**
 * Fold the ordered exercise list into on-screen groups. Consecutive
 * exercises sharing the same NON-NULL superset id merge into one group; a
 * standalone exercise (null id) is always its own singleton — two adjacent
 * standalones never merge. Preserves order.
 */
function buildGroups(exercises: LoggerExercise[]): LoggerGroup[] {
  const groups: LoggerGroup[] = []
  for (const ex of exercises) {
    const last = groups[groups.length - 1]
    if (
      last &&
      ex.supersetGroupId !== null &&
      last.supersetGroupId === ex.supersetGroupId
    ) {
      last.exercises.push(ex)
    } else {
      groups.push({ supersetGroupId: ex.supersetGroupId, exercises: [ex] })
    }
  }
  return groups
}

/** Index of the first group with an unlogged set; groups.length if all done. */
function initialGroupIdx(
  groups: LoggerGroup[],
  logs: Map<string, LoggedSet>,
): number {
  for (let gi = 0; gi < groups.length; gi++) {
    for (const e of groups[gi]!.exercises) {
      for (const s of e.prescribedSets) {
        if (!logs.has(setKey(e.programExerciseId, s.setNumber))) return gi
      }
    }
  }
  return groups.length
}

/** Draft strings reconstructed from a saved set (for editing + dirty checks). */
function loggedToDraft(l: LoggedSet): Draft {
  const load =
    l.weightValue !== null
      ? `${l.weightValue}${l.weightMetric ?? ''}`
      : (l.optionalValue ?? '')
  return {
    reps: l.reps !== null ? String(l.reps) : '',
    load,
    rpe: l.rpe !== null ? String(l.rpe) : '',
  }
}

/** Draft seeded from the EP's prescription (reps numeric; load/rpe by metric). */
function draftFromPrescription(p: PrescribedSet): Draft {
  return {
    reps: p.reps && /^\d+$/.test(p.reps.trim()) ? p.reps.trim() : '',
    load: p.optionalMetric === 'rpe' ? '' : (p.optionalValue ?? ''),
    rpe: p.optionalMetric === 'rpe' ? (p.optionalValue ?? '') : '',
  }
}

function draftEqualsLogged(d: Draft, l: LoggedSet): boolean {
  const x = loggedToDraft(l)
  return (
    d.reps.trim() === x.reps.trim() &&
    d.load.trim() === x.load.trim() &&
    d.rpe.trim() === x.rpe.trim()
  )
}

/**
 * Seed the editable drafts for every set. A logged set always shows its
 * saved values. For an unlogged set with autofill ON, carry the most recent
 * earlier *actuals* in the same exercise (1), falling back to the
 * prescription (3); with autofill OFF, leave it blank.
 */
function buildInitialDrafts(
  exercises: LoggerExercise[],
  logs: Map<string, LoggedSet>,
  autofill: boolean,
): Map<string, Draft> {
  const drafts = new Map<string, Draft>()
  for (const ex of exercises) {
    let lastActuals: Draft | null = null
    for (const p of ex.prescribedSets) {
      const key = setKey(ex.programExerciseId, p.setNumber)
      const logged = logs.get(key)
      if (logged) {
        const d = loggedToDraft(logged)
        drafts.set(key, d)
        lastActuals = d
      } else if (autofill) {
        drafts.set(key, lastActuals ? { ...lastActuals } : draftFromPrescription(p))
      } else {
        drafts.set(key, { reps: '', load: '', rpe: '' })
      }
    }
  }
  return drafts
}

function buildRxLabel(e: LoggerExercise): string {
  const sets = e.prescribedSets
  if (sets.length === 0) return ''

  // Render the eyebrow summary only when every set is identical. Wave-loading
  // and other non-uniform prescriptions hide it — the per-set rows speak.
  const first = sets[0]!
  const allSame = sets.every(
    (s) =>
      s.reps === first.reps &&
      s.optionalMetric === first.optionalMetric &&
      s.optionalValue === first.optionalValue,
  )
  if (!allSame) return ''

  const bits: string[] = []
  if (first.reps) bits.push(`${sets.length} × ${first.reps}`)
  else bits.push(`${sets.length} sets`)
  if (first.optionalValue) {
    bits.push(
      first.optionalMetric === 'rpe'
        ? `RPE ${first.optionalValue}`
        : first.optionalValue,
    )
  }
  return bits.join(' · ')
}

/**
 * Parse a load string into structured + free-text parts.
 *   "80kg" / "80" → { weightValue: 80, weightMetric: 'kg', optionalValue: null }
 *   "BW"          → { weightValue: null, weightMetric: null, optionalValue: 'BW' }
 *   ""            → all null
 */
function parseLoad(raw: string): {
  weightValue: number | null
  weightMetric: string | null
  optionalValue: string | null
} {
  const s = raw.trim()
  if (!s) return { weightValue: null, weightMetric: null, optionalValue: null }

  const numMatch = /^(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?$/i.exec(s)
  if (numMatch) {
    const n = parseFloat(numMatch[1]!)
    const metric = (numMatch[2] ?? 'kg').toLowerCase()
    return {
      weightValue: Number.isFinite(n) ? n : null,
      weightMetric: metric === 'lbs' ? 'lb' : metric,
      optionalValue: null,
    }
  }

  return { weightValue: null, weightMetric: null, optionalValue: s }
}

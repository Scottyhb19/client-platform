'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Check, ChevronLeft, Play, X } from 'lucide-react'
import {
  completeSessionAction,
  logExerciseNoteAction,
  logSetAction,
} from '../actions'
import { formatVolume, volumeUnitLabel } from '@/lib/prescription/volume-units'

export type PrescribedSet = {
  setNumber: number
  reps: string | null
  // Volume unit (NULL = reps; else a time/distance code). Drives the input
  // label (Reps / Seconds / Metres) and the unit logged with the value.
  repMetric: string | null
  optionalMetric: string | null
  optionalValue: string | null
}

export type LoggerExercise = {
  programExerciseId: string
  // Stable exercise-library id (survives prescription changes) — the key for
  // the cross-session "last logged" lookup (Change 3).
  exerciseId: string
  name: string
  sectionTitle: string | null
  instructions: string | null
  prescribedSets: PrescribedSet[]
  letter: string
  // Superset/tri-set membership (P1-2, §6.3.1). NULL = standalone.
  supersetGroupId: string | null
  // YouTube link from the exercise library (NULL when unset). (P1-3.)
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
  repMetric: string | null
  weightValue: number | null
  weightMetric: string | null
  optionalValue: string | null
}

// One set from the client's most recent COMPLETED session for an exercise — the
// source for the "last: 80kg × 6" reference line and the no-prescribed-load
// prefill fallback (Change 3). Grouped per exercise in LastLoggedExercise.
export type LastLoggedSet = {
  setNumber: number
  weightValue: number | null
  weightMetric: string | null
  reps: number | null
  repMetric: string | null
}
export type LastLoggedExercise = {
  // Pre-formatted in the device/org timezone server-side (no hydration risk).
  dateLabel: string
  sets: LastLoggedSet[]
}

// Editable strings for one set's two inputs (lifted to the Logger so
// carry-forward + "log all" can update rows; see saveSet/saveAll). Client-
// logged RPE was removed from the in-session flow (2026-06-26 dogfooding
// deviation); the post-session Session RPE on the wrap-up screen is unaffected.
type Draft = { reps: string; load: string }

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
  // forward on save. OFF: blank boxes.
  autofill: boolean
  // The client's most recent COMPLETED log per exercise (keyed by exercise_id),
  // for the reference line + no-prescribed-load prefill fallback (Change 3).
  // Empty {} when the client has no prior history for this day's exercises.
  lastLogged: Record<string, LastLoggedExercise>
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
  lastLogged,
}: LoggerProps) {
  const initialLogs = useMemo(() => mapFromLogs(existingLogs), [existingLogs])

  // Group consecutive exercises sharing a superset id into one on-screen
  // group; standalone exercises are singleton groups (P1-2).
  const groups = useMemo(() => buildGroups(exercises), [exercises])

  const [logsByKey, setLogsByKey] = useState<Map<string, LoggedSet>>(
    () => initialLogs,
  )
  // Open form: every set is editable in any order. Drafts lifted here so
  // carry-forward / "log all" / group nav don't lose input.
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() =>
    buildInitialDrafts(exercises, initialLogs, autofill, lastLogged),
  )
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  // Per-FIELD touched (`key#field`) — drives ghost styling: a prefill reads
  // translucent until the client edits THAT field. Separate from `touched`
  // (per-set), which the carry-forward logic uses to skip hand-edited sets.
  const [touchedFields, setTouchedFields] = useState<Set<string>>(
    () => new Set(),
  )
  // Per-group notes, lifted here so the text survives Back/Next (the field
  // unmounts on nav; the server prop doesn't carry in-session edits).
  const [noteText, setNoteText] = useState<Map<string, string>>(
    () => new Map(Object.entries(exerciseNotes)),
  )
  const [noteSaved, setNoteSaved] = useState<Map<string, string>>(
    () => new Map(Object.entries(exerciseNotes)),
  )
  // Which group's screen is showing. Manual Back/Next; starts at the first
  // group with an unlogged set on resume.
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
      const cur = next.get(key) ?? { reps: '', load: '' }
      next.set(key, { ...cur, [field]: value })
      return next
    })
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    const fieldKey = `${key}#${field}`
    setTouchedFields((prev) =>
      prev.has(fieldKey) ? prev : new Set(prev).add(fieldKey),
    )
  }

  // Persist one set from its current draft. Returns an error string (no
  // throw) so callers can show it inline. Used by the per-set Log button
  // and by saveAll. `draftsOverride` lets saveAll pass a consistent snapshot
  // (state updates within a loop don't reflect synchronously).
  async function saveSet(
    exerciseId: string,
    setNumber: number,
    draftsOverride?: Map<string, Draft>,
  ): Promise<{ error: string | null }> {
    const key = setKey(exerciseId, setNumber)
    const src = draftsOverride ?? drafts
    const d = src.get(key) ?? { reps: '', load: '' }
    const repMetric = prescribedRepMetric(exercises, exerciseId, setNumber)

    const repsNum = d.reps.trim() === '' ? null : parseInt(d.reps, 10)
    if (repsNum !== null && (!Number.isFinite(repsNum) || repsNum < 0)) {
      return { error: `${volumeUnitLabel(repMetric)} must be a whole number.` }
    }
    // The load box is headed by the prescribed unit, so a bare "80" is logged in
    // that unit (kg/lb); an explicit suffix the client types still wins.
    const parsedLoad = parseLoad(
      d.load,
      prescribedLoadUnit(exercises, exerciseId, setNumber) ?? 'kg',
    )

    const res = await logSetAction({
      sessionId,
      programExerciseId: exerciseId,
      setNumber,
      reps: repsNum,
      repMetric,
      weightValue: parsedLoad.weightValue,
      weightMetric: parsedLoad.weightMetric,
      optionalValue: parsedLoad.optionalValue,
      rpe: null,
    })
    if (res.error) return { error: res.error }

    const log: LoggedSet = {
      programExerciseId: exerciseId,
      setNumber,
      reps: repsNum,
      repMetric,
      weightValue: parsedLoad.weightValue,
      weightMetric: parsedLoad.weightMetric,
      optionalValue: parsedLoad.optionalValue,
    }
    setLogsByKey((prev) => new Map(prev).set(key, log))

    setDrafts((prev) => {
      const next = new Map(prev)
      // Canonicalise so it doesn't read as "edited" right after saving.
      const canonical = loggedToDraft(log)
      next.set(key, canonical)
      // Carry the numbers forward into later untouched, unlogged sets
      // (autofill on). Skips sets touched/logged at call time.
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

  // Log every still-unlogged set of one exercise in one tap, sequentially
  // (each shares the exercise_log find-or-create, so parallel could race).
  // Applies the same carry-forward the per-set Log does: an untouched set
  // inherits the previous set's values, so filling set 1 and tapping "Log
  // all" logs them all with set 1's numbers (autofill on). Hand-edited
  // (touched) sets keep their own. Works on a local copy because state
  // updates inside the loop don't reflect synchronously.
  async function saveAll(exerciseId: string): Promise<void> {
    const ex = exercises.find((e) => e.programExerciseId === exerciseId)
    if (!ex) return
    const working = new Map(drafts)
    let carry: Draft | null = null
    for (const ps of ex.prescribedSets) {
      const key = setKey(exerciseId, ps.setNumber)
      if (logsByKey.has(key)) {
        const lg = logsByKey.get(key)
        if (lg) carry = loggedToDraft(lg)
        continue
      }
      const own = working.get(key) ?? { reps: '', load: '' }
      const use = autofill && !touched.has(key) && carry ? carry : own
      working.set(key, use)
      // Stop on the first validation error so that set keeps its value for
      // the client to fix via its own Log button.
      const res = await saveSet(exerciseId, ps.setNumber, working)
      if (res.error) break
      carry = use
    }
  }

  function setNote(peId: string, text: string) {
    setNoteText((prev) => new Map(prev).set(peId, text))
  }

  async function saveNote(peId: string): Promise<{ error: string | null }> {
    const text = (noteText.get(peId) ?? '').trim()
    if (text === (noteSaved.get(peId) ?? '').trim()) return { error: null }
    const res = await logExerciseNoteAction(
      sessionId,
      peId,
      text.length === 0 ? null : text,
    )
    if (res.error) return { error: res.error }
    setNoteSaved((prev) => new Map(prev).set(peId, text))
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
  const noteKey = group.exercises[0]!.programExerciseId

  return (
    <>
      <TopBar
        dayId={dayId}
        groupIdx={currentGroupIdx}
        totalGroups={groups.length}
      />
      <GroupHead group={group} />
      <div style={{ padding: '0 20px 20px' }}>
        {group.exercises.map((gex) => {
          const unlogged = gex.prescribedSets.filter(
            (ps) => !logsByKey.has(setKey(gex.programExerciseId, ps.setNumber)),
          ).length
          return (
            <ExerciseBlock
              key={gex.programExerciseId}
              exercise={gex}
              compact={multi}
            >
              {unlogged >= 2 && (
                <LogAllButton
                  count={unlogged}
                  onRun={() => saveAll(gex.programExerciseId)}
                />
              )}
              {gex.prescribedSets.map((prescribed) => {
                const sn = prescribed.setNumber
                const key = setKey(gex.programExerciseId, sn)
                // Match last-logged by set number; an unmatched set (today has
                // more sets than last time) gets no reference line at all.
                const exLast = lastLogged[gex.exerciseId]
                const setLast = exLast?.sets.find((s) => s.setNumber === sn)
                return (
                  <SetRow
                    key={sn}
                    setNumber={sn}
                    prescribed={prescribed}
                    draft={drafts.get(key) ?? { reps: '', load: '' }}
                    logged={logsByKey.get(key)}
                    volumeTouched={touchedFields.has(`${key}#reps`)}
                    loadTouched={touchedFields.has(`${key}#load`)}
                    lastLogged={
                      exLast && setLast
                        ? { set: setLast, dateLabel: exLast.dateLabel }
                        : undefined
                    }
                    onChange={(field, value) =>
                      updateDraft(gex.programExerciseId, sn, field, value)
                    }
                    onSave={() => saveSet(gex.programExerciseId, sn)}
                  />
                )
              })}
            </ExerciseBlock>
          )
        })}
        <GroupNotes
          value={noteText.get(noteKey) ?? ''}
          onChange={(text) => setNote(noteKey, text)}
          onSave={() => saveNote(noteKey)}
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

// Bottom navigation between groups. "Next" is always tappable — the open
// form lets you advance with a set unlogged (skip); "Finish session" stays
// on the final RPE screen (§6.3.1). Back returns to finish a skipped set.
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

// Per-exercise video link (P1-3, §6.3.1). One tap opens the YouTube link
// externally (target="_blank" → iOS hands off to the YouTube app or an
// in-app Safari sheet; the PWA stays put). No embedded player, no external
// poster fetch, no backdrop-filter. Only rendered when a URL exists.
function VideoLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
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
        textDecoration: 'none',
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
    </a>
  )
}

// Optional per-group notes (P1-4, §6.3.1). Controlled by the Logger so the
// text survives Back/Next; saved on blur to the group's first exercise's
// exercise_logs.notes.
function GroupNotes({
  value,
  onChange,
  onSave,
}: {
  value: string
  onChange: (text: string) => void
  onSave: () => Promise<{ error: string | null }>
}) {
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleBlur() {
    setError(null)
    startTransition(async () => {
      const res = await onSave()
      if (res.error) setError(res.error)
    })
  }

  return (
    <div style={{ marginTop: 4, marginBottom: 12 }}>
      <div className="session-eyebrow" style={{ marginBottom: 6 }}>
        Notes · optional
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
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

// "Log all N sets" — logs every still-unlogged set of the exercise in one
// tap (their current boxes). The per-set Log buttons stay for one-at-a-time.
function LogAllButton({
  count,
  onRun,
}: {
  count: number
  onRun: () => Promise<void>
}) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(async () => { await onRun() })}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
        padding: '8px 14px',
        background: 'transparent',
        color: 'var(--session-accent)',
        border: '1px solid var(--session-border-active)',
        borderRadius: 'var(--radius-button)',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '.82rem',
        letterSpacing: '.02em',
        cursor: 'pointer',
      }}
    >
      <Check size={14} aria-hidden />
      {pending ? 'Logging…' : `Log all ${count} sets`}
    </button>
  )
}

// Group header — section title (once) + Superset / Tri-set / Giant set badge.
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

// One exercise within the active group: letter, name, instructions, rx,
// video, then its set rows / log-all (children).
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
      {exercise.videoUrl && <VideoLink url={exercise.videoUrl} />}
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  )
}

// One open, editable set row (P1-2 follow-up). Compact: inputs + a small
// Log/Save button in the header (no full-width button — saves space). Logged
// shows a green check + "Logged"; editing re-exposes "Save". Controlled by
// the parent's draft map so carry-forward / log-all update live.
function SetRow({
  setNumber,
  prescribed,
  draft,
  logged,
  volumeTouched,
  loadTouched,
  lastLogged,
  onChange,
  onSave,
}: {
  setNumber: number
  prescribed: PrescribedSet
  draft: Draft
  logged: LoggedSet | undefined
  // Whether the client has edited THIS set's volume / load field — a prefill
  // reads as a translucent ghost until its own field is touched.
  volumeTouched: boolean
  loadTouched: boolean
  // This set's actual from the client's most recent completed session, matched
  // by set number (Change 3). Only rendered as a reference line on kg/lb sets.
  lastLogged: { set: LastLoggedSet; dateLabel: string } | undefined
  onChange: (field: keyof Draft, value: string) => void
  onSave: () => Promise<{ error: string | null }>
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const dirty = logged !== undefined && !draftEqualsLogged(draft, logged)
  const done = logged !== undefined && !dirty

  // Metric-driven layout (Decision B). The volume box is always shown, headed by
  // the prescribed unit (Reps / Seconds / Metres). A load box appears ONLY when
  // kg/lb is the prescribed load metric — everything else (bodyweight, RPE/%/
  // tempo targets, or no metric at all) is volume-only. We never assume a load
  // the prescription didn't state.
  const repMetric = prescribed.repMetric
  const loadUnit =
    prescribed.optionalMetric === 'kg' || prescribed.optionalMetric === 'lb'
      ? prescribed.optionalMetric
      : null
  // Non-numeric prescriptions (max / AMRAP / "8-12") can't seed a
  // single number — the prescribed text becomes a placeholder hint and the
  // client types the actual achieved value.
  const repsNumeric =
    prescribed.reps != null && /^\d+$/.test(prescribed.reps.trim())
  const volumePlaceholder = repsNumeric
    ? undefined
    : prescribed.reps?.trim() || undefined
  // Ghost: any prefill — the prescription, a value carried from a previous set,
  // or the last-logged fallback — reads translucent until the client edits THAT
  // field. So one tap on Log commits the suggestion as-is, while a hand-edit
  // reads as a deliberate change. (Logged sets are never ghosted.)
  const volumeGhost = !done && !volumeTouched && draft.reps.trim() !== ''
  const loadGhost = !done && !loadTouched && draft.load.trim() !== ''

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
        padding: '10px 12px',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
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
            width: 24,
            height: 24,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          {done ? <Check size={13} aria-hidden /> : setNumber}
        </span>
        <span style={{ fontWeight: 600, fontSize: '.86rem', flex: 1 }}>
          Set {setNumber}
        </span>
        {done ? (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.7rem',
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              color: 'var(--session-text-muted)',
            }}
          >
            Logged
          </span>
        ) : (
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            style={{
              padding: '7px 16px',
              background: 'var(--session-cta-bg)',
              color: 'var(--session-cta-text)',
              border: 'none',
              borderRadius: 'var(--radius-button)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.82rem',
              letterSpacing: '.02em',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {pending ? '…' : dirty ? 'Save' : 'Log'}
          </button>
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
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: loadUnit ? '1fr 1fr' : '1fr',
          gap: 8,
        }}
      >
        <LogInput
          label={volumeUnitLabel(repMetric)}
          value={draft.reps}
          placeholder={volumePlaceholder}
          ghost={volumeGhost}
          onChange={(v) => onChange('reps', v)}
          inputMode="numeric"
        />
        {loadUnit && (
          <LogInput
            label={loadUnit}
            value={draft.load}
            ghost={loadGhost}
            onChange={(v) => onChange('load', v)}
            inputMode="decimal"
          />
        )}
      </div>

      {/* Reference line (Change 3) — load-only scope: shown only on kg/lb sets
          with a prior completed log carrying a weight. Reference only, never
          writes to the box; absent (no "last: —") when there's no prior. */}
      {loadUnit && lastLogged && lastLogged.set.weightValue != null && (
        <div
          style={{
            marginTop: 8,
            fontSize: '.72rem',
            color: 'var(--session-text-muted)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          last: {referenceLoad(lastLogged.set)} · {lastLogged.dateLabel}
        </div>
      )}
    </div>
  )
}

function LogInput({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
  // `ghost` renders a still-untouched prescribed default in muted text so it
  // reads as a soft suggestion rather than a value the client typed.
  ghost = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  inputMode?: 'numeric' | 'decimal' | 'text'
  placeholder?: string
  ghost?: boolean
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
        // Pre-select on focus: a drastic change is one type-over; a fine change
        // is direct entry on the native numeric keypad (inputMode).
        onFocus={(e) => e.currentTarget.select()}
        inputMode={inputMode}
        placeholder={placeholder}
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
          color: ghost
            ? 'var(--session-text-muted)'
            : 'var(--session-input-text)',
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
      // Redirects on success; only an error returns. P1-5: surface inline.
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
          placeholder="How did that feel? Anything worth noting?"
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

// The prescribed volume unit for a set (NULL = reps). Drives the input
// label and the unit persisted alongside the logged value.
function prescribedRepMetric(
  exercises: LoggerExercise[],
  exerciseId: string,
  setNumber: number,
): string | null {
  const ex = exercises.find((e) => e.programExerciseId === exerciseId)
  return (
    ex?.prescribedSets.find((s) => s.setNumber === setNumber)?.repMetric ?? null
  )
}

// The prescribed LOAD unit for a set — but only kg/lb, the units a client logs a
// load in. NULL for any other optional metric (rpe / % / tempo / bodyweight):
// those are targets, not loads, so there is no load box and no default unit.
function prescribedLoadUnit(
  exercises: LoggerExercise[],
  exerciseId: string,
  setNumber: number,
): string | null {
  const ex = exercises.find((e) => e.programExerciseId === exerciseId)
  const m = ex?.prescribedSets.find((s) => s.setNumber === setNumber)?.optionalMetric
  return m === 'kg' || m === 'lb' ? m : null
}

// "80kg × 6" / "40kg × 20m" / "80kg" — a kg/lb set's last completed actual, load
// first then the volume in its own unit. Only called when weightValue != null.
function referenceLoad(s: LastLoggedSet): string {
  const w = `${s.weightValue}${s.weightMetric ?? ''}`
  const vol = formatVolume(s.reps != null ? String(s.reps) : null, s.repMetric)
  return vol ? `${w} × ${vol}` : w
}

function mapFromLogs(logs: LoggedSet[]): Map<string, LoggedSet> {
  const m = new Map<string, LoggedSet>()
  for (const l of logs) m.set(setKey(l.programExerciseId, l.setNumber), l)
  return m
}

/**
 * Fold the ordered exercise list into on-screen groups. Consecutive
 * exercises sharing the same NON-NULL superset id merge into one group; a
 * standalone exercise (null id) is always its own singleton.
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

/** Draft strings reconstructed from a saved set (for editing + dirty checks).
 *  Load is the bare number — its unit lives in the box heading (metric-driven
 *  layout), and parseLoad re-attaches the prescribed unit on save. */
function loggedToDraft(l: LoggedSet): Draft {
  const load =
    l.weightValue !== null
      ? String(l.weightValue)
      : (l.optionalValue ?? '')
  return {
    reps: l.reps !== null ? String(l.reps) : '',
    load,
  }
}

/**
 * Draft seeded from the EP's prescription. Volume (reps) seeds only when it is a
 * plain number. Load seeds only on kg/lb sets, with the Change-3 priority: a
 * prescribed weight WINS (a deliberate prescription is never overwritten); only
 * when the kg/lb set carries no prescribed weight does the client's last-logged
 * actual (`lastSet`) pre-fill. RPE / % / tempo are targets, never logged.
 */
function draftFromPrescription(p: PrescribedSet, lastSet?: LastLoggedSet): Draft {
  const loadIsKgLb = p.optionalMetric === 'kg' || p.optionalMetric === 'lb'
  let load = ''
  if (loadIsKgLb) {
    if (p.optionalValue != null && p.optionalValue.trim() !== '') {
      load = p.optionalValue.trim()
    } else if (lastSet?.weightValue != null) {
      load = String(lastSet.weightValue)
    }
  }
  return {
    reps: p.reps && /^\d+$/.test(p.reps.trim()) ? p.reps.trim() : '',
    load,
  }
}

function draftEqualsLogged(d: Draft, l: LoggedSet): boolean {
  const x = loggedToDraft(l)
  return (
    d.reps.trim() === x.reps.trim() &&
    d.load.trim() === x.load.trim()
  )
}

/**
 * Seed the editable drafts for every set. A logged set always shows its saved
 * values. For an unlogged set with autofill ON, carry the most recent earlier
 * actuals in the same exercise; otherwise seed from the prescription — which,
 * on a kg/lb set with no prescribed weight, falls back to the matching
 * last-logged set (Change 3). With autofill OFF, leave it blank.
 */
function buildInitialDrafts(
  exercises: LoggerExercise[],
  logs: Map<string, LoggedSet>,
  autofill: boolean,
  lastLogged: Record<string, LastLoggedExercise>,
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
        if (lastActuals) {
          drafts.set(key, { ...lastActuals })
        } else {
          const lastSet = lastLogged[ex.exerciseId]?.sets.find(
            (s) => s.setNumber === p.setNumber,
          )
          drafts.set(key, draftFromPrescription(p, lastSet))
        }
      } else {
        drafts.set(key, { reps: '', load: '' })
      }
    }
  }
  return drafts
}

function buildRxLabel(e: LoggerExercise): string {
  const sets = e.prescribedSets
  if (sets.length === 0) return ''

  const first = sets[0]!
  const allSame = sets.every(
    (s) =>
      s.reps === first.reps &&
      s.repMetric === first.repMetric &&
      s.optionalMetric === first.optionalMetric &&
      s.optionalValue === first.optionalValue,
  )
  if (!allSame) return ''

  const bits: string[] = []
  const vol = formatVolume(first.reps, first.repMetric)
  if (vol) bits.push(`${sets.length} × ${vol}`)
  else bits.push(`${sets.length} sets`)
  if (first.optionalValue) {
    bits.push(formatOptional(first.optionalMetric, first.optionalValue))
  }
  return bits.join(' · ')
}

// Render a prescription's optional metric+value in house voice for the rx chip:
// "80kg" / "RPE 8" / "75%"; tempo and anything else pass through. The client
// never logs the last three (they are targets) — they belong on the summary only.
function formatOptional(metric: string | null, value: string): string {
  switch (metric) {
    case 'kg':
    case 'lb':
      return `${value}${metric}`
    case 'rpe':
      return `RPE ${value}`
    case 'percentage':
      return `${value}%`
    default:
      return value
  }
}

/**
 * Parse a load string into structured + free-text parts.
 *   "80kg" / "80" → { weightValue: 80, weightMetric: 'kg', optionalValue: null }
 *   "BW"          → { weightValue: null, weightMetric: null, optionalValue: 'BW' }
 *   ""            → all null
 */
function parseLoad(raw: string, defaultMetric: string = 'kg'): {
  weightValue: number | null
  weightMetric: string | null
  optionalValue: string | null
} {
  const s = raw.trim()
  if (!s) return { weightValue: null, weightMetric: null, optionalValue: null }

  const numMatch = /^(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?$/i.exec(s)
  if (numMatch) {
    const n = parseFloat(numMatch[1]!)
    // A bare number takes the prescribed (heading) unit; an explicit suffix wins.
    const metric = (numMatch[2] ?? defaultMetric).toLowerCase()
    return {
      weightValue: Number.isFinite(n) ? n : null,
      weightMetric: metric === 'lbs' ? 'lb' : metric,
      optionalValue: null,
    }
  }

  return { weightValue: null, weightMetric: null, optionalValue: s }
}

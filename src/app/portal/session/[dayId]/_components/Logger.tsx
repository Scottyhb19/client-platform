'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Check, X } from 'lucide-react'
import {
  completeSessionAction,
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
  // id (group size > 1) render together as one on-screen group and are
  // logged before advancing (P1-2, §6.3.1). NULL = standalone (singleton).
  supersetGroupId: string | null
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

interface LoggerProps {
  sessionId: string
  dayId: string
  dayLabel: string
  exercises: LoggerExercise[]
  existingLogs: LoggedSet[]
}

export function Logger({
  sessionId,
  dayId,
  dayLabel,
  exercises,
  existingLogs,
}: LoggerProps) {
  const [logsByKey, setLogsByKey] = useState<Map<string, LoggedSet>>(() => {
    const m = new Map<string, LoggedSet>()
    for (const l of existingLogs) {
      m.set(setKey(l.programExerciseId, l.setNumber), l)
    }
    return m
  })

  // Group consecutive exercises that share a superset/tri-set id (group
  // size > 1) into one on-screen group; standalone exercises are their own
  // singleton group. §6.3.1: a superset is shown together and logged before
  // advancing. Memoised — `exercises` is stable for the session.
  const groups = useMemo(() => buildGroups(exercises), [exercises])

  // Active position. The active set walks the current group ROUND-ROBIN by
  // set number (B1·1, B2·1, B1·2, B2·2 …) — how supersets are actually
  // performed (alternate exercises each round) — then advances to the next
  // group, then to completion. `.some(...)` per set number honours
  // non-contiguous set_numbers (e.g. after a soft-delete mid-list).
  const { activeGroupIdx, activeExId, activeSetNumber, allDone } = useMemo(() => {
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]!
      const maxSet = Math.max(
        0,
        ...group.exercises.map((e) =>
          e.prescribedSets.reduce((m, s) => Math.max(m, s.setNumber), 0),
        ),
      )
      for (let setNum = 1; setNum <= maxSet; setNum++) {
        for (const e of group.exercises) {
          const prescribes = e.prescribedSets.some((s) => s.setNumber === setNum)
          if (
            prescribes &&
            !logsByKey.has(setKey(e.programExerciseId, setNum))
          ) {
            return {
              activeGroupIdx: gi,
              activeExId: e.programExerciseId,
              activeSetNumber: setNum,
              allDone: false,
            }
          }
        }
      }
    }
    return {
      activeGroupIdx: groups.length,
      activeExId: '',
      activeSetNumber: 0,
      allDone: true,
    }
  }, [groups, logsByKey])

  if (allDone) {
    return (
      <CompletePrompt
        sessionId={sessionId}
        dayId={dayId}
        dayLabel={dayLabel}
      />
    )
  }

  const group = groups[activeGroupIdx]!
  const multi = group.exercises.length > 1

  return (
    <>
      <TopBar
        dayId={dayId}
        groupIdx={activeGroupIdx}
        totalGroups={groups.length}
      />
      <GroupHead group={group} />
      <div style={{ padding: '0 20px 20px' }}>
        {group.exercises.map((gex) => (
          <ExerciseBlock key={gex.programExerciseId} exercise={gex} compact={multi}>
            {gex.prescribedSets.map((prescribed) => {
              const setNumber = prescribed.setNumber
              const logged = logsByKey.get(
                setKey(gex.programExerciseId, setNumber),
              )
              const isActive =
                !logged &&
                gex.programExerciseId === activeExId &&
                setNumber === activeSetNumber
              const isLastPrescribed =
                setNumber ===
                gex.prescribedSets[gex.prescribedSets.length - 1]?.setNumber
              if (logged)
                return (
                  <SetRowDone
                    key={setNumber}
                    logged={logged}
                    setNumber={setNumber}
                  />
                )
              if (isActive)
                return (
                  <ActiveSet
                    key={setNumber}
                    sessionId={sessionId}
                    exercise={gex}
                    prescribed={prescribed}
                    isLast={isLastPrescribed}
                    onLogged={(log) =>
                      setLogsByKey((prev) => {
                        const next = new Map(prev)
                        next.set(setKey(log.programExerciseId, log.setNumber), log)
                        return next
                      })
                    }
                  />
                )
              return <SetRowPending key={setNumber} setNumber={setNumber} />
            })}
          </ExerciseBlock>
        ))}
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
  const pct =
    totalGroups === 0 ? 0 : ((groupIdx + 1) / totalGroups) * 100
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

// Group header — section title (once for the whole group) + a Superset /
// Tri-set / Giant set badge when the group holds more than one exercise.
// Renders outside the set-rows container, so it carries its own 20px gutter.
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
          // Superset/tri-set badge — a sanctioned accent use (a grouping
          // signal, not decoration): the group must read as one unit (§6.3.1).
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
// summary, then its set rows (passed as children). Rendered inside the
// set-rows container, so no horizontal gutter of its own.
function ExerciseBlock({
  exercise,
  compact,
  children,
}: {
  exercise: LoggerExercise
  // True when the exercise sits in a multi-exercise group — the name shrinks
  // so two/three stack cleanly; a standalone exercise keeps the hero size.
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
      {children}
    </div>
  )
}

function SetRowPending({ setNumber }: { setNumber: number }) {
  return (
    <div
      style={{
        background: 'var(--session-card)',
        border: '1px solid var(--session-border)',
        borderRadius: 'var(--radius-card-dense)',
        padding: '12px 14px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.78rem',
          color: 'var(--session-num-pending-text)',
          background: 'var(--session-num-pending-bg)',
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {setNumber}
      </span>
      <span style={{ fontWeight: 600, fontSize: '.88rem', flex: 1 }}>
        Set {setNumber}
      </span>
    </div>
  )
}

function SetRowDone({
  logged,
  setNumber,
}: {
  logged: LoggedSet
  setNumber: number
}) {
  const parts: string[] = []
  if (logged.reps !== null) parts.push(`${logged.reps} reps`)
  if (logged.weightValue !== null)
    parts.push(
      `${logged.weightValue}${logged.weightMetric ?? ''}`.trim(),
    )
  else if (logged.optionalValue) parts.push(logged.optionalValue)
  if (logged.rpe !== null) parts.push(`RPE ${logged.rpe}`)
  return (
    <div
      style={{
        background: 'var(--session-card-done)',
        border: '1px solid var(--session-border)',
        borderRadius: 'var(--radius-card-dense)',
        padding: '12px 14px',
        marginBottom: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.78rem',
          color: 'var(--session-on-accent)',
          background: 'var(--session-accent)',
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <Check size={14} aria-hidden />
      </span>
      <span style={{ fontWeight: 600, fontSize: '.88rem', flex: 1 }}>
        Set {setNumber}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.82rem',
          color: 'var(--session-text-muted)',
        }}
      >
        {parts.join(' · ')}
      </span>
    </div>
  )
}

function ActiveSet({
  sessionId,
  exercise,
  prescribed,
  isLast,
  onLogged,
}: {
  sessionId: string
  exercise: LoggerExercise
  prescribed: PrescribedSet
  isLast: boolean
  onLogged: (log: LoggedSet) => void
}) {
  // Reps prefill: only when the prescription is a numeric reps value.
  const [reps, setReps] = useState(
    prescribed.reps && /^\d+$/.test(prescribed.reps.trim())
      ? prescribed.reps.trim()
      : '',
  )
  // Load prefill: optional_value, unless the metric is RPE (in which case
  // optional_value is the prescribed RPE and shouldn't go in the load slot).
  const [load, setLoad] = useState(
    prescribed.optionalMetric === 'rpe' ? '' : (prescribed.optionalValue ?? ''),
  )
  // RPE prefill: when the metric is rpe, surface the prescribed RPE; the
  // client overwrites with their actual perceived RPE during the set.
  const [rpe, setRpe] = useState(
    prescribed.optionalMetric === 'rpe' ? (prescribed.optionalValue ?? '') : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const setNumber = prescribed.setNumber

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const repsNum = reps.trim() === '' ? null : parseInt(reps, 10)
    const rpeNum = rpe.trim() === '' ? null : parseInt(rpe, 10)
    if (repsNum !== null && (!Number.isFinite(repsNum) || repsNum < 0)) {
      setError('Reps must be a whole number.')
      return
    }
    if (rpeNum !== null && (!Number.isFinite(rpeNum) || rpeNum < 1 || rpeNum > 10)) {
      setError('RPE is 1–10.')
      return
    }

    const parsedLoad = parseLoad(load)

    setError(null)
    startTransition(async () => {
      const res = await logSetAction({
        sessionId,
        programExerciseId: exercise.programExerciseId,
        setNumber,
        reps: repsNum,
        weightValue: parsedLoad.weightValue,
        weightMetric: parsedLoad.weightMetric,
        optionalValue: parsedLoad.optionalValue,
        rpe: rpeNum,
      })
      if (res.error) {
        setError(res.error)
        return
      }
      onLogged({
        programExerciseId: exercise.programExerciseId,
        setNumber,
        reps: repsNum,
        weightValue: parsedLoad.weightValue,
        weightMetric: parsedLoad.weightMetric,
        optionalValue: parsedLoad.optionalValue,
        rpe: rpeNum,
      })
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        background: 'var(--session-card-active)',
        border: '1px solid var(--session-border-active)',
        borderRadius: 'var(--radius-card-dense)',
        padding: '12px 14px',
        marginBottom: 8,
        boxShadow: '0 0 0 3px var(--session-active-ring)',
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
            color: 'var(--session-on-accent)',
            background: 'var(--session-accent)',
            width: 26,
            height: 26,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {setNumber}
        </span>
        <span style={{ fontWeight: 600, fontSize: '.88rem', flex: 1 }}>
          Set {setNumber}
        </span>
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
          marginBottom: 10,
        }}
      >
        <LogInput
          label="Reps"
          value={reps}
          onChange={setReps}
          inputMode="numeric"
        />
        <LogInput label="Load" value={load} onChange={setLoad} />
        <LogInput
          label="RPE"
          value={rpe}
          onChange={setRpe}
          inputMode="numeric"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        style={{
          width: '100%',
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
        {pending
          ? 'Saving…'
          : isLast
            ? 'Finish exercise · next'
            : 'Log set · next'}
      </button>
    </form>
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
        }}
      />
    </div>
  )
}

function CompletePrompt({
  sessionId,
  dayId,
  dayLabel,
}: {
  sessionId: string
  dayId: string
  dayLabel: string
}) {
  const [pending, startTransition] = useTransition()
  const [feedback, setFeedback] = useState('')
  const [sessionRpe, setSessionRpe] = useState<number | null>(null)

  function handleComplete() {
    const trimmed = feedback.trim()
    startTransition(async () => {
      const res = await completeSessionAction(
        sessionId,
        dayId,
        trimmed.length === 0 ? null : trimmed,
        sessionRpe,
      )
      if (res && res.error) alert(res.error)
    })
  }

  return (
    <div
      style={{
        padding: '40px 24px 20px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--session-accent)',
          margin: '0 auto 20px',
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
        // Same accent-override as the active exercise eyebrow: this is
        // the celebratory state, not a quiet label.
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
        All the work is in.
      </h2>

      {/* Optional session RPE — 1-10 chips. Null = skipped. The RPC accepts
          NULL since 20260510130100_client_complete_session_v2. */}
      <div style={{ marginBottom: 18, textAlign: 'left' }}>
        <div
          className="session-eyebrow"
          style={{ marginBottom: 8 }}
        >
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

      {/* Optional free-text feedback. Empty string normalises to NULL on
          submit so blank submissions don't store '' in sessions.feedback.
          maxLength is a hard cap; the counter only surfaces once the client
          is approaching it (>400 chars) so the field stays quiet in the
          common short-note case. */}
      <div style={{ marginBottom: 24, textAlign: 'left' }}>
        <div
          className="session-eyebrow"
          style={{ marginBottom: 8 }}
        >
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

      <button
        type="button"
        onClick={handleComplete}
        disabled={pending}
        className="portal-btn-primary"
        // Session-themed CTA: keep the primitive's sizing/font/radius, swap
        // the colours to the in-session palette so it reads on the dark
        // (or light) session surface rather than the portal default.
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

/**
 * Fold the ordered exercise list into on-screen groups. Consecutive
 * exercises sharing the same NON-NULL superset id merge into one group
 * (a superset/tri-set); a standalone exercise (null id) is always its own
 * singleton group — two adjacent standalones never merge. Preserves order.
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

function buildRxLabel(e: LoggerExercise): string {
  const sets = e.prescribedSets
  if (sets.length === 0) return ''

  // Q5 sign-off (2026-05-07): render the eyebrow summary only when every
  // set is identical. Wave-loading and other non-uniform prescriptions
  // hide the summary — the per-set rows below speak for themselves.
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
 *   "80kg"   → { weightValue: 80, weightMetric: 'kg', optionalValue: null }
 *   "80"     → { weightValue: 80, weightMetric: 'kg', optionalValue: null }
 *   "BW"     → { weightValue: null, weightMetric: null, optionalValue: 'BW' }
 *   ""       → all null
 */
function parseLoad(raw: string): {
  weightValue: number | null
  weightMetric: string | null
  optionalValue: string | null
} {
  const s = raw.trim()
  if (!s) return { weightValue: null, weightMetric: null, optionalValue: null }

  // Matches "80", "80 kg", "80kg", "80.5", "80.5lb"
  const numMatch = /^(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?$/i.exec(s)
  if (numMatch) {
    const n = parseFloat(numMatch[1])
    const metric = (numMatch[2] ?? 'kg').toLowerCase()
    return {
      weightValue: Number.isFinite(n) ? n : null,
      weightMetric: metric === 'lbs' ? 'lb' : metric,
      optionalValue: null,
    }
  }

  // Anything else — "BW", "45kg each side", "2x bands" — goes to optional.
  return { weightValue: null, weightMetric: null, optionalValue: s }
}

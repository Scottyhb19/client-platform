'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { Check, X } from 'lucide-react'
import {
  completeSessionAction,
  logSetAction,
} from '../actions'

export type LoggerExercise = {
  programExerciseId: string
  name: string
  sectionTitle: string | null
  instructions: string | null
  sets: number
  reps: string | null
  optionalValue: string | null // prescribed load as free-text
  rpe: number | null
  letter: string
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

  // Derived: the first unlogged exercise/set is "active". If everything
  // is logged, the session is ready to complete.
  const { activeExIdx, activeSetNumber, allDone } = useMemo(() => {
    for (let exIdx = 0; exIdx < exercises.length; exIdx++) {
      const ex = exercises[exIdx]
      for (let s = 1; s <= ex.sets; s++) {
        if (!logsByKey.has(setKey(ex.programExerciseId, s))) {
          return { activeExIdx: exIdx, activeSetNumber: s, allDone: false }
        }
      }
    }
    return { activeExIdx: exercises.length, activeSetNumber: 0, allDone: true }
  }, [exercises, logsByKey])

  if (allDone) {
    return (
      <CompletePrompt
        sessionId={sessionId}
        dayId={dayId}
        dayLabel={dayLabel}
      />
    )
  }

  const ex = exercises[activeExIdx]

  return (
    <>
      <TopBar
        dayId={dayId}
        exerciseIdx={activeExIdx}
        totalExercises={exercises.length}
      />
      <ExerciseHead exercise={ex} />
      <div style={{ padding: '0 20px 20px' }}>
        {Array.from({ length: ex.sets }).map((_, i) => {
          const setNumber = i + 1
          const logged = logsByKey.get(
            setKey(ex.programExerciseId, setNumber),
          )
          const isActive = !logged && setNumber === activeSetNumber
          if (logged) return <SetRowDone key={setNumber} logged={logged} setNumber={setNumber} />
          if (isActive)
            return (
              <ActiveSet
                key={setNumber}
                sessionId={sessionId}
                exercise={ex}
                setNumber={setNumber}
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
      </div>
    </>
  )
}

/* ====================== Sub-components ====================== */

function TopBar({
  dayId,
  exerciseIdx,
  totalExercises,
}: {
  dayId: string
  exerciseIdx: number
  totalExercises: number
}) {
  const pct =
    totalExercises === 0 ? 0 : ((exerciseIdx + 1) / totalExercises) * 100
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
            color: 'var(--color-text-light)',
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
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
          }}
        >
          Exercise {exerciseIdx + 1} of {totalExercises}
        </div>
        <div style={{ width: 46 }} />
      </div>
      <div style={{ padding: '0 20px 16px' }}>
        <div
          style={{
            height: 4,
            background: 'var(--color-border-subtle)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'var(--color-primary)',
              transition: 'width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </div>
      </div>
      {/* Dummy dayId reference so the hook's revalidation target stays
          typed; unused at runtime. */}
      <div data-session-day={dayId} style={{ display: 'none' }} />
    </>
  )
}

function ExerciseHead({ exercise }: { exercise: LoggerExercise }) {
  const rx = buildRxLabel(exercise)
  return (
    <div style={{ padding: '0 20px', marginBottom: 16 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.72rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--color-primary)',
        }}
      >
        {exercise.sectionTitle
          ? `${exercise.sectionTitle} · ${exercise.letter}`
          : exercise.letter}
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.8rem',
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
            color: 'var(--color-text-light)',
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
            display: 'inline-block',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.95rem',
            color: 'var(--color-charcoal)',
            background: 'var(--color-surface)',
            padding: '6px 12px',
            borderRadius: 7,
          }}
        >
          {rx}
        </div>
      )}
    </div>
  )
}

function SetRowPending({ setNumber }: { setNumber: number }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
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
          color: '#fff',
          background: '#C7BEB4',
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
        background: 'rgba(45,178,76,.04)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
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
          color: '#fff',
          background: 'var(--color-accent)',
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
          color: 'var(--color-text-light)',
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
  setNumber,
  onLogged,
}: {
  sessionId: string
  exercise: LoggerExercise
  setNumber: number
  onLogged: (log: LoggedSet) => void
}) {
  const [reps, setReps] = useState(
    exercise.reps && /^\d+$/.test(exercise.reps.trim())
      ? exercise.reps.trim()
      : '',
  )
  const [load, setLoad] = useState(exercise.optionalValue ?? '')
  const [rpe, setRpe] = useState(
    exercise.rpe !== null ? String(exercise.rpe) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const isLastSet = setNumber === exercise.sets

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
        background: '#fff',
        border: '1px solid var(--color-primary)',
        borderRadius: 10,
        padding: '12px 14px',
        marginBottom: 8,
        boxShadow: '0 0 0 3px rgba(30,26,24,.08)',
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
            color: '#fff',
            background: 'var(--color-primary)',
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
            background: 'rgba(214,64,69,.08)',
            border: '1px solid rgba(214,64,69,.25)',
            borderRadius: 6,
            color: 'var(--color-alert)',
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
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.1rem',
          letterSpacing: '.02em',
          cursor: 'pointer',
        }}
      >
        {pending
          ? 'Saving…'
          : isLastSet
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
          color: 'var(--color-muted)',
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
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 7,
          background: 'var(--color-surface)',
          textAlign: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.05rem',
          color: 'var(--color-charcoal)',
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

  function handleComplete() {
    startTransition(async () => {
      const res = await completeSessionAction(
        sessionId,
        dayId,
        null, // feedback — collected on the completion screen
        null, // session_rpe — could average per-set rpes here
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
          background: 'var(--color-accent)',
          margin: '0 auto 20px',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          fontSize: '1.8rem',
        }}
      >
        <Check size={28} aria-hidden />
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.72rem',
          letterSpacing: '.06em',
          textTransform: 'uppercase',
          color: 'var(--color-primary)',
        }}
      >
        {dayLabel} · sets logged
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '2rem',
          margin: '6px 0 14px',
          letterSpacing: '-.01em',
        }}
      >
        All the work is in.
      </h2>
      <p
        style={{
          fontSize: '.92rem',
          color: 'var(--color-text-light)',
          lineHeight: 1.5,
          marginBottom: 28,
        }}
      >
        One step left — tap below to wrap up and review the session.
      </p>
      <button
        type="button"
        onClick={handleComplete}
        disabled={pending}
        style={{
          width: '100%',
          padding: 16,
          background: 'var(--color-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.1rem',
          letterSpacing: '.02em',
          cursor: 'pointer',
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

function buildRxLabel(e: LoggerExercise): string {
  const bits: string[] = []
  if (e.sets && e.reps) bits.push(`${e.sets} × ${e.reps}`)
  else if (e.sets) bits.push(`${e.sets} sets`)
  else if (e.reps) bits.push(e.reps)
  if (e.optionalValue) bits.push(e.optionalValue)
  if (e.rpe) bits.push(`RPE ${e.rpe}`)
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

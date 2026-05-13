import type {
  ProfileCompletionExercise,
  ProfileCompletionSet,
} from '../clients/[id]/_components/ClientProfile'

interface SessionExerciseSummaryProps {
  exercises: ProfileCompletionExercise[]
}

/**
 * Per-exercise + per-set summary surface for a completed session.
 *
 * Consumed by:
 *   - Phase D's CompletionsPanel rows (client profile Program tab right rail)
 *   - Phase L's RecentlyCompletedPanel rows (dashboard bottom slot)
 *
 * Rendering rules:
 *   - Exercises ordered by `sort_order` (already sorted by the loader).
 *   - Sequence letters (A, A1, A2, B...) computed inline — mirrors the
 *     portal DayScreen + the staff session-builder convention. Single
 *     exercise per "group" gets a bare letter (A); supersetted exercises
 *     get A1/A2.
 *   - Each set line: "{load} × {reps}" or "{reps} reps" or the optional
 *     metric on its own, then a right-aligned RPE chip when present.
 *   - Skip-to-complete sessions (zero exercise_logs) render nothing — the
 *     parent should hide the expander chevron when `set_count === 0`
 *     per the Q-L11 sign-off.
 *
 * Pure presentation. No state, no fetching, no side effects.
 */
export function SessionExerciseSummary({
  exercises,
}: SessionExerciseSummaryProps) {
  if (exercises.length === 0) return null

  const rows = withSequenceLetters(exercises)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {rows.map((e) => (
        <ExerciseBlock key={e.exercise_log_id} exercise={e} />
      ))}
    </div>
  )
}

type ExerciseRow = ProfileCompletionExercise & { letter: string }

/**
 * Walk the exercises once, tagging each with its A/A1/A2/B letter based on
 * superset_group_id. Consecutive rows with the same group_id share a base
 * letter and increment a subindex; rows in a single-member group get a bare
 * letter. Logic matches src/app/portal/page.tsx:buildExerciseList.
 */
function withSequenceLetters(
  exercises: ProfileCompletionExercise[],
): ExerciseRow[] {
  const groupCounts = new Map<string, number>()
  for (const e of exercises) {
    if (e.superset_group_id) {
      groupCounts.set(
        e.superset_group_id,
        (groupCounts.get(e.superset_group_id) ?? 0) + 1,
      )
    }
  }

  let groupLetterIndex = -1
  let currentGroupId: string | null = null
  let subIndex = 0

  return exercises.map((e) => {
    const groupId = e.superset_group_id
    const inSuperset =
      groupId !== null && (groupCounts.get(groupId) ?? 1) > 1

    let letter: string
    if (!groupId || groupId !== currentGroupId) {
      groupLetterIndex += 1
      currentGroupId = groupId
      subIndex = 1
      const base = String.fromCharCode(65 + groupLetterIndex)
      letter = inSuperset ? `${base}1` : base
    } else {
      subIndex += 1
      letter = `${String.fromCharCode(65 + groupLetterIndex)}${subIndex}`
    }

    return { ...e, letter }
  })
}

function ExerciseBlock({ exercise }: { exercise: ExerciseRow }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.74rem',
            letterSpacing: '.04em',
            color: 'var(--color-text-light)',
            minWidth: 22,
          }}
        >
          {exercise.letter}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: '.86rem',
            color: 'var(--color-charcoal)',
          }}
        >
          {exercise.exercise_name}
        </span>
      </div>
      {exercise.sets.length === 0 ? (
        <div
          style={{
            paddingLeft: 30,
            fontSize: '.76rem',
            color: 'var(--color-muted)',
            fontStyle: 'italic',
          }}
        >
          No sets logged
        </div>
      ) : (
        <div
          style={{
            paddingLeft: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {exercise.sets.map((s) => (
            <SetLine key={s.set_number} set={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SetLine({ set }: { set: ProfileCompletionSet }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '54px 1fr auto',
        gap: 10,
        alignItems: 'baseline',
        fontSize: '.78rem',
        color: 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          letterSpacing: '.04em',
          fontSize: '.66rem',
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
        }}
      >
        Set {set.set_number}
      </span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
        {formatSetDetail(set)}
      </span>
      {set.rpe !== null && (
        <span
          style={{
            fontSize: '.7rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            color: 'var(--color-text-light)',
            letterSpacing: '.02em',
          }}
        >
          RPE {set.rpe}
        </span>
      )}
    </div>
  )
}

/**
 * Compose the set's middle column. Rules:
 *   - weight + reps  → "80kg × 5"
 *   - reps only      → "5 reps"
 *   - optional only  → "60s" / "8 e/s" (passed through; the EP types units
 *                       into optional_value at programming time)
 *   - everything missing → "—"
 *
 * Weight metric concatenates without space ("80kg") per the design system's
 * tight-numeric-label convention. The × is U+00D7, not the ASCII letter x.
 */
function formatSetDetail(s: ProfileCompletionSet): string {
  const bits: string[] = []
  if (s.weight_value !== null && s.weight_metric) {
    bits.push(`${s.weight_value}${s.weight_metric}`)
  }
  if (s.reps !== null) {
    if (bits.length > 0) {
      bits.push(`× ${s.reps}`)
    } else {
      bits.push(`${s.reps} reps`)
    }
  }
  if (s.optional_value) {
    bits.push(s.optional_value)
  }
  return bits.length > 0 ? bits.join(' ') : '—'
}

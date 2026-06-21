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
 *   - the client profile Program-tab completions rail (CompletionsPanel)
 *   - the dashboard "Recently completed" expander (RecentlyCompletedPanel)
 *
 * §11 P2-7 redesign: each exercise's sets sit in a soft tinted block with
 * content-sized, column-aligned cells (set #, result, RPE) so load/reps/RPE
 * read *down* the sets at a glance, and the result and its RPE stay close
 * together instead of being thrown to opposite edges by a stretched column.
 * Type hierarchy carries the meaning — the weight is the prominent number,
 * the unit is lighter — so it reads as a summary, not a spreadsheet. RPE is a
 * neutral pill (never green; green is reserved for completion). Tuned to read
 * well at both the wide dashboard expander and the narrow profile rail.
 *
 * Rendering rules:
 *   - Exercises ordered by `sort_order` (already sorted by the loader).
 *   - Sequence letters (A, A1, A2, B...) computed inline — mirrors the portal
 *     DayScreen + the staff session-builder convention. Single exercise per
 *     "group" gets a bare letter (A); supersetted exercises get A1/A2.
 *   - Skip-to-complete sessions (zero exercise_logs) render nothing — the
 *     parent hides the expander chevron when `set_count === 0`.
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
          alignItems: 'center',
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.02em',
            color: 'var(--color-charcoal)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-button)',
            padding: '2px 7px',
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
            marginLeft: 2,
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
            marginLeft: 2,
            width: 'fit-content',
            maxWidth: '100%',
            display: 'inline-grid',
            gridTemplateColumns: 'auto auto auto',
            columnGap: 18,
            rowGap: 7,
            alignItems: 'baseline',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-hairline)',
            borderRadius: 'var(--radius-card-dense)',
            padding: '10px 14px',
          }}
        >
          {exercise.sets.map((s) => (
            <SetCells key={s.set_number} set={s} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Three grid cells for one set: index, result, RPE (or an empty cell so rows
 * without an RPE still align with rows that have one).
 */
function SetCells({ set }: { set: ProfileCompletionSet }) {
  return (
    <>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
          fontSize: '.72rem',
          color: 'var(--color-muted)',
          textAlign: 'right',
          minWidth: 12,
        }}
      >
        {set.set_number}
      </span>
      <span style={{ whiteSpace: 'nowrap' }}>
        <SetResult set={set} />
      </span>
      {set.rpe !== null ? (
        <span
          style={{
            justifySelf: 'start',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.66rem',
            letterSpacing: '.02em',
            color: 'var(--color-text-light)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-pill)',
            padding: '2px 8px',
          }}
        >
          RPE {set.rpe}
        </span>
      ) : (
        <span />
      )}
    </>
  )
}

const numStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: '1rem',
  color: 'var(--color-charcoal)',
}
const unitStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
  fontSize: '.72rem',
  color: 'var(--color-text-light)',
}
const sepStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  fontSize: '.86rem',
  color: 'var(--color-text-light)',
  margin: '0 3px',
}

/**
 * Render the set's result with type hierarchy:
 *   weight + reps  → "80kg × 5"  (kg lighter, × the U+00D7 sign)
 *   reps only      → "5 reps"
 *   optional only  → "60s" / "8 e/s" (the EP's free-typed optional value)
 *   everything     → "80kg × 5" then the optional value appended
 *   nothing logged → "—"
 */
function SetResult({ set }: { set: ProfileCompletionSet }) {
  const hasWeight = set.weight_value !== null && !!set.weight_metric
  const hasReps = set.reps !== null
  const hasOptional = !!set.optional_value

  if (!hasWeight && !hasReps && !hasOptional) {
    return <span style={numStyle}>—</span>
  }

  return (
    <>
      {hasWeight && (
        <>
          <span style={numStyle}>{set.weight_value}</span>
          <span style={unitStyle}>{set.weight_metric}</span>
        </>
      )}
      {hasReps &&
        (hasWeight ? (
          <>
            <span style={sepStyle}>×</span>
            <span style={numStyle}>{set.reps}</span>
          </>
        ) : (
          <>
            <span style={numStyle}>{set.reps}</span>
            <span style={{ ...unitStyle, marginLeft: 4 }}>reps</span>
          </>
        ))}
      {hasOptional && (
        <span
          style={{
            ...sepStyle,
            margin: 0,
            marginLeft: hasWeight || hasReps ? 8 : 0,
          }}
        >
          {set.optional_value}
        </span>
      )}
    </>
  )
}

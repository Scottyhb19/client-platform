import type {
  ProfileCompletionExercise,
  ProfileCompletionSet,
} from '../clients/[id]/_components/ClientProfile'
import { formatVolume } from '@/lib/prescription/volume-units'

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
 * Each exercise renders as a self-contained white card tile — a header row
 * (sequence badge + name) over a hairline-divided set grid with content-sized,
 * column-aligned cells (set #, result, RPE) so load/reps/RPE read *down* the
 * sets at a glance, and the result and its RPE stay close together instead of
 * being thrown to opposite edges by a stretched column. Type hierarchy carries
 * the meaning — the weight is the prominent number, the unit is lighter — so it
 * reads as a summary, not a spreadsheet.
 *
 * Colour: the sequence badge is accent-green-tinted (same treatment as the
 * `.tag.new` atom). Green is sanctioned here on two counts — it is a completed
 * session (a success state) and the badge is a sequence bubble — so the tiles
 * carry the same quiet "done" identity the in-session logger gives a finished
 * exercise card (--session-card-done). RPE stays a neutral pill (never green;
 * green marks completion, not effort). The tiles are white so they sit as cards
 * on the warm surface canvas both expanders provide — identical read on the
 * wide dashboard expander and the narrow profile rail.
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
        gap: 8,
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
  const hasSets = exercise.sets.length > 0
  return (
    <div
      style={{
        background: 'var(--color-card)',
        border: '1px solid var(--color-border-hairline)',
        borderRadius: 'var(--radius-card-dense)',
        overflow: 'hidden',
      }}
    >
      {/* Header — accent-tinted sequence badge + exercise name. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          padding: '9px 12px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.02em',
            color: 'var(--color-accent)',
            background: 'var(--color-accent-soft)',
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
      {/* Sets — hairline-divided from the header, sitting directly on the
          tile (no nested box); the grid is content-sized so the columns
          align down the sets. */}
      {hasSets ? (
        <div
          style={{
            borderTop: '1px solid var(--color-border-hairline)',
            padding: '9px 12px 10px',
          }}
        >
          <div
            style={{
              width: 'fit-content',
              maxWidth: '100%',
              display: 'inline-grid',
              gridTemplateColumns: 'auto auto auto',
              columnGap: 16,
              rowGap: 6,
              alignItems: 'baseline',
            }}
          >
            {exercise.sets.map((s) => (
              <SetCells key={s.set_number} set={s} />
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            borderTop: '1px solid var(--color-border-hairline)',
            padding: '8px 12px 9px',
            fontSize: '.76rem',
            color: 'var(--color-muted)',
            fontStyle: 'italic',
          }}
        >
          No sets logged
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
  // Volume rendered in its unit: "5" (reps), "30s" (time), "20m" (distance).
  const volume =
    set.reps !== null ? formatVolume(String(set.reps), set.rep_metric) : null

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
      {volume &&
        (hasWeight ? (
          <>
            <span style={sepStyle}>×</span>
            <span style={numStyle}>{volume}</span>
          </>
        ) : set.rep_metric ? (
          // Timed/distance: the unit is already in the value ("30s", "20m"),
          // so no "reps" suffix.
          <span style={numStyle}>{volume}</span>
        ) : (
          <>
            <span style={numStyle}>{volume}</span>
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

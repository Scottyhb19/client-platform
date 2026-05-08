import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  SessionBuilder,
  type ExerciseTagOption,
  type LastLogged,
  type LibraryPick,
  type MetricUnitOption,
  type MovementPatternOption,
  type ProgramExercise,
  type SectionTitleOption,
} from './_components/SessionBuilder'
import { type PinnedNote } from '../../../_components/NotesPanel'
import { type SessionReport } from '../../../_components/ReportsPanel'
import { AssignButton } from './_components/AssignButton'
import { DayLabelEditor } from './_components/DayLabelEditor'
import { DuplicateButton } from './_components/DuplicateButton'

export const dynamic = 'force-dynamic'

/**
 * 09 Session Builder.
 *
 * C11a scope:
 *   - Load program_day + its program_exercises (with exercise join).
 *   - Render dark slab cards with prescription readout.
 *   - Right panel: Library (searchable, click → add) + Notes (pinned).
 *   - Add + soft-delete are wired.
 *
 * Deferred:
 *   - Inline editing of sets/reps/load/RPE/rest/tempo.
 *   - Drag/drop reorder.
 *   - Superset grouping + section header editing.
 *   - "Assign to client" / publish status.
 */
export default async function SessionBuilderPage({
  params,
}: {
  params: Promise<{ id: string; dayId: string }>
}) {
  const { id, dayId } = await params
  const supabase = await createSupabaseServerClient()

  // Day + parent program — fail if the day belongs to a different client.
  // Post D-PROG-001: program_days carries program_id directly, so the
  // join is one hop; program_week_id may be NULL (optional periodisation
  // grouping) and is no longer required for the breadcrumb.
  const { data: day } = await supabase
    .from('program_days')
    .select(
      `id, day_label, scheduled_date, sort_order, published_at,
       program:programs(id, name, client_id)`,
    )
    .eq('id', dayId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!day || day.program?.client_id !== id) notFound()

  // Client for header context.
  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!client) notFound()

  // Session content + library pool + pinned notes + reports + section
  // titles + movement patterns + exercise tags + metric units in parallel.
  // The library query carries movement_pattern_id and a flat tag_ids
  // array so the panel's chip filters can run client-side without a
  // second round trip.
  // Phase E (2026-05-07): adds section_titles + movement_patterns +
  // exercise_tags loads for the SectionTitleField dropdown and the
  // LibraryPanel chip filters.
  // Phase F (2026-05-07): adds exercise_metric_units load for the
  // SetMetricCell dropdown — same source as library/new/page.tsx
  // (filter is_active = true, deleted_at IS NULL, ordered by sort_order).
  const [
    { data: programExercisesRaw, error: peErr },
    { data: libraryRaw },
    { data: notesRaw },
    { data: reportsRaw },
    { data: sectionTitlesRaw },
    { data: patternsRaw },
    { data: tagsRaw },
    { data: metricUnitsRaw },
  ] = await Promise.all([
    supabase
      .from('program_exercises')
      .select(
        `id, sort_order, section_title, superset_group_id,
         rest_seconds, tempo, instructions,
         exercise_id,
         exercise:exercises(name, video_url),
         prescription_sets:program_exercise_sets(
           id, set_number, reps, optional_metric, optional_value, deleted_at
         )`,
      )
      .eq('program_day_id', dayId)
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('exercises')
      .select(
        `id, name, movement_pattern_id,
         movement_pattern:movement_patterns(name),
         tag_assignments:exercise_tag_assignments(tag_id)`,
      )
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('clinical_notes')
      .select(`id, body_rich, subjective, flag_body_region`)
      .eq('client_id', id)
      .eq('is_pinned', true)
      .is('deleted_at', null)
      .order('note_date', { ascending: false }),
    supabase
      .from('reports')
      .select('id, title, report_type, test_date, is_published')
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('test_date', { ascending: false })
      .limit(20),
    supabase
      .from('section_titles')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('movement_patterns')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('exercise_tags')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('exercise_metric_units')
      .select('code, display_label')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('sort_order'),
  ])

  if (peErr) throw new Error(`Load program exercises: ${peErr.message}`)

  // Phase H (2026-05-08): "Last logged" footer per exercise card.
  // For each exercise_id on this day, find the most recent completed
  // exercise_log for THIS client, with its set_logs. Pre-launch the result
  // is empty for every row — fine, the footer just doesn't render.
  //
  // Why join via sessions!inner + filter on sessions.client_id rather than
  // trusting RLS alone: exercise_logs.exercise_id is shared across all
  // clients in the org (durable FK to the exercises catalog), so without
  // the client filter we'd surface another client's history on this card.
  // RLS keeps us inside the org; the client-id filter narrows to this
  // person.
  //
  // No DISTINCT ON in supabase-js — we order DESC, then dedupe by
  // exercise_id in TS taking the first (most recent) hit. Pre-launch this
  // is empty; post-launch the row count is bounded by sessions × exercises
  // and an `exercise_logs_exercise_idx` partial index covers the where
  // clause. If real-traffic profiling shows it's slow, swap to a
  // SECURITY DEFINER RPC with a per-exercise lateral subquery
  // (deferred per docs/polish/session-builder.md §2.9).
  const exerciseIdsOnDay = Array.from(
    new Set((programExercisesRaw ?? []).map((pe) => pe.exercise_id)),
  )

  const lastLoggedByExerciseId = new Map<string, LastLogged>()
  if (exerciseIdsOnDay.length > 0) {
    const { data: logsRaw, error: logsErr } = await supabase
      .from('exercise_logs')
      .select(
        `exercise_id,
         completed_at,
         sessions!inner(client_id),
         set_logs(
           set_number, weight_value, weight_metric,
           reps_performed, deleted_at
         )`,
      )
      .eq('sessions.client_id', id)
      .in('exercise_id', exerciseIdsOnDay)
      .is('deleted_at', null)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })

    if (logsErr) throw new Error(`Load last-logged: ${logsErr.message}`)

    for (const log of logsRaw ?? []) {
      // First hit per exercise_id wins (rows ordered completed_at DESC).
      if (lastLoggedByExerciseId.has(log.exercise_id)) continue
      if (!log.completed_at) continue

      const sets = (log.set_logs ?? [])
        .filter((s) => s.deleted_at === null)
        .sort((a, b) => a.set_number - b.set_number)

      // No live sets at all — no useful footer. Skip so we keep looking
      // backwards for an earlier session that does have set data.
      if (sets.length === 0) continue

      lastLoggedByExerciseId.set(log.exercise_id, {
        completedAt: log.completed_at,
        sets: sets.map((s) => ({
          weightValue: s.weight_value === null ? null : Number(s.weight_value),
          weightMetric: s.weight_metric,
          repsPerformed: s.reps_performed,
        })),
      })
    }
  }

  const programExercises: ProgramExercise[] = (programExercisesRaw ?? []).map(
    (pe) => ({
      id: pe.id,
      sort_order: pe.sort_order,
      section_title: pe.section_title,
      superset_group_id: pe.superset_group_id,
      rest_seconds: pe.rest_seconds,
      tempo: pe.tempo,
      instructions: pe.instructions,
      exercise_id: pe.exercise_id,
      exercise_name: pe.exercise?.name ?? 'Unknown',
      exercise_video_url: pe.exercise?.video_url ?? null,
      // Filter + sort the nested set rows in TS — the supabase-js select
      // string can't express both per-relation filter (deleted_at IS NULL)
      // and per-relation order (set_number ASC) cleanly. The arrays are
      // tiny (1–50 rows) so the cost is negligible.
      prescriptionSets: (pe.prescription_sets ?? [])
        .filter((s) => s.deleted_at === null)
        .sort((a, b) => a.set_number - b.set_number)
        .map((s) => ({
          id: s.id,
          set_number: s.set_number,
          reps: s.reps,
          optional_metric: s.optional_metric,
          optional_value: s.optional_value,
        })),
      lastLogged: lastLoggedByExerciseId.get(pe.exercise_id) ?? null,
    }),
  )

  const libraryOptions: LibraryPick[] = (libraryRaw ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    movement_pattern_id: e.movement_pattern_id,
    movement_pattern_name: e.movement_pattern?.name ?? null,
    tag_ids: (e.tag_assignments ?? []).map((t) => t.tag_id),
  }))

  const sectionTitles: SectionTitleOption[] = (sectionTitlesRaw ?? []).map(
    (s) => ({ id: s.id, name: s.name }),
  )

  const movementPatterns: MovementPatternOption[] = (patternsRaw ?? []).map(
    (p) => ({ id: p.id, name: p.name }),
  )

  const exerciseTags: ExerciseTagOption[] = (tagsRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }))

  const metricUnits: MetricUnitOption[] = (metricUnitsRaw ?? []).map((u) => ({
    code: u.code,
    display_label: u.display_label,
  }))

  // Skip empty pinned notes — see program/page.tsx Phase F.6 fix.
  const pinnedNotes: PinnedNote[] = (notesRaw ?? [])
    .map((n) => ({
      id: n.id,
      body: (n.body_rich ?? n.subjective ?? '').trim(),
      flag_body_region: n.flag_body_region,
    }))
    .filter((n) => n.body.length > 0)

  const reports: SessionReport[] = (reportsRaw ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    report_type: r.report_type,
    test_date: r.test_date,
    is_published: r.is_published,
  }))

  const programName = day.program?.name ?? ''
  const dayDateLabel = day.scheduled_date
    ? new Intl.DateTimeFormat('en-AU', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      }).format(new Date(day.scheduled_date))
    : ''

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          marginBottom: 24,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Link
            href={`/clients/${id}/program`}
            aria-label="Back to program calendar"
            style={{
              color: 'var(--color-text-light)',
              padding: 6,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <ArrowLeft size={18} aria-hidden />
          </Link>
          <div>
            <div className="eyebrow" style={{ marginBottom: 0 }}>
              {client.first_name} {client.last_name} · {programName}
            </div>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '2rem',
                margin: 0,
                letterSpacing: '-.01em',
              }}
            >
              Session Builder
            </h1>
            {/* Subordinate display heading. Maps to the Odyssey design
                system .h3 token (Barlow Condensed 700, 1.2rem, line-height
                1.3, charcoal). Holds the editable day label and the date,
                so the user has one decisive label per session. */}
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.2rem',
                lineHeight: 1.3,
                color: 'var(--color-charcoal)',
                marginTop: 4,
              }}
            >
              <DayLabelEditor
                clientId={id}
                dayId={dayId}
                initialLabel={day.day_label}
              />
              {dayDateLabel && (
                <span style={{ color: 'var(--color-text-light)' }}>
                  {' · '}
                  {dayDateLabel}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {/* Phase I §2.13: Duplicate is enabled whenever the source day
              has at least one exercise to copy. An empty day's duplicate
              would land an empty day on the new date — pointless, so
              keep it disabled. */}
          <DuplicateButton
            clientId={id}
            sourceDayId={dayId}
            sourceDate={day.scheduled_date}
            disabled={programExercises.length === 0}
          />
          <AssignButton
            clientId={id}
            dayId={dayId}
            clientFirstName={client.first_name}
            publishedAt={day.published_at}
            exerciseCount={programExercises.length}
          />
        </div>
      </div>

      <SessionBuilder
        clientId={id}
        dayId={dayId}
        programExercises={programExercises}
        libraryOptions={libraryOptions}
        pinnedNotes={pinnedNotes}
        reports={reports}
        sectionTitles={sectionTitles}
        movementPatterns={movementPatterns}
        exerciseTags={exerciseTags}
        metricUnits={metricUnits}
      />
    </div>
  )
}

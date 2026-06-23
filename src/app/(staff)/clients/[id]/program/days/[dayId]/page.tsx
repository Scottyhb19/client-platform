import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { loadCatalog, loadTestHistoryForClient } from '@/lib/testing/loaders'
import {
  SessionBuilder,
  type ExerciseTagOption,
  type LastLogged,
  type MetricUnitOption,
  type MovementPatternOption,
  type ProgramExercise,
  type SectionTitleOption,
} from './_components/SessionBuilder'
import { type CircuitOption } from './_components/CircuitControls'
import { type SessionOption } from './_components/SessionControls'
import {
  LIBRARY_EXERCISE_COLUMNS,
  toLibraryExercises,
} from '@/app/(staff)/library/_lib/exercise-query'
import { type ClinicalNoteSummary } from '../../../_components/NotesPanel'
import {
  NOTE_SUMMARY_COLUMNS,
  mergeNoteRows,
  toClinicalNoteSummaries,
  type NoteSummaryRow,
} from '../../../_lib/note-summaries'
import { type SessionReport } from '../../../_components/ReportsPanel'
import { AssignButton } from './_components/AssignButton'
import { DayLabelEditor } from './_components/DayLabelEditor'
import { SessionToolsMenu } from './_components/SessionToolsMenu'

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
  const { organizationId } = await requireRole(['owner', 'staff'])
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
    { data: notesRaw, error: notesErr },
    { data: flagsRaw, error: flagsErr },
    { data: noteTemplatesRaw },
    publicationsResult,
    catalog,
    testHistory,
    { data: batteriesRaw },
    { data: sectionTitlesRaw },
    { data: patternsRaw },
    { data: tagsRaw },
    { data: metricUnitsRaw },
    { data: circuitsRaw },
    { data: sessionsRaw },
  ] = await Promise.all([
    supabase
      .from('program_exercises')
      .select(
        `id, sort_order, section_title, superset_group_id,
         rest_seconds, tempo, instructions,
         exercise_id,
         exercise:exercises(name, video_url),
         prescription_sets:program_exercise_sets(
           id, set_number, reps, rep_metric, optional_metric, optional_value, deleted_at
         )`,
      )
      .eq('program_day_id', dayId)
      .is('deleted_at', null)
      .order('sort_order'),
    // G-7 (2026-06-12): full LibraryExercise card shape — the Library tab
    // composes the standalone library's atoms, same select both surfaces.
    supabase
      .from('exercises')
      .select(LIBRARY_EXERCISE_COLUMNS)
      .is('deleted_at', null)
      .order('name'),
    // Phase J.2 (2026-05-08): clinical notes for the right-rail Notes tab.
    // All notes for the client (capped at 30 most recent), pinned-first
    // then by note_date DESC so the panel mirrors the client profile's
    // notes ordering. Selecting content_json + the legacy SOAP columns
    // because notes saved before migration 20260427100000 still carry
    // body_rich / subjective; modern notes denormalise into content_json
    // and explicitly NULL the legacy fields (notes-actions.ts §Update).
    // template_id powers the template chip on each row — resolved against
    // the parallel note_templates load below.
    supabase
      .from('clinical_notes')
      .select(NOTE_SUMMARY_COLUMNS)
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('note_date', { ascending: false })
      .limit(30),
    // CN-1: active flags, unbounded by the 30-note window — an old but
    // unresolved flag must still surface while programming. Merged with
    // the recent window in toClinicalNoteSummaries (dedup by id).
    supabase
      .from('clinical_notes')
      .select(NOTE_SUMMARY_COLUMNS)
      .eq('client_id', id)
      .is('deleted_at', null)
      .in('note_type', ['injury_flag', 'contraindication'])
      .is('flag_resolved_at', null)
      .order('note_date', { ascending: false }),
    supabase
      .from('note_templates')
      .select('id, name')
      .is('deleted_at', null),
    // Phase J.2: published reports come from client_publications (per-test
    // publish gate, migration 20260501120000), not the legacy `reports`
    // table. The join on test_sessions narrows to this client and brings
    // back conducted_at for the panel header. Cap matches the old reports
    // query.
    // Phase J.4 (2026-05-09): also pull applied_battery_id from the joined
    // session so the rail's reader can show the battery chip + group
    // sibling publications by session.
    supabase
      .from('client_publications')
      .select(
        `id, test_session_id, test_id, framing_text, published_at,
         session:test_sessions!inner(
           client_id, conducted_at, deleted_at, applied_battery_id
         )`,
      )
      .eq('session.client_id', id)
      .is('session.deleted_at', null)
      .is('deleted_at', null)
      .order('published_at', { ascending: false })
      .limit(20),
    // Catalog used to resolve client_publications.test_id → friendly
    // test name. Cheap (one query against the seed table + per-org
    // custom-test rows + disabled-test rows) and the same loader the
    // Reports tab on the client profile uses.
    loadCatalog(supabase, organizationId, { includeCustom: true }),
    // Phase J.4: per-test trajectories so the rail's Reports reader can
    // compute baseline / previous / current values per metric. Bounded
    // per client; mirrors the loader the profile Reports tab already uses.
    loadTestHistoryForClient(supabase, organizationId, id),
    // Phase J.4: applied_battery_id → battery_name lookup. Tiny per-org
    // table; loaded once for chip rendering.
    supabase
      .from('test_batteries')
      .select('id, name')
      .is('deleted_at', null),
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
    // C-6: the org's circuits for the builder's "Add circuit" picker. RLS-scoped.
    supabase
      .from('circuits')
      .select('id, name, circuit_type')
      .is('deleted_at', null)
      .order('name'),
    // S-6: the org's session templates for the builder's "Add session" picker.
    supabase
      .from('session_templates')
      .select('id, name, session_template_exercises(id, deleted_at)')
      .is('deleted_at', null)
      .order('name'),
  ])

  if (peErr) throw new Error(`Load program exercises: ${peErr.message}`)
  if (notesErr) throw new Error(`Load clinical notes: ${notesErr.message}`)
  if (flagsErr) throw new Error(`Load active flags: ${flagsErr.message}`)
  if (publicationsResult.error)
    throw new Error(`Load publications: ${publicationsResult.error.message}`)

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
           reps_performed, rep_metric, deleted_at
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
          repMetric: s.rep_metric,
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
          rep_metric: s.rep_metric,
          optional_metric: s.optional_metric,
          optional_value: s.optional_value,
        })),
      lastLogged: lastLoggedByExerciseId.get(pe.exercise_id) ?? null,
    }),
  )

  const libraryOptions = toLibraryExercises(libraryRaw)

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

  const circuits: CircuitOption[] = (circuitsRaw ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    // circuit_type is a CHECK-constrained text column; narrow to the union.
    circuit_type: c.circuit_type as CircuitOption['circuit_type'],
  }))

  const sessions: SessionOption[] = (
    (sessionsRaw ?? []) as Array<{
      id: string
      name: string
      session_template_exercises: Array<{ id: string; deleted_at: string | null }> | null
    }>
  ).map((s) => ({
    id: s.id,
    name: s.name,
    exerciseCount: (s.session_template_exercises ?? []).filter(
      (e) => e.deleted_at === null,
    ).length,
  }))

  // Phase J.2 (2026-05-08): notes denormalise to ClinicalNoteSummary —
  // mapping shared with the program-calendar loader via
  // _lib/note-summaries (CN-1). Active flags merge in unbounded by the
  // 30-note window.
  const templateNameById = new Map<string, string>()
  for (const t of noteTemplatesRaw ?? []) {
    templateNameById.set(t.id, t.name)
  }
  const clinicalNotes: ClinicalNoteSummary[] = toClinicalNoteSummaries(
    mergeNoteRows(
      (notesRaw ?? []) as NoteSummaryRow[],
      (flagsRaw ?? []) as NoteSummaryRow[],
    ),
    templateNameById,
  )

  // Phase J.2: build test_id → test_name lookup once, then map
  // publications. Falls back to test_id if the catalog entry was
  // disabled or the publication points at a stale custom-test id.
  const testNameById = new Map<string, string>()
  for (const cat of catalog) {
    for (const sub of cat.subcategories) {
      for (const t of sub.tests) {
        testNameById.set(t.id, t.name)
      }
    }
  }
  type PublicationJoinRow = {
    id: string
    test_session_id: string
    test_id: string
    framing_text: string | null
    published_at: string
    session: {
      client_id: string
      conducted_at: string
      deleted_at: string | null
      applied_battery_id: string | null
    } | null
  }
  const batteryNameById = new Map<string, string>()
  for (const b of batteriesRaw ?? []) {
    batteryNameById.set(b.id, b.name)
  }
  const publicationsRaw =
    (publicationsResult.data ?? []) as unknown as PublicationJoinRow[]
  const reports: SessionReport[] = publicationsRaw.map((p) => {
    const appliedBatteryId = p.session?.applied_battery_id ?? null
    return {
      id: p.id,
      test_session_id: p.test_session_id,
      test_id: p.test_id,
      test_name: testNameById.get(p.test_id) ?? p.test_id,
      conducted_at: p.session?.conducted_at ?? p.published_at,
      framing_text: p.framing_text,
      applied_battery_id: appliedBatteryId,
      battery_name: appliedBatteryId
        ? batteryNameById.get(appliedBatteryId) ?? null
        : null,
    }
  })

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
          <SessionToolsMenu
            clientId={id}
            dayId={dayId}
            sourceDate={day.scheduled_date}
            duplicateDisabled={programExercises.length === 0}
            circuits={circuits}
            sessions={sessions}
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
        clinicalNotes={clinicalNotes}
        reports={reports}
        testHistory={testHistory}
        sectionTitles={sectionTitles}
        movementPatterns={movementPatterns}
        exerciseTags={exerciseTags}
        metricUnits={metricUnits}
      />
    </div>
  )
}

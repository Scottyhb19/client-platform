import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Copy } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  SessionBuilder,
  type LibraryPick,
  type ProgramExercise,
} from './_components/SessionBuilder'
import { type PinnedNote } from '../../../_components/NotesPanel'
import { type SessionReport } from '../../../_components/ReportsPanel'
import { AssignButton } from './_components/AssignButton'
import { DayLabelEditor } from './_components/DayLabelEditor'

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

  // Session content + library pool + pinned notes + reports in parallel.
  const [
    { data: programExercisesRaw, error: peErr },
    { data: libraryRaw },
    { data: notesRaw },
    { data: reportsRaw },
  ] = await Promise.all([
    supabase
      .from('program_exercises')
      .select(
        `id, sort_order, section_title, superset_group_id,
         sets, reps, optional_value, rpe, rest_seconds, tempo, instructions,
         exercise_id,
         exercise:exercises(name, video_url)`,
      )
      .eq('program_day_id', dayId)
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('exercises')
      .select(
        `id, name,
         movement_pattern:movement_patterns(name)`,
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
  ])

  if (peErr) throw new Error(`Load program exercises: ${peErr.message}`)

  const programExercises: ProgramExercise[] = (programExercisesRaw ?? []).map(
    (pe) => ({
      id: pe.id,
      sort_order: pe.sort_order,
      section_title: pe.section_title,
      superset_group_id: pe.superset_group_id,
      sets: pe.sets,
      reps: pe.reps,
      optional_value: pe.optional_value,
      rpe: pe.rpe,
      rest_seconds: pe.rest_seconds,
      tempo: pe.tempo,
      instructions: pe.instructions,
      exercise_id: pe.exercise_id,
      exercise_name: pe.exercise?.name ?? 'Unknown',
      exercise_video_url: pe.exercise?.video_url ?? null,
    }),
  )

  const libraryOptions: LibraryPick[] = (libraryRaw ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    movement_pattern_name: e.movement_pattern?.name ?? null,
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
          <button type="button" className="btn outline" disabled>
            <Copy size={14} aria-hidden />
            Duplicate
          </button>
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
      />
    </div>
  )
}

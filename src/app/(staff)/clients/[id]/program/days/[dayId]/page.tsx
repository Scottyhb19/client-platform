import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Copy, Send } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  SessionBuilder,
  type LibraryPick,
  type PinnedNote,
  type ProgramExercise,
} from './_components/SessionBuilder'

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

  // Day + parent chain — fail if the day belongs to a different client.
  const { data: day } = await supabase
    .from('program_days')
    .select(
      `id, day_label, day_of_week, sort_order,
       program_week:program_weeks(
         week_number,
         program:programs(id, name, client_id)
       )`,
    )
    .eq('id', dayId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!day || day.program_week?.program?.client_id !== id) notFound()

  // Client for header context.
  const { data: client } = await supabase
    .from('clients')
    .select('id, first_name, last_name')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!client) notFound()

  // Session content + library pool + pinned notes in parallel.
  const [
    { data: programExercisesRaw, error: peErr },
    { data: libraryRaw },
    { data: notesRaw },
  ] = await Promise.all([
    supabase
      .from('program_exercises')
      .select(
        `id, sort_order, section_title, superset_group_id,
         sets, reps, optional_value, rpe, rest_seconds, instructions,
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

  const pinnedNotes: PinnedNote[] = (notesRaw ?? []).map((n) => ({
    id: n.id,
    body: (n.body_rich ?? n.subjective ?? '').trim(),
    flag_body_region: n.flag_body_region,
  }))

  const programName = day.program_week?.program?.name ?? ''
  const weekNumber = day.program_week?.week_number ?? 0

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
              {client.first_name} {client.last_name} · {programName} · Week{' '}
              {weekNumber} · Day {day.day_label}
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
            <div
              style={{
                fontSize: '.86rem',
                color: 'var(--color-text-light)',
                marginTop: 4,
              }}
            >
              {programExercises.length === 0
                ? 'No exercises yet — add from the Library panel.'
                : `${programExercises.length} ${
                    programExercises.length === 1 ? 'exercise' : 'exercises'
                  }`}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn outline" disabled>
            <Copy size={14} aria-hidden />
            Duplicate
          </button>
          <button type="button" className="btn primary" disabled>
            <Send size={14} aria-hidden />
            Assign to {client.first_name}
          </button>
        </div>
      </div>

      <SessionBuilder
        clientId={id}
        dayId={dayId}
        programExercises={programExercises}
        libraryOptions={libraryOptions}
        pinnedNotes={pinnedNotes}
      />
    </div>
  )
}

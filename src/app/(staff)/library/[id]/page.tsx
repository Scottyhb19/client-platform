import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ExerciseForm } from '../_components/ExerciseForm'
import { updateExerciseAction } from '../actions'
import type { ExerciseFormValues } from '../types'

export const dynamic = 'force-dynamic'

export default async function EditExercisePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [
    { data: exercise, error: exErr },
    { data: patterns },
    { data: tags },
    { data: metricUnits },
  ] = await Promise.all([
    supabase
      .from('exercises')
      .select(
        `id, name, movement_pattern_id, video_url, description, instructions,
         default_sets, default_reps, default_metric, default_metric_value,
         default_rpe, default_rest_seconds,
         exercise_tag_assignments(tag_id)`,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
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

  if (exErr) throw new Error(`Load exercise: ${exErr.message}`)
  if (!exercise) notFound()

  const initialValues: ExerciseFormValues = {
    name: exercise.name,
    movement_pattern_id: exercise.movement_pattern_id,
    video_url: exercise.video_url,
    description: exercise.description,
    instructions: exercise.instructions,
    default_sets: exercise.default_sets,
    default_reps: exercise.default_reps,
    default_metric: exercise.default_metric,
    default_metric_value: exercise.default_metric_value,
    default_rpe: exercise.default_rpe,
    default_rest_seconds: exercise.default_rest_seconds,
    tag_ids: (exercise.exercise_tag_assignments ?? []).map((a) => a.tag_id),
  }

  const boundUpdate = updateExerciseAction.bind(null, exercise.id)

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 6,
        }}
      >
        <Link
          href="/library"
          aria-label="Back to exercise library"
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
            Exercise library · Edit
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '2.2rem',
              margin: 0,
              letterSpacing: '-.01em',
              color: 'var(--color-charcoal)',
            }}
          >
            {exercise.name}
          </h1>
        </div>
      </div>

      <p
        style={{
          fontSize: '.9rem',
          color: 'var(--color-text-light)',
          maxWidth: 560,
          marginTop: 14,
          marginBottom: 24,
          lineHeight: 1.55,
        }}
      >
        Edit defaults, cues, and tags. Changes apply to future prescriptions
        only — existing program days keep the values they were saved with.
      </p>

      <ExerciseForm
        mode="edit"
        patterns={patterns ?? []}
        tags={tags ?? []}
        metricUnits={metricUnits ?? []}
        initialValues={initialValues}
        action={boundUpdate}
      />
    </div>
  )
}

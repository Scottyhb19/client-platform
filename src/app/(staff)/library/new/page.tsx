import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NewExerciseForm } from './_components/NewExerciseForm'

export const dynamic = 'force-dynamic'

export default async function NewExercisePage() {
  const supabase = await createSupabaseServerClient()

  const [{ data: patterns }, { data: tags }] = await Promise.all([
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
  ])

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
            05 Exercise Library · New
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
            Create exercise
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
        Add an exercise with sensible defaults. These become the starting
        point in the session builder — any use can override sets, reps, load,
        and RPE.
      </p>

      <NewExerciseForm
        patterns={patterns ?? []}
        tags={tags ?? []}
      />
    </div>
  )
}

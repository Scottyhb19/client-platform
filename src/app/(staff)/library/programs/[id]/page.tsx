import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { formatVolume } from '@/lib/prescription/volume-units'

export const dynamic = 'force-dynamic'

/**
 * LPT-3 — read-only template preview. Server-rendered, RLS-scoped: the EP can
 * inspect a template's full structure (weeks → days → exercises + per-set
 * prescription) before applying it. No edit here — templates are edited by
 * re-saving from a real program (Q-D).
 */
export default async function ProgramTemplatePreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: tpl } = await supabase
    .from('program_templates')
    .select(
      `id, name, description,
       template_weeks(id, week_number, deleted_at,
         template_days(id, day_label, sort_order, deleted_at,
           template_exercises(id, sort_order, section_title, deleted_at,
             exercise:exercises(name),
             template_exercise_sets(set_number, reps, rep_metric,
               optional_metric, optional_value, deleted_at))))`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!tpl) notFound()

  const t = tpl as unknown as RawTemplateDetail
  const weeks = (t.template_weeks ?? [])
    .filter((w) => w.deleted_at === null)
    .sort((a, b) => a.week_number - b.week_number)

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <Link
          href="/library"
          aria-label="Back to library"
          style={{ color: 'var(--color-text-light)', padding: 6, display: 'grid', placeItems: 'center' }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            Program template · preview
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '2rem',
              margin: 0,
              letterSpacing: '-.01em',
              color: 'var(--color-charcoal)',
            }}
          >
            {t.name}
          </h1>
        </div>
      </div>

      {t.description && (
        <p
          style={{
            fontSize: '.9rem',
            color: 'var(--color-text-light)',
            maxWidth: 560,
            marginTop: 12,
            marginBottom: 8,
            lineHeight: 1.55,
          }}
        >
          {t.description}
        </p>
      )}

      <div style={{ display: 'grid', gap: 18, marginTop: 18 }}>
        {weeks.map((w) => {
          const days = (w.template_days ?? [])
            .filter((d) => d.deleted_at === null)
            .sort((a, b) => a.sort_order - b.sort_order)
          return (
            <section key={w.id}>
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '.7rem',
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                  marginBottom: 8,
                }}
              >
                Week {w.week_number}
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {days.map((d) => {
                  const exercises = (d.template_exercises ?? [])
                    .filter((e) => e.deleted_at === null)
                    .sort((a, b) => a.sort_order - b.sort_order)
                  return (
                    <div className="card" key={d.id} style={{ padding: '14px 18px' }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-display)',
                          fontWeight: 700,
                          fontSize: '1rem',
                          color: 'var(--color-charcoal)',
                          marginBottom: exercises.length > 0 ? 10 : 0,
                        }}
                      >
                        {d.day_label}
                      </div>
                      {exercises.length === 0 ? (
                        <div style={{ fontSize: '.82rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
                          No exercises
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 6 }}>
                          {exercises.map((e) => (
                            <div
                              key={e.id}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                alignItems: 'baseline',
                              }}
                            >
                              <span style={{ fontSize: '.9rem', color: 'var(--color-text)', overflowWrap: 'anywhere' }}>
                                {e.exercise?.name ?? 'Unknown exercise'}
                              </span>
                              <span
                                style={{
                                  fontFamily: 'var(--font-display)',
                                  fontWeight: 700,
                                  fontSize: '.82rem',
                                  color: 'var(--color-primary)',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                }}
                              >
                                {rxSummary(e.template_exercise_sets ?? [])}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {days.length === 0 && (
                  <div style={{ fontSize: '.82rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
                    No days
                  </div>
                )}
              </div>
            </section>
          )
        })}
        {weeks.length === 0 && (
          <div className="card" style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-light)' }}>
            This template has no weeks.
          </div>
        )}
      </div>
    </div>
  )
}

type RawSet = {
  set_number: number
  reps: string | null
  rep_metric: string | null
  optional_metric: string | null
  optional_value: string | null
  deleted_at: string | null
}
type RawTemplateDetail = {
  id: string
  name: string
  description: string | null
  template_weeks:
    | Array<{
        id: string
        week_number: number
        deleted_at: string | null
        template_days:
          | Array<{
              id: string
              day_label: string
              sort_order: number
              deleted_at: string | null
              template_exercises:
                | Array<{
                    id: string
                    sort_order: number
                    section_title: string | null
                    deleted_at: string | null
                    exercise: { name: string } | null
                    template_exercise_sets: RawSet[] | null
                  }>
                | null
            }>
          | null
      }>
    | null
}

/** Compact prescription summary from a template exercise's per-set rows. */
function rxSummary(rawSets: RawSet[]): string {
  const sets = rawSets
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.set_number - b.set_number)
  if (sets.length === 0) return ''

  const first = sets[0]!
  const allSame = sets.every(
    (s) =>
      s.reps === first.reps &&
      s.rep_metric === first.rep_metric &&
      s.optional_metric === first.optional_metric &&
      s.optional_value === first.optional_value,
  )

  const parts: string[] = []
  const vol = formatVolume(first.reps, first.rep_metric)
  if (allSame && vol) parts.push(`${sets.length} × ${vol}`)
  else parts.push(`${sets.length} ${sets.length === 1 ? 'set' : 'sets'}`)
  if (first.optional_value) {
    parts.push(
      first.optional_metric === 'rpe'
        ? `RPE ${first.optional_value}`
        : first.optional_value,
    )
  }
  return parts.join(' · ')
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NewProgramForm } from './_components/NewProgramForm'

export const dynamic = 'force-dynamic'

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const [{ data: client }, { data: templatesRaw }] = await Promise.all([
    supabase
      .from('clients')
      .select('id, first_name, last_name')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    // G-2 (2026-06-12): template picker source. Duration derives from the
    // deepest live week — same rule create_program_from_template uses.
    supabase
      .from('program_templates')
      .select('id, name, description, template_weeks(week_number, deleted_at)')
      .is('deleted_at', null)
      .order('name'),
  ])

  if (!client) notFound()

  const templates = (templatesRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    durationWeeks: Math.max(
      1,
      ...(t.template_weeks ?? [])
        .filter((w) => w.deleted_at === null)
        .map((w) => w.week_number),
    ),
  }))

  const today = new Date().toISOString().slice(0, 10)
  const fullName = `${client.first_name} ${client.last_name}`

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
            08 Program · New training block · {fullName}
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
            Start a training block
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
        A training block is a set of consecutive weeks with a repeating day
        split. Weeks + days scaffold out now; drop exercises into each day
        from the Session Builder.
      </p>

      <NewProgramForm
        clientId={id}
        clientName={fullName}
        todayIso={today}
        templates={templates}
      />
    </div>
  )
}

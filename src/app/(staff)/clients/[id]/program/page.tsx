import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Copy, FileText, Plus } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  initialsFor,
  toneFor,
} from '../../_lib/client-helpers'
import {
  ProgramCalendar,
  type DayData,
  type WeekData,
} from './_components/ProgramCalendar'

export const dynamic = 'force-dynamic'

/**
 * 08 Program Calendar — per client.
 *
 * Fetches client + active program + weeks + days in parallel. If no
 * active program: empty state with CTA to /program/new. Otherwise, the
 * ProgramCalendar client component renders collapsible week strips.
 */
export default async function ClientProgramPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select(
      `id, first_name, last_name,
       category:client_categories(name)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (clientErr) throw new Error(`Load client: ${clientErr.message}`)
  if (!client) notFound()

  const { data: program, error: progErr } = await supabase
    .from('programs')
    .select(
      `id, name, status, duration_weeks, start_date, notes, created_at`,
    )
    .eq('client_id', id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle()

  if (progErr) throw new Error(`Load program: ${progErr.message}`)

  let weeks: WeekData[] = []
  let daysPerWeek = 0

  if (program) {
    const { data: weeksRaw, error: weeksErr } = await supabase
      .from('program_weeks')
      .select(
        `id, week_number,
         program_days(id, day_label, day_of_week, sort_order)`,
      )
      .eq('program_id', program.id)
      .is('deleted_at', null)
      .order('week_number')

    if (weeksErr) throw new Error(`Load weeks: ${weeksErr.message}`)

    weeks = (weeksRaw ?? []).map((w) => ({
      id: w.id,
      week_number: w.week_number,
      days: (w.program_days ?? [])
        .filter((d) => d.day_label !== null)
        .sort((a, b) => a.sort_order - b.sort_order) as DayData[],
    }))

    // Days per week: max across all weeks (handles uneven weeks fine).
    daysPerWeek = weeks.reduce((m, w) => Math.max(m, w.days.length), 0)
  }

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <Link
          href={`/clients/${client.id}`}
          aria-label="Back to client profile"
          style={{
            color: 'var(--color-text-light)',
            padding: 6,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <span
          className={`avatar ${toneFor(client.id)}`}
          style={{ width: 44, height: 44, fontSize: 44 * 0.38 }}
        >
          {initialsFor(client.first_name, client.last_name)}
        </span>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            {client.first_name} {client.last_name}
            {client.category?.name && ` · ${client.category.name}`}
            {program && ` · ${program.name}`}
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.9rem',
              margin: 0,
              letterSpacing: '-.01em',
            }}
          >
            Program Calendar
          </h1>
          {program && (
            <div
              style={{
                fontSize: '.86rem',
                color: 'var(--color-text-light)',
                marginTop: 4,
              }}
            >
              {program.duration_weeks
                ? `${program.duration_weeks} week block`
                : 'Open-ended'}
              {daysPerWeek > 0 && ` · ${daysPerWeek} day split`}
              {program.start_date && ` · starts ${formatDate(program.start_date)}`}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn outline" disabled>
            <Copy size={14} aria-hidden />
            Copy week
          </button>
          <button type="button" className="btn outline" disabled>
            <FileText size={14} aria-hidden />
            Clinical notes
          </button>
          <Link
            href={`/clients/${client.id}/program/new`}
            className="btn primary"
          >
            <Plus size={14} aria-hidden />
            New mesocycle
          </Link>
        </div>
      </div>

      {!program ? (
        <EmptyProgram clientId={client.id} />
      ) : (
        <ProgramCalendar
          clientId={client.id}
          programName={program.name}
          daysPerWeek={daysPerWeek}
          weeks={weeks}
          startDateIso={program.start_date}
          todayIso={new Date().toISOString().slice(0, 10)}
        />
      )}
    </div>
  )
}

function EmptyProgram({ clientId }: { clientId: string }) {
  return (
    <div
      className="card"
      style={{
        padding: '44px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.25rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        No active program
      </div>
      <p
        style={{
          fontSize: '.92rem',
          margin: '0 auto 20px',
          lineHeight: 1.6,
          maxWidth: 460,
        }}
      >
        Start a mesocycle for this client — a block of 4–8 weeks with a
        repeating day split (A/B, A/B/C, etc). The Session Builder then lets
        you fill in exercises day by day.
      </p>
      <Link
        href={`/clients/${clientId}/program/new`}
        className="btn primary"
      >
        <Plus size={14} aria-hidden />
        Start first mesocycle
      </Link>
    </div>
  )
}

function formatDate(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateIso))
  } catch {
    return dateIso
  }
}

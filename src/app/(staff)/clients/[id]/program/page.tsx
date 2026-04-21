import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Copy, FileText, Plus } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  initialsFor,
  toneFor,
} from '../../_lib/client-helpers'

export const dynamic = 'force-dynamic'

/**
 * 08 Program Calendar — per client.
 *
 * Displays the client's active mesocycle (weeks + days). If no active
 * program exists, shows an empty state with a CTA to start one.
 *
 * Session Builder (09) operates on a single day of this calendar —
 * wiring lands in a later commit.
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
        <ProgramSkeleton programName={program.name} />
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

function ProgramSkeleton({ programName }: { programName: string }) {
  // Placeholder: week strips + day cells render here once program_weeks
  // and program_days exist in the DB. The utility classes (.wk-strip,
  // .day-cell, .day-tag) are already in globals.css ready for the next
  // commit.
  return (
    <div
      className="card"
      style={{
        padding: '28px',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.05rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        {programName}
      </div>
      <p style={{ fontSize: '.88rem', margin: 0, lineHeight: 1.55 }}>
        Week strips and day cells wire up in the next commit. The Session
        Builder opens from each day tile and drops you into the exercise-
        placement view with clinical notes adjacent.
      </p>
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

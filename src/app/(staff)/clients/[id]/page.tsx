import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  initialsFor,
  toneFor,
  statusFor,
} from '../_lib/client-helpers'
import {
  ClientProfile,
  type ProfileClient,
  type ProfileCondition,
  type ProfileNote,
  type ProfileProgramSummary,
} from './_components/ClientProfile'

export const dynamic = 'force-dynamic'

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [
    { data: client, error: clientErr },
    { data: conditions, error: conditionsErr },
    { data: notes, error: notesErr },
    { data: activeProgram },
  ] = await Promise.all([
    supabase
      .from('clients')
      .select(
        `id, first_name, last_name, email, phone, dob, gender, address,
         referral_source, goals, created_at, user_id,
         invited_at, onboarded_at, archived_at,
         category:client_categories(name)`,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('client_medical_history')
      .select('id, condition, severity, notes, is_active, diagnosis_date')
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('clinical_notes')
      .select(
        `id, note_date, note_type, title, body_rich, subjective,
         is_pinned, flag_body_region`,
      )
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('note_date', { ascending: false }),
    supabase
      .from('programs')
      .select(
        `id, name, duration_weeks, start_date,
         program_weeks(id, program_days(id))`,
      )
      .eq('client_id', id)
      .eq('status', 'active')
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (clientErr) throw new Error(`Load client: ${clientErr.message}`)
  if (conditionsErr)
    throw new Error(`Load conditions: ${conditionsErr.message}`)
  if (notesErr) throw new Error(`Load notes: ${notesErr.message}`)
  if (!client) notFound()

  const status = statusFor(client)
  const statusLabel =
    status === 'active' ? 'Active' : status === 'invited' ? 'New' : 'Archived'
  const statusKind: 'active' | 'new' | 'archived' =
    status === 'active' ? 'active' : status === 'invited' ? 'new' : 'archived'

  const profileClient: ProfileClient = {
    id: client.id,
    first_name: client.first_name,
    last_name: client.last_name,
    email: client.email,
    phone: client.phone,
    dob: client.dob,
    gender: client.gender,
    address: client.address,
    referral_source: client.referral_source,
    goals: client.goals,
    created_at: client.created_at,
    category_name: client.category?.name ?? null,
  }

  // Build program summary for the Program tab: current week (by calendar)
  // + max days per week across the mesocycle.
  let programSummary: ProfileProgramSummary | null = null
  if (activeProgram) {
    const weeks = activeProgram.program_weeks ?? []
    const daysPerWeek = weeks.reduce(
      (m, w) => Math.max(m, (w.program_days ?? []).length),
      0,
    )
    let currentWeek: number | null = null
    if (activeProgram.start_date) {
      const diffMs =
        Date.now() - new Date(activeProgram.start_date).getTime()
      if (diffMs >= 0) {
        const wks = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)) + 1
        currentWeek = Math.min(wks, activeProgram.duration_weeks ?? wks)
      }
    }
    programSummary = {
      id: activeProgram.id,
      name: activeProgram.name,
      duration_weeks: activeProgram.duration_weeks,
      start_date: activeProgram.start_date,
      current_week: currentWeek,
      days_per_week: daysPerWeek,
    }
  }

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 6,
        }}
      >
        <Link
          href="/clients"
          aria-label="Back to clientele"
          style={{
            background: 'none',
            border: 'none',
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
          style={{ width: 52, height: 52, fontSize: 52 * 0.38 }}
        >
          {initialsFor(client.first_name, client.last_name)}
        </span>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            {profileClient.category_name ?? 'No category'}
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
            {client.first_name} {client.last_name}
          </h1>
        </div>
      </div>

      <ClientProfile
        client={profileClient}
        conditions={(conditions ?? []) as ProfileCondition[]}
        notes={(notes ?? []) as ProfileNote[]}
        program={programSummary}
        statusLabel={statusLabel}
        statusKind={statusKind}
      />
    </div>
  )
}

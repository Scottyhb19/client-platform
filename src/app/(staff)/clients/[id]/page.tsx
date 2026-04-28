import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { statusFor } from '../_lib/client-helpers'
import type { ClientFile } from './_components/FilesTab'
import {
  ClientProfile,
  type ProfileAppointment,
  type ProfileClient,
  type ProfileCondition,
  type ProfileNote,
  type ProfileNoteTemplate,
  type ProfileProgramSummary,
  type ProfileReport,
  type Tab,
} from './_components/ClientProfile'
import {
  loadActiveBatteries,
  loadCapturedSessionsForClient,
  loadCatalog,
  loadLastUsedBatteryForClient,
} from '@/lib/testing'

export const dynamic = 'force-dynamic'

const VALID_TABS: Tab[] = [
  'details',
  'notes',
  'program',
  'reports',
  'files',
  'invoices',
]

function pickTab(value: string | string[] | undefined): Tab {
  if (typeof value !== 'string') return 'details'
  return (VALID_TABS as string[]).includes(value) ? (value as Tab) : 'details'
}

export default async function ClientProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const initialTab = pickTab(sp.tab)
  const openCreate = sp.new === '1' || sp.new === 'true'
  const initialAppointmentId =
    typeof sp.appointment === 'string' ? sp.appointment : null

  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [
    { data: client, error: clientErr },
    { data: conditions, error: conditionsErr },
    { data: notes, error: notesErr },
    { data: activeProgram },
    { data: noteTemplateRows },
    { data: noteTemplateFieldRows },
    { data: appointmentRows },
    { data: reportRows },
    { data: fileRows, error: filesErr },
    testCatalog,
    testBatteries,
    lastUsedBattery,
    capturedSessions,
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
         is_pinned, flag_body_region, template_id, appointment_id,
         content_json, version, created_at`,
      )
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false }),
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
    supabase
      .from('note_templates')
      .select('id, name, sort_order')
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('note_template_fields')
      .select('id, template_id, label, field_type, default_value, sort_order')
      .order('sort_order'),
    // Appointments around "now": last 30 past + next 30 future, excluding
    // cancelled. Sorted ASC so the picker can split into upcoming / past
    // by walking the array.
    supabase
      .from('appointments')
      .select('id, start_at, end_at, appointment_type, status')
      .eq('client_id', id)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: true })
      .limit(120),
    supabase
      .from('reports')
      .select(
        'id, title, report_type, test_date, is_published, storage_bucket, storage_path',
      )
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('test_date', { ascending: false })
      .limit(60),
    // Cast: client_files isn't in the typed Database surface until
    // `npm run supabase:types` is re-run after migration 20260428100000.
    // Drop the cast once types are regenerated.
    supabase
      .from('client_files' as never)
      .select(
        'id, category, name, original_filename, mime_type, size_bytes, created_at',
      )
      .eq('client_id', id)
      .order('created_at', { ascending: false })
      .limit(200) as unknown as Promise<{
        data: ClientFile[] | null
        error: { message: string } | null
      }>,
    // Testing-module data for the Reports tab + capture modal.
    loadCatalog(supabase, organizationId),
    loadActiveBatteries(supabase, organizationId),
    loadLastUsedBatteryForClient(supabase, id),
    loadCapturedSessionsForClient(supabase, id),
  ])

  if (clientErr) throw new Error(`Load client: ${clientErr.message}`)
  if (conditionsErr)
    throw new Error(`Load conditions: ${conditionsErr.message}`)
  if (notesErr) throw new Error(`Load notes: ${notesErr.message}`)
  // The client_files table is created by migration 20260428100000. Until
  // that migration is applied, the query errors out — we treat the
  // not-yet-migrated case as "show empty Files tab" rather than crashing
  // the whole client page. Postgres reports it as 42P01 / "relation does
  // not exist"; PostgREST reports it as PGRST205 / "Could not find the
  // table ... in the schema cache". Match either. Anything else is a real
  // failure and bubbles up.
  const filesErrAny = filesErr as { code?: string; message?: string } | null
  const filesMissingMsg = filesErrAny?.message ?? ''
  const filesMissing =
    filesErrAny?.code === '42P01' ||
    filesErrAny?.code === 'PGRST205' ||
    /relation .*client_files.* does not exist/i.test(filesMissingMsg) ||
    /could not find the table .*client_files/i.test(filesMissingMsg)
  if (filesErrAny && !filesMissing) {
    throw new Error(`Load files: ${filesErrAny.message ?? 'unknown'}`)
  }
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

  // Group fields under their parent template, sorted as queried.
  const noteTemplates: ProfileNoteTemplate[] = (noteTemplateRows ?? []).map(
    (t) => ({
      id: t.id,
      name: t.name,
      sort_order: t.sort_order,
      fields: (noteTemplateFieldRows ?? [])
        .filter((f) => f.template_id === t.id)
        .map((f) => ({
          id: f.id,
          label: f.label,
          field_type: f.field_type,
          default_value: f.default_value,
          sort_order: f.sort_order,
        })),
    }),
  )

  const profileNotes: ProfileNote[] = (notes ?? []).map((n) => ({
    id: n.id,
    note_date: n.note_date,
    note_type: n.note_type,
    title: n.title,
    body_rich: n.body_rich,
    subjective: n.subjective,
    is_pinned: n.is_pinned,
    flag_body_region: n.flag_body_region,
    template_id: n.template_id,
    appointment_id: n.appointment_id,
    content_json: n.content_json as ProfileNote['content_json'],
    version: n.version,
    created_at: n.created_at,
  }))

  // Last template the EP used for this client → defaults the create-form
  // picker. notes are already ordered by note_date DESC, created_at DESC,
  // so the first entry with a template_id wins.
  const lastTemplateId =
    profileNotes.find((n) => n.template_id !== null)?.template_id ?? null

  const appointments: ProfileAppointment[] = (appointmentRows ?? []).map(
    (a) => ({
      id: a.id,
      start_at: a.start_at,
      end_at: a.end_at,
      appointment_type: a.appointment_type,
      status: a.status,
    }),
  )

  const reports: ProfileReport[] = (reportRows ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    report_type: r.report_type,
    test_date: r.test_date,
    is_published: r.is_published,
    storage_bucket: r.storage_bucket,
    storage_path: r.storage_path,
  }))

  const files: ClientFile[] = (fileRows ?? []) as ClientFile[]

  return (
    <ClientProfile
      client={profileClient}
      conditions={(conditions ?? []) as ProfileCondition[]}
      notes={profileNotes}
      program={programSummary}
      statusLabel={statusLabel}
      statusKind={statusKind}
      noteTemplates={noteTemplates}
      appointments={appointments}
      reports={reports}
      files={files}
      lastTemplateId={lastTemplateId}
      initialTab={initialTab}
      initialOpenCreate={openCreate}
      initialAppointmentId={initialAppointmentId}
      testCatalog={testCatalog}
      testBatteries={testBatteries}
      lastUsedBattery={lastUsedBattery}
      capturedSessions={capturedSessions}
    />
  )
}

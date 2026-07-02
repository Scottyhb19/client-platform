import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import { todayIsoInPracticeTz } from '@/lib/dates'
import { resolveCurrentBlock } from '@/lib/programs/current-block'
import { statusFor } from '../_lib/client-helpers'
import type { ClientFile } from './_components/FilesTab'
import {
  ClientProfile,
  type ProfileAppointment,
  type ProfileClient,
  type ProfileCompletion,
  type ProfileCompletionExercise,
  type ProfileCompletionSet,
  type ProfileCondition,
  type ProfileMedication,
  type ProfileNote,
  type ProfileNoteTemplate,
  type ProfileProgramSummary,
  type ProfileReport,
  type Tab,
} from './_components/ClientProfile'
import {
  loadActiveBatteries,
  loadCatalog,
  loadLastUsedBatteryForClient,
  loadPublicationsForClient,
  loadTestHistoryForClient,
} from '@/lib/testing'

export const dynamic = 'force-dynamic'

const VALID_TABS: Tab[] = [
  'details',
  'notes',
  'program',
  'bookings',
  'reports',
  'files',
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
    { data: medications, error: medicationsErr },
    { data: notes, error: notesErr },
    { data: activeProgramRows },
    { data: noteTemplateRows },
    { data: noteTemplateFieldRows },
    { data: appointmentRows },
    { data: reportRows },
    { data: fileRows, error: filesErr },
    { data: completionsRaw, error: completionsErr },
    { data: categoryRows },
    testCatalog,
    testBatteries,
    lastUsedBattery,
    testHistory,
    publications,
  ] = await Promise.all([
    supabase
      .from('clients')
      .select(
        `id, first_name, last_name, email, phone, dob, sex, address,
         referral_source, referred_by, emergency_contact_name,
         emergency_contact_phone, goals, created_at, user_id, version,
         invited_at, onboarded_at, archived_at, category_id,
         category:client_categories(name)`,
      )
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('client_medical_history')
      .select(
        'id, condition, notes, is_active, diagnosis_date, show_on_header, version',
      )
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('client_medications')
      .select('id, name, context_note, is_active')
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('clinical_notes')
      .select(
        `id, note_date, note_type, title, body_rich, subjective,
         is_pinned, flag_body_region, flag_severity, flag_reviewed_at,
         flag_resolved_at, template_id, appointment_id,
         content_json, version, created_at`,
      )
      .eq('client_id', id)
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('note_date', { ascending: false })
      .order('created_at', { ascending: false }),
    // P1-5 (program-calendar pass, 2026-06-12): a client can hold multiple
    // active blocks (back-to-back, D-PROG-002) — the old .maybeSingle()
    // here threw the moment a second active block existed. Fetch all,
    // resolve the display block below with the shared current-block rule.
    supabase
      .from('programs')
      .select(
        `id, name, duration_weeks, start_date, is_loose,
         program_weeks(id, program_days(id))`,
      )
      .eq('client_id', id)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('start_date', { ascending: true }),
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
    // Phase D — most recent 10 completed sessions for this client. Feeds
    // the Program tab's right-side CompletionsPanel. Staff RLS grants
    // direct SELECT on sessions/exercise_logs/set_logs in own org, so
    // no SECURITY DEFINER RPC needed. The program_day embed pulls
    // day_label + scheduled_date so each entry can render "Day 1 · Sat
    // 10 May" without a second lookup. Sessions with program_day_id
    // NULL (orphan from soft-deleted parent) get a defaulted label.
    //
    // Phase L (2026-05-14) — extended embed: per-exercise rows + the
    // full per-set shape (set_number, reps, load, optional metric, RPE)
    // feed the new SessionExerciseSummary expander. program_exercise +
    // exercise are LEFT-joined implicitly through PostgREST; soft-deleted
    // parents come back as null and the page-side mapper defaults them
    // rather than failing the row.
    supabase
      .from('sessions')
      .select(
        `id, program_day_id, started_at, completed_at, duration_minutes,
         session_rpe, feedback,
         program_day:program_days(day_label, scheduled_date),
         exercise_logs(
           id, program_exercise_id,
           program_exercise:program_exercises(
             sort_order, section_title, superset_group_id,
             exercise:exercises(name)
           ),
           set_logs(
             set_number, reps_performed, rep_metric, weight_value, weight_metric,
             optional_metric, optional_value, rpe
           )
         )`,
      )
      .eq('client_id', id)
      .not('completed_at', 'is', null)
      .is('deleted_at', null)
      .order('completed_at', { ascending: false })
      .limit(10),
    // CN-5 — category options for the details edit form. Org-scoped via
    // RLS; same shape as the /clients/new picker.
    supabase
      .from('client_categories')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    // Testing-module data for the Reports tab + capture modal.
    loadCatalog(supabase, organizationId),
    loadActiveBatteries(supabase, organizationId),
    loadLastUsedBatteryForClient(supabase, id),
    loadTestHistoryForClient(supabase, organizationId, id),
    loadPublicationsForClient(supabase, id),
  ])

  if (clientErr) throw new Error(`Load client: ${clientErr.message}`)
  if (conditionsErr)
    throw new Error(`Load conditions: ${conditionsErr.message}`)
  if (medicationsErr)
    throw new Error(`Load medications: ${medicationsErr.message}`)
  if (notesErr) throw new Error(`Load notes: ${notesErr.message}`)
  if (completionsErr)
    throw new Error(`Load completions: ${completionsErr.message}`)
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

  // Resend-invite affordance (C-5): show only pre-onboarding (user_id null)
  // and only if an invite was previously sent (invited_at non-null). Read
  // from the raw client row, not profileClient (which omits these columns).
  const canResendInvite = client.user_id === null && client.invited_at !== null
  const lastInviteSentAt = client.invited_at

  const profileClient: ProfileClient = {
    id: client.id,
    first_name: client.first_name,
    last_name: client.last_name,
    email: client.email,
    phone: client.phone,
    dob: client.dob,
    sex: client.sex,
    address: client.address,
    referral_source: client.referral_source,
    referred_by: client.referred_by,
    emergency_contact_name: client.emergency_contact_name,
    emergency_contact_phone: client.emergency_contact_phone,
    goals: client.goals,
    created_at: client.created_at,
    category_id: client.category_id,
    category_name: client.category?.name ?? null,
    version: client.version,
  }

  // Resolve which active block the Program tab summarises: the one
  // containing today, else the most recent past one (shared rule with the
  // calendar toolbar), else the earliest upcoming one.
  const datedPrograms = (activeProgramRows ?? []).filter(
    (p): p is (typeof p) & { start_date: string; duration_weeks: number } =>
      p.start_date !== null && p.duration_weeks !== null,
  )
  const activeProgram =
    resolveCurrentBlock(datedPrograms, todayIsoInPracticeTz()) ??
    // Never fall back to the loose one-off container (item 3) — the Programs
    // tab is about training BLOCKS, so a loose-only client shows the no-block
    // empty state, not the hidden "One-off sessions" container as a program.
    (activeProgramRows ?? []).find((p) => !p.is_loose) ??
    null

  // Build program summary for the Program tab: current week (by calendar)
  // + max days per week across the training block.
  let programSummary: ProfileProgramSummary | null = null
  if (activeProgram) {
    const weeks = activeProgram.program_weeks ?? []
    const daysPerWeek = weeks.reduce(
      (m, w) => Math.max(m, (w.program_days ?? []).length),
      0,
    )
    let currentWeek: number | null = null
    if (activeProgram.start_date) {
      // Practice-timezone day delta (P0-2 class) — both operands are ISO
      // date strings parsed at UTC midnight, so the division yields whole
      // calendar days with no clock/DST skew. Was Date.now() (UTC, and
      // lint-flagged as impure-during-render).
      const startMs = Date.parse(activeProgram.start_date)
      const todayMs = Date.parse(todayIsoInPracticeTz())
      const diffDays = Math.floor((todayMs - startMs) / 86_400_000)
      if (diffDays >= 0) {
        const wks = Math.floor(diffDays / 7) + 1
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
    flag_severity: n.flag_severity,
    flag_reviewed_at: n.flag_reviewed_at,
    flag_resolved_at: n.flag_resolved_at,
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

  // Phase D — fold per-session set_count in JS. Each row's
  // exercise_logs[].set_logs[] is walked once.
  //
  // Phase L (2026-05-14) — the same walk now also projects per-exercise
  // and per-set detail for the expander. Aggregates and detail come from
  // a single pass to avoid re-walking the embed. Phase L addendum
  // (2026-05-14) — `avg_rpe` removed after EP feedback that the panel
  // shouldn't show both avg per-set RPE and overall session_rpe (one is
  // enough; session_rpe is the EP-meaningful one). The rpe walk dropped
  // with it.
  type CompletionsRow = {
    id: string
    program_day_id: string | null
    started_at: string
    completed_at: string
    duration_minutes: number | null
    session_rpe: number | null
    feedback: string | null
    program_day: { day_label: string; scheduled_date: string } | null
    exercise_logs:
      | Array<{
          id: string
          program_exercise_id: string | null
          program_exercise: {
            sort_order: number
            section_title: string | null
            superset_group_id: string | null
            exercise: { name: string } | null
          } | null
          set_logs: Array<{
            set_number: number
            reps_performed: number | null
            rep_metric: string | null
            // numeric coming through PostgREST can land as string; the
            // mapper coerces with Number() below.
            weight_value: number | string | null
            weight_metric: string | null
            optional_metric: string | null
            optional_value: string | null
            rpe: number | null
          }> | null
        }>
      | null
  }
  const completions: ProfileCompletion[] = (
    (completionsRaw ?? []) as unknown as CompletionsRow[]
  ).map((row) => {
    let setCount = 0

    const exercises: ProfileCompletionExercise[] = (row.exercise_logs ?? [])
      .map((el) => {
        const sets: ProfileCompletionSet[] = (el.set_logs ?? [])
          .map((sl) => {
            setCount += 1
            return {
              set_number: sl.set_number,
              reps: sl.reps_performed,
              rep_metric: sl.rep_metric,
              weight_value:
                sl.weight_value !== null ? Number(sl.weight_value) : null,
              weight_metric: sl.weight_metric,
              optional_metric: sl.optional_metric,
              optional_value: sl.optional_value,
              rpe: sl.rpe,
            }
          })
          .sort((a, b) => a.set_number - b.set_number)
        return {
          exercise_log_id: el.id,
          program_exercise_id: el.program_exercise_id,
          sort_order: el.program_exercise?.sort_order ?? 0,
          section_title: el.program_exercise?.section_title ?? null,
          superset_group_id: el.program_exercise?.superset_group_id ?? null,
          // exercise.name comes back null only if the underlying exercise
          // row was soft-deleted between completion and now. Fallback to
          // a generic label rather than failing the row.
          exercise_name: el.program_exercise?.exercise?.name ?? 'Exercise',
          sets,
        }
      })
      .sort((a, b) => a.sort_order - b.sort_order)

    return {
      id: row.id,
      // program_day is null when the parent program_day was soft-deleted
      // — the session FK is ON DELETE SET NULL. Show a defaulted label
      // rather than failing the row.
      day_label: row.program_day?.day_label ?? 'Ad-hoc',
      scheduled_date: row.program_day?.scheduled_date ?? null,
      started_at: row.started_at,
      completed_at: row.completed_at,
      duration_minutes: row.duration_minutes,
      session_rpe: row.session_rpe,
      feedback: row.feedback,
      set_count: setCount,
      exercises,
    }
  })

  return (
    <ClientProfile
      client={profileClient}
      categories={categoryRows ?? []}
      conditions={(conditions ?? []) as ProfileCondition[]}
      medications={(medications ?? []) as ProfileMedication[]}
      notes={profileNotes}
      program={programSummary}
      completions={completions}
      statusLabel={statusLabel}
      statusKind={statusKind}
      canResendInvite={canResendInvite}
      lastInviteSentAt={lastInviteSentAt}
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
      testHistory={testHistory}
      publications={publications}
    />
  )
}

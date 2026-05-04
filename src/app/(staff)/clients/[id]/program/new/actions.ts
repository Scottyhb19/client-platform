'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { NewProgramState } from './types'

/**
 * Creates a training block for a client.
 *
 * Writes, in order:
 *   1. Insert the new `programs` row (status='active'). Date-range overlaps
 *      with existing active programs for the same client are caught by the
 *      EXCLUDE constraint `programs_no_active_overlap`.
 *   2. Insert `program_weeks` for 1..duration.
 *   3. Insert `program_days` per week, one per EP-picked weekday. Each day
 *      gets `day_label = "Day N"` (N = 1..days_per_week) which the EP can
 *      rename inside the session builder.
 *
 * The form posts a `session_dow_0..N-1` field per session — each holds a
 * JS day-of-week int (0=Sun..6=Sat). The server validates that exactly
 * `days_per_week` distinct values landed.
 */
export async function createProgramAction(
  _prev: NewProgramState,
  formData: FormData,
): Promise<NewProgramState> {
  const { organizationId, userId } = await requireRole(['owner', 'staff'])

  const clientId = (formData.get('client_id') ?? '').toString()
  const name = (formData.get('name') ?? '').toString().trim()
  const durationRaw = (formData.get('duration_weeks') ?? '').toString().trim()
  const daysRaw = (formData.get('days_per_week') ?? '').toString().trim()
  const startDate = (formData.get('start_date') ?? '').toString().trim() || null
  const notes = toNullable(formData.get('notes'))

  const fieldErrors: NewProgramState['fieldErrors'] = {}
  if (!name) fieldErrors.name = 'Required.'
  const duration = parseInt(durationRaw, 10)
  const daysPerWeek = parseInt(daysRaw, 10)
  if (!Number.isFinite(duration) || duration < 1 || duration > 52) {
    fieldErrors.duration_weeks = 'Between 1 and 52.'
  }
  if (!Number.isFinite(daysPerWeek) || daysPerWeek < 1 || daysPerWeek > 7) {
    fieldErrors.days_per_week = 'Between 1 and 7.'
  }
  if (!clientId) {
    return { error: 'Missing client id.', fieldErrors: {} }
  }

  // Read N session day-of-week selections from the form. Skip if the
  // earlier validation already failed — no point reading more fields.
  let sessionDows: number[] = []
  if (Number.isFinite(daysPerWeek) && daysPerWeek >= 1 && daysPerWeek <= 7) {
    sessionDows = readSessionDows(formData, daysPerWeek)
    if (sessionDows.length !== daysPerWeek) {
      fieldErrors.session_days = 'Pick a day for every session.'
    } else if (new Set(sessionDows).size !== sessionDows.length) {
      fieldErrors.session_days = 'Each session must be on a different day.'
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors }
  }

  const supabase = await createSupabaseServerClient()

  // 1. Insert the new program. Multiple active programs per client are
  // allowed as long as their date ranges don't overlap (D-PROG-002);
  // the EXCLUDE constraint enforces it server-side.
  const { data: program, error: progErr } = await supabase
    .from('programs')
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      created_by_user_id: userId,
      name,
      duration_weeks: duration,
      start_date: startDate,
      status: 'active',
      notes,
    })
    .select('id')
    .single()

  if (progErr || !program) {
    // exclusion_violation (23P01) means the chosen date range collides
    // with an existing active block for this client. Translate the raw
    // Postgres message into something the EP can act on. Match the
    // copy_program flow's wording for consistency.
    if ((progErr as { code?: string } | null)?.code === '23P01') {
      return {
        error:
          'This client already has an active training block covering these dates. Pick a later start date, or archive the existing block first.',
        fieldErrors: { start_date: 'Overlaps an existing active block.' },
      }
    }
    return {
      error: `Failed to create program: ${progErr?.message ?? 'unknown'}`,
      fieldErrors: {},
    }
  }

  // 2. Insert weeks. week_number stays as the stable per-program label;
  // periodisation grouping (D-PROG-003) attaches notes here later.
  const weekRows = Array.from({ length: duration }, (_, i) => ({
    program_id: program.id,
    week_number: i + 1,
  }))

  const { data: weeks, error: weeksErr } = await supabase
    .from('program_weeks')
    .insert(weekRows)
    .select('id, week_number')

  if (weeksErr || !weeks) {
    return {
      error: `Program created but weeks insert failed: ${weeksErr?.message ?? 'unknown'}`,
      fieldErrors: {},
    }
  }

  // 3. Insert days. Each session attaches to the EP-picked weekday;
  // labels are "Day 1", "Day 2", ... in the order the sessions are
  // listed in the form. start_date is treated as the Monday anchor of
  // week 1 (matching the calendar's Mon-first grid). To convert a JS
  // day-of-week (0=Sun..6=Sat) to a Mon-first offset (Mon=0..Sun=6):
  //   monOffset = (dow + 6) % 7
  // Open-ended programs (start_date=null) skip day inserts — the EP
  // backfills via the calendar later.
  if (startDate === null) {
    revalidatePath(`/clients/${clientId}/program`)
    redirect(`/clients/${clientId}/program`)
  }

  const startDateObj = parseStartDate(startDate)
  if (startDateObj === null) {
    return {
      error: `Program created but start_date '${startDate}' couldn't be parsed.`,
      fieldErrors: {},
    }
  }

  const dayRows = weeks.flatMap((w) =>
    sessionDows.map((dow, i) => {
      const monOffset = (dow + 6) % 7
      const scheduledDate = addDaysIso(
        startDateObj,
        (w.week_number - 1) * 7 + monOffset,
      )
      return {
        program_id: program.id,
        program_week_id: w.id,
        day_label: `Day ${i + 1}`,
        scheduled_date: scheduledDate,
        sort_order: i,
      }
    }),
  )

  const { error: daysErr } = await supabase
    .from('program_days')
    .insert(dayRows)

  if (daysErr) {
    return {
      error: `Program + weeks created but days insert failed: ${daysErr.message}`,
      fieldErrors: {},
    }
  }

  revalidatePath(`/clients/${clientId}/program`)
  redirect(`/clients/${clientId}/program`)
}

function readSessionDows(formData: FormData, count: number): number[] {
  const dows: number[] = []
  for (let i = 0; i < count; i++) {
    const raw = formData.get(`session_dow_${i}`)
    if (raw === null) continue
    const n = parseInt(raw.toString(), 10)
    if (Number.isFinite(n) && n >= 0 && n <= 6) dows.push(n)
  }
  return dows
}

function parseStartDate(iso: string): Date | null {
  // Local-time interpretation; avoids the UTC-shift `new Date(iso)` can
  // introduce for date-only strings near midnight.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function addDaysIso(base: Date, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${da}`
}

function toNullable(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = value.toString().trim()
  return s.length === 0 ? null : s
}

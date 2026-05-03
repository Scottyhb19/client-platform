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
 *   1. Archive any existing active programs for this client (status='archived').
 *   2. Insert the new `programs` row (status='active').
 *   3. Insert `program_weeks` for 1..duration.
 *   4. Insert `program_days` per week, with auto-generated A/B/C labels
 *      mapped to sensible default weekdays for the chosen split count.
 *
 * All writes go through the authenticated user's session so RLS scopes
 * them to the caller's organization. Inserts on nested tables rely on
 * the parent chain being in-org (per rls-policies.md §Pattern C).
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
  const programType =
    (formData.get('program_type') ?? 'in_clinic').toString() === 'home_gym'
      ? 'home_gym'
      : 'in_clinic'
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
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors }
  }

  const supabase = await createSupabaseServerClient()

  // Post D-PROG-002: multiple active programs per client are allowed
  // as long as their date ranges don't overlap. The auto-archive of
  // the prior active program is gone — back-to-back blocks coexist.
  // If the new program's dates DO overlap an existing active block,
  // the EXCLUDE constraint `programs_no_active_overlap` catches it
  // and the insert below surfaces a clear error.

  // 1. Insert the new program.
  const { data: program, error: progErr } = await supabase
    .from('programs')
    .insert({
      organization_id: organizationId,
      client_id: clientId,
      created_by_user_id: userId,
      name,
      duration_weeks: duration,
      start_date: startDate,
      type: programType,
      status: 'active',
      notes,
    })
    .select('id')
    .single()

  if (progErr || !program) {
    return {
      error: `Failed to create program: ${progErr?.message ?? 'unknown'}`,
      fieldErrors: {},
    }
  }

  // 2. Insert weeks. Periodisation grouping (D-PROG-003) — week_number
  // remains a stable integer label per program; the calendar UI doesn't
  // surface weeks but the EP can attach periodisation notes here.
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

  // 3. Insert days per week with concrete scheduled_date (D-PROG-001).
  //
  // defaultDaysOfWeek() returns JS-convention day-of-week values
  // (0=Sunday, 1=Monday, ..., 6=Saturday). The schema stores
  // scheduled_date as a real calendar date, so we have to map each
  // (week_number, day_of_week) pair to a date offset from start_date.
  //
  // The convention the previous calendar UI used: start_date is treated
  // as the Monday of week 1, days within the week order Mon..Sun.
  // To convert JS dow to a Mon-first offset (Mon=0, Sun=6):
  //   monOffset = (dow + 6) % 7
  // and then scheduledDate = start_date + (week_number - 1) * 7 + monOffset.
  //
  // If start_date is null (open-ended program — duration_weeks may still
  // be set but there's no calendar anchor) we skip the day inserts.
  // The EP can backfill via the calendar later.
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

  const daysOfWeek = defaultDaysOfWeek(daysPerWeek)
  const dayRows = weeks.flatMap((w) =>
    daysOfWeek.map((dow, i) => {
      const monOffset = (dow + 6) % 7
      const scheduledDate = addDaysIso(
        startDateObj,
        (w.week_number - 1) * 7 + monOffset,
      )
      return {
        program_id: program.id,
        program_week_id: w.id,
        day_label: letterLabel(i),
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

/**
 * Reasonable defaults for which weekdays a split hits.
 * 0 = Sunday, 1 = Monday, …, 6 = Saturday.
 * User can override any day in the calendar later.
 */
function defaultDaysOfWeek(count: number): number[] {
  if (count <= 1) return [1]
  if (count === 2) return [1, 4]
  if (count === 3) return [1, 3, 5]
  if (count === 4) return [1, 2, 4, 5]
  if (count === 5) return [1, 2, 3, 4, 5]
  if (count === 6) return [1, 2, 3, 4, 5, 6]
  return [1, 2, 3, 4, 5, 6, 0]
}

function letterLabel(index: number): string {
  return String.fromCharCode(65 + index) // A, B, C…
}

function toNullable(value: FormDataEntryValue | null): string | null {
  if (value === null) return null
  const s = value.toString().trim()
  return s.length === 0 ? null : s
}

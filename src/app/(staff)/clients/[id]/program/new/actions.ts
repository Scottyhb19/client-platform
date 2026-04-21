'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { NewProgramState } from './types'

/**
 * Creates a mesocycle for a client.
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

  // 1. Archive existing active programs for this client.
  const { error: archiveErr } = await supabase
    .from('programs')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('status', 'active')

  if (archiveErr) {
    return {
      error: `Couldn't archive existing active program: ${archiveErr.message}`,
      fieldErrors: {},
    }
  }

  // 2. Insert the new program.
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

  // 3. Insert weeks.
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

  // 4. Insert days per week (A/B/C labels, sensible weekday defaults).
  const daysOfWeek = defaultDaysOfWeek(daysPerWeek)
  const dayRows = weeks.flatMap((w) =>
    daysOfWeek.map((dow, i) => ({
      program_week_id: w.id,
      day_label: letterLabel(i),
      day_of_week: dow,
      sort_order: i,
    })),
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

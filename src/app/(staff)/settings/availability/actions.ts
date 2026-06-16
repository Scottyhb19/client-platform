'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// ============================================================================
// Types — shape passed between server and client components.
//
// `day_of_week` uses the established 0=Mon … 6=Sun convention shared with
// client_available_slots (migration 20260420102500 line 481) and the staff
// schedule's work-week derivation (src/app/(staff)/schedule/page.tsx:79).
// ============================================================================

export type AvailabilityRuleRow = {
  id: string
  staff_user_id: string
  recurrence: 'weekly' | 'one_off'
  day_of_week: number | null
  specific_date: string | null
  start_time: string
  end_time: string
  slot_duration_minutes: number
  effective_from: string
  effective_to: string | null
  notes: string | null
  is_blocked: boolean
}

export type CreateWeeklyRuleInput = {
  day_of_week: number
  start_time: string
  end_time: string
  slot_duration_minutes: number
  effective_from?: string | null
  effective_to?: string | null
  notes?: string | null
}

export type CreateOneOffRuleInput = {
  specific_date: string
  start_time: string
  end_time: string
  slot_duration_minutes: number
  effective_from?: string | null
  effective_to?: string | null
  notes?: string | null
}

// Recurrence + day_of_week / specific_date are intentionally NOT editable
// post-create. Switching a weekly rule to a one-off (or moving it to a
// different weekday) is conceptually a different rule — delete-and-recreate
// rather than reshape-in-place keeps the audit trail honest.
export type UpdateAvailabilityRuleInput = {
  id: string
  start_time: string
  end_time: string
  slot_duration_minutes: number
  effective_from: string
  effective_to: string | null
  notes: string | null
}


// ============================================================================
// Validation helpers
// ============================================================================

// Accept HH:MM or HH:MM:SS — the <input type="time"> control emits HH:MM,
// Postgres's `time` type accepts either and stores HH:MM:SS internally.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

type TimesOK = { ok: true } | { ok: false; error: string }
function validateTimes(start: string, end: string): TimesOK {
  if (!TIME_RE.test(start)) return { ok: false, error: 'Start time must be HH:MM.' }
  if (!TIME_RE.test(end)) return { ok: false, error: 'End time must be HH:MM.' }
  // String compare works because the format is fixed-width and lexicographic
  // order matches chronological order for HH:MM(:SS).
  if (end <= start) return { ok: false, error: 'End time must be after start time.' }
  return { ok: true }
}

type DurOK = { ok: true } | { ok: false; error: string }
function validateSlotDuration(d: number): DurOK {
  if (!Number.isInteger(d)) {
    return { ok: false, error: 'Slot duration must be a whole number of minutes.' }
  }
  if (d < 5 || d > 240) {
    return { ok: false, error: 'Slot duration must be between 5 and 240 minutes.' }
  }
  return { ok: true }
}

type DatesOK =
  | { ok: true; from: string; to: string | null }
  | { ok: false; error: string }
function validateEffectiveDates(
  from: string | null | undefined,
  to: string | null | undefined,
): DatesOK {
  // Default `from` to today (Australia/Sydney is fine — Postgres CURRENT_DATE
  // uses the connection's timezone, but the validation here is for clean
  // server-side fallback only; the column has DEFAULT CURRENT_DATE anyway).
  const fromDate = from && from.length > 0 ? from : new Date().toISOString().slice(0, 10)
  if (!DATE_RE.test(fromDate)) {
    return { ok: false, error: 'Effective-from must be YYYY-MM-DD.' }
  }
  if (to != null && to !== '') {
    if (!DATE_RE.test(to)) {
      return { ok: false, error: 'Effective-to must be YYYY-MM-DD.' }
    }
    if (to < fromDate) {
      return { ok: false, error: 'Effective-to must be on or after effective-from.' }
    }
    return { ok: true, from: fromDate, to }
  }
  return { ok: true, from: fromDate, to: null }
}

function trimNotes(notes: string | null | undefined): string | null {
  if (notes == null) return null
  const trimmed = notes.trim()
  if (trimmed.length === 0) return null
  // The schema doesn't constrain length, but we don't want a runaway textarea
  // pushing megabytes through the audit log. 500 chars is plenty for the
  // "Tuesday clinic — wear closed-toe shoes" use case.
  if (trimmed.length > 500) return trimmed.slice(0, 500)
  return trimmed
}


// ============================================================================
// Actions
//
// Authorization: `requireRole(['owner','staff'])` is a UX gate — RLS is the
// security boundary. The new policies (migration 20260511120000 §5) restrict
// non-owners to rules where `staff_user_id = auth.uid()`; owners can write
// for any staff in their org. v1 UI always sets staff_user_id to the caller,
// so both roles work uniformly.
//
// Revalidation: every mutation refreshes:
//   /settings/availability — this page
//   /schedule              — work-week derivation reads availability_rules
//   /portal/book/new       — Phase F picker consumes client_available_slots
// ============================================================================

export async function createWeeklyRuleAction(
  input: CreateWeeklyRuleInput,
): Promise<{ error: string | null; id: string | null }> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])

  if (!Number.isInteger(input.day_of_week) || input.day_of_week < 0 || input.day_of_week > 6) {
    return { error: 'Day of week must be 0–6 (Mon–Sun).', id: null }
  }
  const times = validateTimes(input.start_time, input.end_time)
  if (!times.ok) return { error: times.error, id: null }
  const dur = validateSlotDuration(input.slot_duration_minutes)
  if (!dur.ok) return { error: dur.error, id: null }
  const dates = validateEffectiveDates(input.effective_from, input.effective_to)
  if (!dates.ok) return { error: dates.error, id: null }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('availability_rules')
    .insert({
      organization_id: organizationId,
      staff_user_id: userId,
      recurrence: 'weekly',
      day_of_week: input.day_of_week,
      specific_date: null,
      start_time: input.start_time,
      end_time: input.end_time,
      slot_duration_minutes: input.slot_duration_minutes,
      effective_from: dates.from,
      effective_to: dates.to,
      notes: trimNotes(input.notes),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return {
        error: 'A rule with those exact times already exists for that day.',
        id: null,
      }
    }
    return { error: `Could not save rule: ${error.message}`, id: null }
  }

  revalidatePath('/settings/availability')
  revalidatePath('/schedule')
  revalidatePath('/portal/book/new')
  return { error: null, id: data.id }
}

export async function createOneOffRuleAction(
  input: CreateOneOffRuleInput,
): Promise<{ error: string | null; id: string | null }> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])

  if (!DATE_RE.test(input.specific_date)) {
    return { error: 'Date must be YYYY-MM-DD.', id: null }
  }
  const times = validateTimes(input.start_time, input.end_time)
  if (!times.ok) return { error: times.error, id: null }
  const dur = validateSlotDuration(input.slot_duration_minutes)
  if (!dur.ok) return { error: dur.error, id: null }
  const dates = validateEffectiveDates(input.effective_from, input.effective_to)
  if (!dates.ok) return { error: dates.error, id: null }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('availability_rules')
    .insert({
      organization_id: organizationId,
      staff_user_id: userId,
      recurrence: 'one_off',
      day_of_week: null,
      specific_date: input.specific_date,
      start_time: input.start_time,
      end_time: input.end_time,
      slot_duration_minutes: input.slot_duration_minutes,
      effective_from: dates.from,
      effective_to: dates.to,
      notes: trimNotes(input.notes),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return {
        error: 'An exception with those exact times already exists for that date.',
        id: null,
      }
    }
    return { error: `Could not save exception: ${error.message}`, id: null }
  }

  revalidatePath('/settings/availability')
  revalidatePath('/schedule')
  revalidatePath('/portal/book/new')
  return { error: null, id: data.id }
}

// ----------------------------------------------------------------------------
// "Close a date" (P1-5). A closure is a one-off rule with is_blocked=true that
// SUBTRACTS its window from generated slots. Whole-day by default
// (00:00–23:59:59), or a partial window; a date range fans out to one blocked
// row per day. Already-closed date+window collisions (23505) are skipped.
// ----------------------------------------------------------------------------
export type CreateDateClosureInput = {
  from_date: string
  to_date?: string | null
  start_time?: string | null // empty/null = whole day
  end_time?: string | null
  notes?: string | null
}

function enumerateDays(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  let cur = Date.UTC(fy!, fm! - 1, fd!)
  const end = Date.UTC(ty!, tm! - 1, td!)
  const out: string[] = []
  while (cur <= end && out.length <= 400) {
    const d = new Date(cur)
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`,
    )
    cur += 86_400_000
  }
  return out
}

export async function createDateClosureAction(
  input: CreateDateClosureInput,
): Promise<{ error: string | null; created: number }> {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])

  if (!DATE_RE.test(input.from_date)) {
    return { error: 'Date must be YYYY-MM-DD.', created: 0 }
  }
  const to =
    input.to_date && input.to_date.length > 0 ? input.to_date : input.from_date
  if (!DATE_RE.test(to)) {
    return { error: 'End date must be YYYY-MM-DD.', created: 0 }
  }
  if (to < input.from_date) {
    return { error: 'End date must be on or after the start date.', created: 0 }
  }

  const wholeDay =
    (!input.start_time || input.start_time.length === 0) &&
    (!input.end_time || input.end_time.length === 0)
  const start = wholeDay ? '00:00:00' : (input.start_time ?? '00:00:00')
  const end = wholeDay ? '23:59:59' : (input.end_time ?? '23:59:59')
  const times = validateTimes(start, end)
  if (!times.ok) return { error: times.error, created: 0 }

  const days = enumerateDays(input.from_date, to)
  if (days.length === 0) {
    return { error: 'No dates in that range.', created: 0 }
  }
  if (days.length > 90) {
    return { error: 'Closure range too large (max 90 days).', created: 0 }
  }

  const supabase = await createSupabaseServerClient()
  let created = 0
  for (const d of days) {
    const { error } = await supabase.from('availability_rules').insert({
      organization_id: organizationId,
      staff_user_id: userId,
      recurrence: 'one_off',
      day_of_week: null,
      specific_date: d,
      start_time: start,
      end_time: end,
      slot_duration_minutes: 60, // vestigial for a block — it generates no slots
      effective_from: d,
      effective_to: null,
      notes: trimNotes(input.notes),
      is_blocked: true,
    })
    if (!error) {
      created += 1
    } else if (error.code !== '23505') {
      // 23505 = that date+window is already closed; skip. Anything else aborts.
      return { error: `Could not close ${d}: ${error.message}`, created }
    }
  }

  revalidatePath('/settings/availability')
  revalidatePath('/schedule')
  revalidatePath('/portal/book/new')
  return { error: null, created }
}

export async function updateAvailabilityRuleAction(
  input: UpdateAvailabilityRuleInput,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const times = validateTimes(input.start_time, input.end_time)
  if (!times.ok) return { error: times.error }
  const dur = validateSlotDuration(input.slot_duration_minutes)
  if (!dur.ok) return { error: dur.error }
  const dates = validateEffectiveDates(input.effective_from, input.effective_to)
  if (!dates.ok) return { error: dates.error }

  const supabase = await createSupabaseServerClient()
  // RLS scopes the row to the caller's org + (for non-owners) their own
  // staff_user_id. A foreign rule simply matches zero rows.
  const { error, count } = await supabase
    .from('availability_rules')
    .update(
      {
        start_time: input.start_time,
        end_time: input.end_time,
        slot_duration_minutes: input.slot_duration_minutes,
        effective_from: dates.from,
        effective_to: dates.to,
        notes: trimNotes(input.notes),
      },
      { count: 'exact' },
    )
    .eq('id', input.id)
    .is('deleted_at', null)

  if (error) {
    if (error.code === '23505') {
      return { error: 'A rule with those exact times already exists.' }
    }
    return { error: `Could not update rule: ${error.message}` }
  }
  if (count === 0) {
    return { error: 'Rule not found, or you don’t have permission to edit it.' }
  }

  revalidatePath('/settings/availability')
  revalidatePath('/schedule')
  revalidatePath('/portal/book/new')
  return { error: null }
}

export async function deleteAvailabilityRuleAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  // RPC, not direct UPDATE — direct UPDATE to deleted_at returns 42501 by
  // the well-documented PostgREST + RLS + soft-delete interaction. The RPC
  // (migration 20260511120100) is SECURITY DEFINER and re-checks auth +
  // per-staff ownership in plpgsql.
  const { error } = await supabase.rpc('soft_delete_availability_rule', {
    p_id: id,
  })

  if (error) {
    if (error.code === 'no_data_found') {
      return { error: 'Rule not found, or already deleted.' }
    }
    if (error.code === '42501') {
      return { error: 'You don’t have permission to delete that rule.' }
    }
    return { error: `Could not delete rule: ${error.message}` }
  }

  revalidatePath('/settings/availability')
  revalidatePath('/schedule')
  revalidatePath('/portal/book/new')
  return { error: null }
}

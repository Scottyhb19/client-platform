'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { assertClientLive } from '@/lib/clients/archive-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  loadActiveBatteries,
  resolveMetricSettings,
  validateMetricValue,
  type ResolvedMetricSettings,
} from '@/lib/testing'
import type { BatteryRow } from '@/lib/testing/loader-types'

/**
 * Input shape for createTestSession. Mirrors the brief's three-state
 * capture flow: pick (testId/metricId/side per row) → enter (value)
 * → confirm & save.
 */
export type TestResultInput = {
  testId: string
  metricId: string
  side: 'left' | 'right' | null
  value: number
  /** Unit must match the resolved metric's unit — defence in depth. */
  unit: string
}

export type CreateTestSessionInput = {
  clientId: string
  /** ISO 8601 timestamp. */
  conductedAt: string
  /** 'manual' for the UI flow; 'vald' / 'imported' reserved for importer paths. */
  source?: 'manual' | 'vald' | 'imported'
  appointmentId?: string | null
  notes?: string | null
  /**
   * If the modal applied a saved battery as the metric set, store its id
   * on the session so a future modal-open can show "Last used: <name>"
   * for this client. Pure UX hint — has no effect on visibility or RLS.
   */
  appliedBatteryId?: string | null
  results: TestResultInput[]
  /**
   * If true, results that triggered a soft-bound warning have already
   * been confirmed by the clinician via the capture modal — skip the
   * server-side warning gate.
   */
  acceptedWarnings?: boolean
}

export type CreateTestSessionResult =
  | { data: { sessionId: string }; error: null }
  | { data: null; error: string; warnings?: string[] }

/**
 * Capture a test session and its results atomically.
 *
 * Validation pipeline (defence in depth — the DB enforces what it can,
 * but app-layer feedback is faster and clearer):
 *   1. Auth + role gate
 *   2. Per-result resolver lookup (rejects unknown / disabled metrics,
 *      catches unit drift, enforces side rules)
 *   3. Per-result bound check (hard min/max → reject; soft → warn)
 *   4. Atomic INSERT via the create_test_session RPC (which itself
 *      runs under the caller's RLS — Tampa Scale, never wall etc.)
 *
 * Returns the new sessionId, or an error string suitable for surfacing
 * to the EP. Soft warnings are bundled separately so the modal can show
 * a confirm dialog and re-submit with acceptedWarnings = true.
 */
export async function createTestSessionAction(
  input: CreateTestSessionInput,
): Promise<CreateTestSessionResult> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // CN-7 (P1-4): the archived profile renders its Reports tab read-only, so
  // this capture action is reachable for an archived client — refuse it.
  const live = await assertClientLive(supabase, input.clientId)
  if (live.error) return { data: null, error: live.error }

  // Empty-body guard.
  if (!Array.isArray(input.results) || input.results.length === 0) {
    return { data: null, error: 'At least one result is required.' }
  }

  // Resolve every metric up front. Cheaper than re-reading per insert
  // and lets us produce all errors / warnings in one pass.
  const resolved = new Map<string, ResolvedMetricSettings>()
  const warnings: string[] = []

  for (const r of input.results) {
    const key = `${r.testId}::${r.metricId}::${r.side ?? '∅'}`
    const settings = await resolveMetricSettings(
      supabase,
      organizationId,
      r.testId,
      r.metricId,
    )
    if (!settings) {
      return {
        data: null,
        error: `Unknown metric: ${r.testId} / ${r.metricId}.`,
      }
    }

    if (settings.side_left_right && r.side === null) {
      return {
        data: null,
        error: `${settings.metric_label} is bilateral — pick a side.`,
      }
    }
    if (!settings.side_left_right && r.side !== null) {
      return {
        data: null,
        error: `${settings.metric_label} is not bilateral — side must be empty.`,
      }
    }
    if (r.unit !== settings.unit) {
      return {
        data: null,
        error: `${settings.metric_label}: unit must be "${settings.unit}", got "${r.unit}".`,
      }
    }

    const verdict = validateMetricValue({
      testId: r.testId,
      metricId: r.metricId,
      unit: r.unit,
      inputType: settings.input_type,
      value: r.value,
    })
    if (!verdict.ok) {
      return {
        data: null,
        error: `${settings.metric_label}: ${verdict.error}`,
      }
    }
    if (verdict.warning) {
      warnings.push(`${settings.metric_label}: ${verdict.warning}`)
    }

    resolved.set(key, settings)
  }

  // If any warnings fired and the clinician hasn't already accepted
  // them in the modal, surface them to trigger a confirm dialog.
  if (warnings.length > 0 && !input.acceptedWarnings) {
    return {
      data: null,
      error: 'Some values look unusual.',
      warnings,
    }
  }

  // Hand off to the atomic RPC. RLS / FK-guards / lockdown trigger /
  // cross-org guard all evaluate inside the function.
  const rpcPayload = input.results.map((r) => ({
    test_id: r.testId,
    metric_id: r.metricId,
    side: r.side,
    value: r.value,
    unit: r.unit,
  }))

  const { data: sessionId, error } = await supabase.rpc(
    'create_test_session',
    {
      p_client_id: input.clientId,
      p_conducted_at: input.conductedAt,
      p_source: input.source ?? 'manual',
      // supabase-js's type generator treats all plpgsql args as
      // non-nullable; the SQL function itself accepts NULL fine.
      // The casts keep the call intent explicit at the boundary.
      p_appointment_id: (input.appointmentId ?? null) as unknown as string,
      p_notes: (input.notes ?? null) as unknown as string,
      p_applied_battery_id: (input.appliedBatteryId ?? null) as unknown as string,
      p_results: rpcPayload,
    },
  )

  if (error || !sessionId) {
    return {
      data: null,
      error: error?.message ?? 'Failed to create test session.',
    }
  }

  // Refresh the client profile so the captured session shows on the
  // Reports tab without a manual reload.
  revalidatePath(`/clients/${input.clientId}`)

  return { data: { sessionId: sessionId as string }, error: null }
}

/**
 * Soft-delete a test session. Keeps results queryable for staff via the
 * audit trail; removes it from active views.
 *
 * Routes through the soft_delete_test_session SECURITY DEFINER RPC.
 * Direct UPDATE setting deleted_at fails 42501 because the SELECT policy
 * filters deleted_at IS NULL — see migration
 * 20260429120000_soft_delete_rpcs.sql for the bug + fix.
 */
export async function softDeleteTestSessionAction(
  sessionId: string,
  clientId: string,
): Promise<{ data: { ok: true } | null; error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // CN-7 (P1-4): archived record is read-only — no test-session deletion.
  const live = await assertClientLive(supabase, clientId)
  if (live.error) return { data: null, error: live.error }

  const { error } = await supabase.rpc('soft_delete_test_session', {
    p_id: sessionId,
  })

  if (error) {
    return { data: null, error: error.message }
  }

  revalidatePath(`/clients/${clientId}`)
  return { data: { ok: true }, error: null }
}

// ---------------------------------------------------------------------------
// Session battery tagging (Phase J-2-γ)
//
// The TestPublishDialog gains a "Session battery" select so the EP can
// retroactively tag a test_session with a saved battery — necessary
// when the battery template wasn't applied at capture time. The portal
// Data tab reads test_sessions.applied_battery_id via the loader join
// to test_batteries.name and surfaces it as the session-group header.
// ---------------------------------------------------------------------------

export type SessionBatteryContext = {
  /** Active saved batteries available for tagging, sorted by name. */
  batteries: BatteryRow[]
  /** Current applied_battery_id on the session, or null when untagged. */
  currentBatteryId: string | null
}

/**
 * Load the data the SessionBatteryTag UI needs: the org's active
 * saved batteries + the session's current applied_battery_id. Single
 * round-trip via parallel queries.
 *
 * Returns null on the session lookup if the session doesn't exist or
 * the caller can't see it (RLS). The component falls back to a
 * "not tagged" treatment in that case.
 */
export async function getSessionBatteryContextAction(input: {
  clientId: string
  sessionId: string
}): Promise<
  | { data: SessionBatteryContext; error: null }
  | { data: null; error: string }
> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [batteries, sessionRes] = await Promise.all([
    loadActiveBatteries(supabase, organizationId),
    supabase
      .from('test_sessions')
      .select('applied_battery_id')
      .eq('id', input.sessionId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (sessionRes.error) {
    return { data: null, error: sessionRes.error.message }
  }

  return {
    data: {
      batteries,
      currentBatteryId: sessionRes.data?.applied_battery_id ?? null,
    },
    error: null,
  }
}

/**
 * Set (or clear) the applied battery on a test_session. RLS enforces
 * org-scope on the UPDATE; an additional same-org check on the
 * battery itself prevents cross-org tagging via a forged id.
 *
 * Passing batteryId = null clears the tag.
 */
export async function setSessionBatteryAction(input: {
  clientId: string
  sessionId: string
  batteryId: string | null
}): Promise<{ ok: true; error: null } | { ok: false; error: string }> {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // CN-7 (P1-4): archived record is read-only — no retroactive battery tag.
  const live = await assertClientLive(supabase, input.clientId)
  if (live.error) return { ok: false, error: live.error }

  // Defence in depth — if a non-null battery id is supplied, confirm it
  // belongs to the caller's org and is live. RLS would block a
  // cross-org write to test_sessions, but this short-circuits to a
  // clearer error message before the UPDATE.
  if (input.batteryId !== null) {
    const { data: battery, error: bErr } = await supabase
      .from('test_batteries')
      .select('id, organization_id, deleted_at')
      .eq('id', input.batteryId)
      .is('deleted_at', null)
      .maybeSingle()
    if (bErr) return { ok: false, error: bErr.message }
    if (!battery || battery.organization_id !== organizationId) {
      return { ok: false, error: 'Battery not found in your practice.' }
    }
  }

  const { error } = await supabase
    .from('test_sessions')
    .update({ applied_battery_id: input.batteryId })
    .eq('id', input.sessionId)

  if (error) return { ok: false, error: error.message }

  // Staff Reports tab + the portal Data tab both read this. Force-
  // dynamic on /portal/reports means it re-renders fresh on every
  // request; the revalidate is for the staff client profile cache.
  revalidatePath(`/clients/${input.clientId}`)
  revalidatePath('/portal/reports')

  return { ok: true, error: null }
}

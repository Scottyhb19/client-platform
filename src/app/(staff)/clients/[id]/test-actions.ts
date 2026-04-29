'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  resolveMetricSettings,
  validateMetricValue,
  type ResolvedMetricSettings,
} from '@/lib/testing'

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

  const { error } = await supabase.rpc('soft_delete_test_session', {
    p_id: sessionId,
  })

  if (error) {
    return { data: null, error: error.message }
  }

  revalidatePath(`/clients/${clientId}`)
  return { data: { ok: true }, error: null }
}

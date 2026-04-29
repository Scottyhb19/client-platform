'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type {
  ClientPortalVisibility,
  ClientViewChart,
  ComparisonMode,
  DefaultChart,
  DirectionOfGood,
} from '@/lib/testing'

/* ============================================================================
   3.1 — Per-metric overrides
   ============================================================================
   The dropdown UI calls setOverrideFieldAction with `value === null` to
   clear a single field; the row-level Reset link calls
   resetOverrideRowAction which DELETEs the whole row.

   practice_test_settings has no soft-delete column — Reset is a true
   DELETE. Field-level NULL leaves the row in place with that field NULL,
   matching schema-doc §4.3 ("any field overridden = row exists").

   The "all-NULL row would have zero meaning" hygiene rule: if clearing a
   field would leave every column NULL, DELETE the row instead of leaving
   a ghost. Keeps the badge logic honest — a row exists ⇒ at least one
   override.
   ============================================================================ */

export type OverrideField =
  | 'direction_of_good'
  | 'default_chart'
  | 'comparison_mode'
  | 'client_portal_visibility'
  | 'client_view_chart'

const TEST_ID_RE = /^[a-z0-9_]{1,80}$/
const METRIC_ID_RE = /^[a-z0-9_]{1,80}$/

const VALID_VALUES: Record<OverrideField, readonly string[]> = {
  direction_of_good: ['higher', 'lower', 'target_range', 'context_dependent'],
  default_chart: ['line', 'bar', 'radar', 'asymmetry_bar', 'target_zone'],
  comparison_mode: ['absolute', 'bilateral_lsi', 'vs_baseline', 'vs_normative'],
  client_portal_visibility: ['auto', 'on_publish', 'never'],
  client_view_chart: ['line', 'milestone', 'bar', 'narrative_only', 'hidden'],
}

export async function setOverrideFieldAction(
  testId: string,
  metricId: string,
  field: OverrideField,
  value: string | null,
): Promise<{ error: string | null }> {
  if (!TEST_ID_RE.test(testId) || !METRIC_ID_RE.test(metricId)) {
    return { error: 'Invalid test or metric id.' }
  }
  if (!Object.prototype.hasOwnProperty.call(VALID_VALUES, field)) {
    return { error: 'Invalid field.' }
  }
  if (value !== null && !VALID_VALUES[field].includes(value)) {
    return { error: `Invalid value for ${field}.` }
  }

  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // CASE 1: Setting a non-null value. UPSERT in one round-trip.
  if (value !== null) {
    const { error } = await supabase
      .from('practice_test_settings')
      .upsert(buildUpsertPayload(organizationId, testId, metricId, field, value), {
        onConflict: 'organization_id,test_id,metric_id',
      })
    if (error) return { error: `Save failed: ${error.message}` }
    revalidatePath('/settings/tests')
    return { error: null }
  }

  // CASE 2: Clearing a field. Read first so we can decide UPDATE vs DELETE.
  const { data: existing, error: readErr } = await supabase
    .from('practice_test_settings')
    .select(
      'direction_of_good, default_chart, comparison_mode, ' +
        'client_portal_visibility, client_view_chart',
    )
    .eq('organization_id', organizationId)
    .eq('test_id', testId)
    .eq('metric_id', metricId)
    .maybeSingle()
  if (readErr) return { error: `Save failed: ${readErr.message}` }

  // No row, nothing to clear.
  if (!existing) {
    return { error: null }
  }

  // PostgREST's typed result is a success/error union — readErr already
  // covers the error path, so cast through unknown to read the columns.
  const row = (existing as unknown) as {
    direction_of_good: DirectionOfGood | null
    default_chart: DefaultChart | null
    comparison_mode: ComparisonMode | null
    client_portal_visibility: ClientPortalVisibility | null
    client_view_chart: ClientViewChart | null
  }

  // After clearing this field, would every other column also be NULL?
  // If yes, the row is meaningless — DELETE.
  const remaining: ReadonlyArray<string | null> = [
    field === 'direction_of_good' ? null : row.direction_of_good,
    field === 'default_chart' ? null : row.default_chart,
    field === 'comparison_mode' ? null : row.comparison_mode,
    field === 'client_portal_visibility' ? null : row.client_portal_visibility,
    field === 'client_view_chart' ? null : row.client_view_chart,
  ]
  if (remaining.every((v) => v === null)) {
    const { error } = await supabase
      .from('practice_test_settings')
      .delete()
      .eq('organization_id', organizationId)
      .eq('test_id', testId)
      .eq('metric_id', metricId)
    if (error) return { error: `Save failed: ${error.message}` }
    revalidatePath('/settings/tests')
    return { error: null }
  }

  // UPDATE single field to NULL.
  const { error } = await supabase
    .from('practice_test_settings')
    .update(buildSingleFieldUpdate(field, null))
    .eq('organization_id', organizationId)
    .eq('test_id', testId)
    .eq('metric_id', metricId)
  if (error) return { error: `Save failed: ${error.message}` }
  revalidatePath('/settings/tests')
  return { error: null }
}

export async function resetOverrideRowAction(
  testId: string,
  metricId: string,
): Promise<{ error: string | null }> {
  if (!TEST_ID_RE.test(testId) || !METRIC_ID_RE.test(metricId)) {
    return { error: 'Invalid test or metric id.' }
  }

  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('practice_test_settings')
    .delete()
    .eq('organization_id', organizationId)
    .eq('test_id', testId)
    .eq('metric_id', metricId)
  if (error) return { error: `Reset failed: ${error.message}` }

  revalidatePath('/settings/tests')
  return { error: null }
}

/* ============================================================================
   3.2 — Custom tests
   ============================================================================
   Per Q2 sign-off: client auto-slugifies the test name to a `custom_…` id
   and surfaces the result. The server validates against the DB CHECK
   regex but does not slugify itself — the client is the single owner of
   the slug logic.

   Per Q4 sign-off: archive lives on this surface (not on the Disable
   list). Archive routes through the soft_delete_practice_custom_test RPC
   from migration 20260429120000 to dodge the deleted_at-IS-NULL SELECT-
   policy trap.

   Edit invariants:
   - test_id is immutable. Past test_results reference it by string.
   - metric_id slugs already in the metrics array are immutable. Removing
     a metric is permitted (past results stay queryable but won't appear
     in new captures).
   - Adding a new metric is permitted; the new id must be unique within
     the test.
   ============================================================================ */

const CATEGORY_ID_RE = /^[a-z0-9_]{1,80}$/
const SUBCATEGORY_ID_RE = /^[a-z0-9_]{1,80}$/
const TEST_ID_FULL_RE = /^custom_[a-z0-9_]{1,73}$/

const VALID_INPUT_TYPES: readonly string[] = ['decimal', 'integer']

export interface CustomTestMetricInput {
  id: string
  label: string
  unit: string
  input_type: 'decimal' | 'integer'
  bilateral: boolean
  direction_of_good: string
  default_chart: string
  comparison_mode: string
  client_portal_visibility: string
  client_view_chart: string
}

export interface CreateCustomTestInput {
  category_id: string
  subcategory_id: string
  test_id: string
  name: string
  display_order: number
  metrics: CustomTestMetricInput[]
}

export interface UpdateCustomTestInput {
  category_id: string
  subcategory_id: string
  name: string
  display_order: number
  metrics: CustomTestMetricInput[]
}

function validateInput(
  input: CreateCustomTestInput | UpdateCustomTestInput,
  options: { requireTestId: boolean },
): string | null {
  if (!CATEGORY_ID_RE.test(input.category_id)) {
    return 'Category id must be 1–80 lowercase letters, digits, or underscores.'
  }
  if (!SUBCATEGORY_ID_RE.test(input.subcategory_id)) {
    return 'Subcategory id must be 1–80 lowercase letters, digits, or underscores.'
  }
  if (options.requireTestId) {
    const create = input as CreateCustomTestInput
    if (!TEST_ID_FULL_RE.test(create.test_id)) {
      return 'Test id must start with "custom_" and use only lowercase letters, digits, or underscores (max 80 chars).'
    }
  }
  const trimmedName = input.name.trim()
  if (trimmedName.length === 0 || trimmedName.length > 200) {
    return 'Name must be 1–200 characters.'
  }
  if (input.metrics.length < 1 || input.metrics.length > 30) {
    return 'A test needs between 1 and 30 metrics.'
  }
  const seen = new Set<string>()
  for (const m of input.metrics) {
    if (!METRIC_ID_RE.test(m.id)) {
      return `Metric id "${m.id}" must be 1–80 lowercase letters, digits, or underscores.`
    }
    if (seen.has(m.id)) {
      return `Duplicate metric id "${m.id}".`
    }
    seen.add(m.id)
    if (m.label.trim().length === 0 || m.label.length > 200) {
      return `Metric "${m.id}" label must be 1–200 chars.`
    }
    if (m.unit.trim().length === 0 || m.unit.length > 30) {
      return `Metric "${m.id}" unit must be 1–30 chars.`
    }
    if (!VALID_INPUT_TYPES.includes(m.input_type)) {
      return `Metric "${m.id}" input type must be decimal or integer.`
    }
    if (
      !VALID_VALUES.direction_of_good.includes(m.direction_of_good) ||
      !VALID_VALUES.default_chart.includes(m.default_chart) ||
      !VALID_VALUES.comparison_mode.includes(m.comparison_mode) ||
      !VALID_VALUES.client_portal_visibility.includes(m.client_portal_visibility) ||
      !VALID_VALUES.client_view_chart.includes(m.client_view_chart)
    ) {
      return `Metric "${m.id}" has an invalid rendering-hint value.`
    }
  }
  return null
}

function buildMetricsJson(metrics: CustomTestMetricInput[]) {
  return metrics.map((m) => ({
    id: m.id,
    label: m.label.trim(),
    unit: m.unit.trim(),
    input_type: m.input_type,
    side: m.bilateral ? ['left', 'right'] : null,
    direction_of_good: m.direction_of_good,
    default_chart: m.default_chart,
    comparison_mode: m.comparison_mode,
    client_portal_visibility: m.client_portal_visibility,
    client_view_chart: m.client_view_chart,
  }))
}

export async function createCustomTestAction(
  input: CreateCustomTestInput,
): Promise<{ error: string | null; id: string | null }> {
  const validationError = validateInput(input, { requireTestId: true })
  if (validationError) return { error: validationError, id: null }

  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('practice_custom_tests')
    .insert({
      organization_id: organizationId,
      category_id: input.category_id,
      subcategory_id: input.subcategory_id,
      test_id: input.test_id,
      name: input.name.trim(),
      display_order: input.display_order,
      metrics: buildMetricsJson(input.metrics),
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return { error: `A custom test with id "${input.test_id}" already exists.`, id: null }
    }
    return { error: `Save failed: ${error.message}`, id: null }
  }

  revalidatePath('/settings/tests')
  return { error: null, id: data?.id ?? null }
}

export async function updateCustomTestAction(
  id: string,
  input: UpdateCustomTestInput,
): Promise<{ error: string | null }> {
  const validationError = validateInput(input, { requireTestId: false })
  if (validationError) return { error: validationError }

  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('practice_custom_tests')
    .update({
      category_id: input.category_id,
      subcategory_id: input.subcategory_id,
      name: input.name.trim(),
      display_order: input.display_order,
      metrics: buildMetricsJson(input.metrics),
    })
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)

  if (error) return { error: `Save failed: ${error.message}` }

  revalidatePath('/settings/tests')
  return { error: null }
}

export async function archiveCustomTestAction(
  id: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // soft_delete_practice_custom_test is SECURITY DEFINER — the function
  // body re-checks org + role inside, so the RPC IS the security boundary.
  const { error } = await supabase.rpc('soft_delete_practice_custom_test', {
    p_id: id,
  })
  if (error) return { error: `Archive failed: ${error.message}` }

  revalidatePath('/settings/tests')
  return { error: null }
}

// ----------------------------------------------------------------------------
// Type-safe payload builders. Per-field switches let TS narrow each branch
// to the exact column type — avoids dynamic-key updates which the strict
// generated Supabase types reject.
// ----------------------------------------------------------------------------

function buildUpsertPayload(
  organizationId: string,
  testId: string,
  metricId: string,
  field: OverrideField,
  value: string,
) {
  const base = {
    organization_id: organizationId,
    test_id: testId,
    metric_id: metricId,
  }
  switch (field) {
    case 'direction_of_good':
      return { ...base, direction_of_good: value as DirectionOfGood }
    case 'default_chart':
      return { ...base, default_chart: value as DefaultChart }
    case 'comparison_mode':
      return { ...base, comparison_mode: value as ComparisonMode }
    case 'client_portal_visibility':
      return { ...base, client_portal_visibility: value as ClientPortalVisibility }
    case 'client_view_chart':
      return { ...base, client_view_chart: value as ClientViewChart }
  }
}

function buildSingleFieldUpdate(field: OverrideField, value: string | null) {
  switch (field) {
    case 'direction_of_good':
      return { direction_of_good: value as DirectionOfGood | null }
    case 'default_chart':
      return { default_chart: value as DefaultChart | null }
    case 'comparison_mode':
      return { comparison_mode: value as ComparisonMode | null }
    case 'client_portal_visibility':
      return { client_portal_visibility: value as ClientPortalVisibility | null }
    case 'client_view_chart':
      return { client_view_chart: value as ClientViewChart | null }
  }
}

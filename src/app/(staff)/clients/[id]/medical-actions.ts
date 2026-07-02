'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * CN-6 — medical-history CRUD (docs/polish/client-profile-clinical-notes.md).
 *
 * client_medical_history was a read-only rendering of an unwritable table:
 * the profile loader's SELECT was the only application reference. These
 * actions give the Details tab add / edit / resolve-reactivate / archive.
 *
 * Verbs:
 *   - "Mark resolved" (is_active = false) is the primary remove verb — it
 *     preserves history and avoids the soft-delete trap entirely (plain
 *     RLS-scoped UPDATE).
 *   - Archive (deleted_at) is for conditions entered by mistake and routes
 *     through the soft_delete_client_medical_history SECURITY DEFINER RPC
 *     (20260611130100) — a bare UPDATE would 42501 against the SELECT
 *     policy's deleted_at IS NULL filter.
 *
 * Concurrency: OCC via the version column (migration 20260702120000,
 * closing the CN-6 deferred item — the two-staff beta made last-write-wins
 * a live clobber window). updateMedicalConditionAction includes the
 * last-read version in its UPDATE WHERE clause; a concurrent write matches
 * zero rows and surfaces a conflict, mirroring clinical_notes. The
 * is_active toggle and archive stay versionless deliberately: both write a
 * single field whose intent is unambiguous, so refusing them on an
 * unrelated concurrent edit would be friction without protection.
 *
 * All writes are staff-only via requireRole + the table's RLS policies
 * (Pattern A staff-only SELECT since CN-2; INSERT/UPDATE staff-only since
 * v1). Validation mirrors the DB CHECKs (condition 1–500 chars; diagnosis_date
 * 1900-01-01..today per cmh_diagnosis_date_sane). The retired severity field is
 * replaced by show_on_header (the Profile Tag / No-tag header control).
 */

export type MedicalConditionInput = {
  condition: string
  /** 'YYYY-MM-DD' or '' for none. */
  diagnosisDate: string
  /** Profile "Tag / No-tag": show this condition on the client header. */
  showOnHeader: boolean
  notes: string
}

type Validated = {
  condition: string
  diagnosis_date: string | null
  show_on_header: boolean
  notes: string | null
}

function validateConditionInput(
  input: MedicalConditionInput,
): { ok: Validated } | { error: string } {
  const condition = input.condition.trim()
  if (condition.length < 1 || condition.length > 500) {
    return { error: 'Condition is required (1–500 characters).' }
  }

  let diagnosisDate: string | null = null
  const rawDate = input.diagnosisDate.trim()
  if (rawDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      return { error: 'Diagnosis date must be a valid date.' }
    }
    const today = new Date().toISOString().slice(0, 10)
    if (rawDate < '1900-01-01' || rawDate > today) {
      return { error: 'Diagnosis date must be between 1900 and today.' }
    }
    diagnosisDate = rawDate
  }

  const notes = input.notes.trim()
  return {
    ok: {
      condition,
      diagnosis_date: diagnosisDate,
      show_on_header: input.showOnHeader,
      notes: notes.length > 0 ? notes : null,
    },
  }
}

/**
 * RLS-gated row lookup. Missing, cross-org, and archived rows all surface
 * identically as not-found — and the human error beats the silent zero-row
 * no-op a blocked UPDATE would otherwise produce.
 */
async function lookupConditionForWrite(
  conditionId: string,
): Promise<{ clientId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const { data: row } = await supabase
    .from('client_medical_history')
    .select('id, client_id')
    .eq('id', conditionId)
    .maybeSingle()

  if (!row) {
    return { error: 'Condition not found in your practice.' }
  }
  return { clientId: row.client_id }
}

export async function createMedicalConditionAction(
  input: MedicalConditionInput & { clientId: string },
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const validated = validateConditionInput(input)
  if ('error' in validated) return { error: validated.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('client_medical_history').insert({
    organization_id: organizationId,
    client_id: input.clientId,
    ...validated.ok,
    is_active: true,
  })

  if (error) {
    return { error: `Could not save condition: ${error.message}` }
  }

  revalidatePath(`/clients/${input.clientId}`)
  return { error: null }
}

export async function updateMedicalConditionAction(
  input: MedicalConditionInput & { conditionId: string; version: number },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const validated = validateConditionInput(input)
  if ('error' in validated) return { error: validated.error }

  const found = await lookupConditionForWrite(input.conditionId)
  if ('error' in found) return { error: found.error }

  // OCC: refuse the write if version moved underneath us. The trigger
  // bumps version on every UPDATE, so the next read will see the new one.
  const supabase = await createSupabaseServerClient()
  const { data: updated, error } = await supabase
    .from('client_medical_history')
    .update(validated.ok)
    .eq('id', input.conditionId)
    .eq('version', input.version)
    .select('id')

  if (error) {
    return { error: `Could not save condition: ${error.message}` }
  }
  if (!updated || updated.length === 0) {
    return {
      error:
        'Someone else edited this condition while you were typing. Reload the page and try again.',
    }
  }

  revalidatePath(`/clients/${found.clientId}`)
  return { error: null }
}

/**
 * "Mark resolved" / "Reactivate". is_active = false keeps the row in the
 * record (Resolved / historical group) — the primary remove verb.
 */
export async function setMedicalConditionActiveAction(
  conditionId: string,
  isActive: boolean,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const found = await lookupConditionForWrite(conditionId)
  if ('error' in found) return { error: found.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('client_medical_history')
    .update({ is_active: isActive })
    .eq('id', conditionId)

  if (error) {
    return { error: `Could not update condition: ${error.message}` }
  }

  revalidatePath(`/clients/${found.clientId}`)
  return { error: null }
}

/**
 * True archive, for conditions entered by mistake. Routes through the
 * SECURITY DEFINER RPC; the row leaves every staff view but stays in the
 * database (audit trail + retention posture).
 */
export async function archiveMedicalConditionAction(
  conditionId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const found = await lookupConditionForWrite(conditionId)
  if ('error' in found) return { error: found.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_client_medical_history', {
    p_id: conditionId,
  })

  if (error) {
    return { error: `Could not archive condition: ${error.message}` }
  }

  revalidatePath(`/clients/${found.clientId}`)
  return { error: null }
}

'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { assertClientLive } from '@/lib/clients/archive-guard'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Medications CRUD (profile rework commit 2). Clone of medical-actions.ts,
 * retargeted at client_medications (migration 20260629140000).
 *
 * Verbs (mirror medical-history):
 *   - "Mark ceased" (is_active = false) is the primary remove verb — it
 *     preserves the row (Ceased group) and avoids the soft-delete trap with a
 *     plain RLS-scoped UPDATE.
 *   - Archive (deleted_at) is for entries created by mistake and routes
 *     through the soft_delete_client_medications SECURITY DEFINER RPC; a bare
 *     UPDATE would 42501 against the SELECT policy's deleted_at IS NULL filter.
 *
 * Concurrency: OCC via the version column (migration 20260702180000 —
 * parity with CN-6's 20260702120000, since client_medications carries the
 * identical last-write-wins property the two-staff beta made a live clobber
 * window). updateMedicationAction includes the last-read version in its
 * UPDATE WHERE clause; a concurrent write matches zero rows and surfaces a
 * conflict, mirroring client_medical_history / clinical_notes. The is_active
 * toggle and archive stay versionless deliberately: both write a single
 * field whose intent is unambiguous, so refusing them on an unrelated
 * concurrent edit would be friction without protection.
 *
 * All writes are staff-only via requireRole + the table's RLS policies
 * (Pattern A staff-only). Validation mirrors the DB CHECK (name 1–200 chars);
 * context_note is a free-text one-liner (no DB length cap — the UI keeps it to
 * one line), stored trimmed or NULL.
 */

export type MedicationInput = {
  name: string
  /** Optional one-line neutral context note. */
  contextNote: string
}

type Validated = {
  name: string
  context_note: string | null
}

function validateMedicationInput(
  input: MedicationInput,
): { ok: Validated } | { error: string } {
  const name = input.name.trim()
  if (name.length < 1 || name.length > 200) {
    return { error: 'Medication name is required (1–200 characters).' }
  }

  const contextNote = input.contextNote.trim()
  return {
    ok: {
      name,
      context_note: contextNote.length > 0 ? contextNote : null,
    },
  }
}

/**
 * RLS-gated row lookup. Missing, cross-org, and archived rows all surface
 * identically as not-found — the human error beats the silent zero-row no-op a
 * blocked UPDATE would otherwise produce.
 */
async function lookupMedicationForWrite(
  medicationId: string,
): Promise<{ clientId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const { data: row } = await supabase
    .from('client_medications')
    .select('id, client_id')
    .eq('id', medicationId)
    .maybeSingle()

  if (!row) {
    return { error: 'Medication not found in your practice.' }
  }

  // CN-7 (P1-4): archived clients are staff-readable since 20260702190000,
  // so the parent's archive state gates every write path — read-only record.
  const live = await assertClientLive(supabase, row.client_id)
  if (live.error) return { error: live.error }

  return { clientId: row.client_id }
}

export async function createMedicationAction(
  input: MedicationInput & { clientId: string },
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const validated = validateMedicationInput(input)
  if ('error' in validated) return { error: validated.error }

  const supabase = await createSupabaseServerClient()

  const live = await assertClientLive(supabase, input.clientId)
  if (live.error) return { error: live.error }

  const { error } = await supabase.from('client_medications').insert({
    organization_id: organizationId,
    client_id: input.clientId,
    ...validated.ok,
    is_active: true,
  })

  if (error) {
    return { error: `Could not save medication: ${error.message}` }
  }

  revalidatePath(`/clients/${input.clientId}`)
  return { error: null }
}

export async function updateMedicationAction(
  input: MedicationInput & { medicationId: string; version: number },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const validated = validateMedicationInput(input)
  if ('error' in validated) return { error: validated.error }

  const found = await lookupMedicationForWrite(input.medicationId)
  if ('error' in found) return { error: found.error }

  // OCC: refuse the write if version moved underneath us. The trigger
  // bumps version on every UPDATE, so the next read will see the new one.
  const supabase = await createSupabaseServerClient()
  const { data: updated, error } = await supabase
    .from('client_medications')
    .update(validated.ok)
    .eq('id', input.medicationId)
    .eq('version', input.version)
    .select('id')

  if (error) {
    return { error: `Could not save medication: ${error.message}` }
  }
  if (!updated || updated.length === 0) {
    return {
      error:
        'Someone else edited this medication while you were typing. Reload the page and try again.',
    }
  }

  revalidatePath(`/clients/${found.clientId}`)
  return { error: null }
}

/**
 * "Mark ceased" / "Reactivate". is_active = false keeps the row in the record
 * (Ceased group) — the primary remove verb.
 */
export async function setMedicationActiveAction(
  medicationId: string,
  isActive: boolean,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const found = await lookupMedicationForWrite(medicationId)
  if ('error' in found) return { error: found.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('client_medications')
    .update({ is_active: isActive })
    .eq('id', medicationId)

  if (error) {
    return { error: `Could not update medication: ${error.message}` }
  }

  revalidatePath(`/clients/${found.clientId}`)
  return { error: null }
}

/**
 * True archive, for medications entered by mistake. Routes through the
 * SECURITY DEFINER RPC; the row leaves every staff view but stays in the
 * database (audit trail + retention posture).
 */
export async function archiveMedicationAction(
  medicationId: string,
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const found = await lookupMedicationForWrite(medicationId)
  if ('error' in found) return { error: found.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.rpc('soft_delete_client_medications', {
    p_id: medicationId,
  })

  if (error) {
    return { error: `Could not archive medication: ${error.message}` }
  }

  revalidatePath(`/clients/${found.clientId}`)
  return { error: null }
}

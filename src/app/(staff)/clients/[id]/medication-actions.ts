'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
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
 * No OCC version column on the table (same as client_medical_history) —
 * edits are last-write-wins, accepted at f&f scale for short structured rows.
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
  return { clientId: row.client_id }
}

export async function createMedicationAction(
  input: MedicationInput & { clientId: string },
): Promise<{ error: string | null }> {
  const { organizationId } = await requireRole(['owner', 'staff'])

  const validated = validateMedicationInput(input)
  if ('error' in validated) return { error: validated.error }

  const supabase = await createSupabaseServerClient()
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
  input: MedicationInput & { medicationId: string },
): Promise<{ error: string | null }> {
  await requireRole(['owner', 'staff'])

  const validated = validateMedicationInput(input)
  if ('error' in validated) return { error: validated.error }

  const found = await lookupMedicationForWrite(input.medicationId)
  if ('error' in found) return { error: found.error }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from('client_medications')
    .update(validated.ok)
    .eq('id', input.medicationId)

  if (error) {
    return { error: `Could not save medication: ${error.message}` }
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

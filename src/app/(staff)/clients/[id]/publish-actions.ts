'use server'

/**
 * Server actions for the testing-module publish flow (Phase D.4).
 *
 * Two actions:
 *   - publishSession: insert a row into client_publications. RLS enforces
 *     organization scope and the published_by = auth.uid() check; the
 *     unique-active partial index enforces "one live publication per
 *     session." A previously soft-deleted publication for the same
 *     session does NOT block a fresh insert — the partial index excludes
 *     deleted rows.
 *   - unpublishPublication: routes through the soft_delete_client_publication
 *     RPC (SECURITY DEFINER, role-gated, audited). Sets deleted_at.
 *
 * Re-publishing semantics (per migration 20260428120700_client_publications):
 *   No updated_at on the table — to change framing text, the EP unpublishes
 *   the existing row then publishes a new one. The audit trail keeps the
 *   full history of publish/unpublish events.
 */

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'

const FRAMING_TEXT_MAX = 280

export type PublishSessionResult =
  | { data: { publicationId: string }; error: null }
  | { data: null; error: string }

export async function publishSessionAction(args: {
  clientId: string
  sessionId: string
  framingText: string | null
}): Promise<PublishSessionResult> {
  if (
    args.framingText !== null &&
    args.framingText.length > FRAMING_TEXT_MAX
  ) {
    return {
      data: null,
      error: `Framing text must be ${FRAMING_TEXT_MAX} characters or fewer.`,
    }
  }

  const { userId, organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const trimmed =
    args.framingText !== null && args.framingText.trim() !== ''
      ? args.framingText.trim()
      : null

  const { data, error } = await supabase
    .from('client_publications')
    .insert({
      organization_id: organizationId,
      test_session_id: args.sessionId,
      published_by: userId,
      framing_text: trimmed,
    })
    .select('id')
    .single()

  if (error) {
    // Unique-active index violation surfaces as 23505 — translate to a
    // plain-English message the form can render.
    if (error.code === '23505') {
      return {
        data: null,
        error:
          'This session already has a live publication. Unpublish it first to change the framing.',
      }
    }
    return { data: null, error: `Publish failed: ${error.message}` }
  }

  // Refresh the staff client page so the publish tab + dashboard
  // attention panel both pick up the new state.
  revalidatePath(`/clients/${args.clientId}`)

  return { data: { publicationId: data.id }, error: null }
}

export type UnpublishPublicationResult =
  | { data: { ok: true }; error: null }
  | { data: null; error: string }

export async function unpublishPublicationAction(args: {
  clientId: string
  publicationId: string
}): Promise<UnpublishPublicationResult> {
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.rpc('soft_delete_client_publication', {
    p_id: args.publicationId,
  })

  if (error) {
    return { data: null, error: `Unpublish failed: ${error.message}` }
  }

  revalidatePath(`/clients/${args.clientId}`)
  return { data: { ok: true }, error: null }
}

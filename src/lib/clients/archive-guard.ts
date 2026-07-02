import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

/**
 * CN-7 P1-4 — the archived-record write guard.
 *
 * Since migration 20260702190000, staff sessions CAN read archived clients
 * (the additive "staff select archived clients in own org" policy, brief
 * §7.2) — which means RLS-gated lookups in server actions no longer filter
 * archived rows out as not-found. Archived records are read-only at the
 * application layer: every client-scoped mutating action calls this guard
 * (or applies an explicit `.is('deleted_at', null)` to its write chain)
 * before writing.
 *
 * Deliberate scope (docs/polish/archived-client-access.md P1-4): the guard
 * is app-layer, not RLS — rewriting every child-table policy for
 * parent-archive state is out of proportion at f&f scope. The named
 * residual (a raw PostgREST write by a staff credential bypassing the
 * actions) is accepted; the DB-level upgrade path if ever needed is a
 * BEFORE UPDATE trigger at the paying-client era.
 */
export const ARCHIVED_CLIENT_MESSAGE =
  'This client is archived — their record is read-only. Restore the client to make changes.'

export async function assertClientLive(
  supabase: SupabaseClient<Database>,
  clientId: string,
): Promise<{ error: string | null }> {
  const { data: row } = await supabase
    .from('clients')
    .select('id, deleted_at')
    .eq('id', clientId)
    .maybeSingle()

  if (!row) {
    return { error: 'Client not found in your practice.' }
  }
  if (row.deleted_at) {
    return { error: ARCHIVED_CLIENT_MESSAGE }
  }
  return { error: null }
}

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ClientsList, type ClientRow } from './_components/ClientsList'

export const dynamic = 'force-dynamic'

/**
 * 02 Clientele — list view.
 *
 * Auth is handled by the (staff) layout. RLS scopes the query to the
 * caller's organization automatically (policies in migrations).
 */
export default async function ClientsPage() {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('clients')
    .select(
      `id, first_name, last_name, email, user_id, invited_at,
       onboarded_at, archived_at, created_at,
       category:client_categories(name)`,
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load clients: ${error.message}`)
  }

  const clients: ClientRow[] = (data ?? []).map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    email: c.email,
    user_id: c.user_id,
    invited_at: c.invited_at,
    onboarded_at: c.onboarded_at,
    archived_at: c.archived_at,
    category_name: c.category?.name ?? null,
  }))

  const total = clients.length
  const newCount = clients.filter((c) => !c.onboarded_at).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {total === 0
              ? 'No clients yet'
              : `${total} ${total === 1 ? 'client' : 'clients'}${
                  newCount > 0 ? ` · ${newCount} awaiting onboarding` : ''
                }`}
          </div>
          <h1>Clientele</h1>
          <div className="sub">
            Search, invite, and open client profiles.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn outline" disabled>
            Export
          </button>
          <button type="button" className="btn primary" disabled>
            New client
          </button>
        </div>
      </div>

      <ClientsList clients={clients} />
    </div>
  )
}

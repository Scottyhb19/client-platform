import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ClientsList, type ClientRow } from './_components/ClientsList'
import { categoryToneFor } from './_lib/client-helpers'

export const dynamic = 'force-dynamic'

/**
 * 02 Clientele — list view.
 *
 * Auth is handled by the (staff) layout. RLS scopes the query to the
 * caller's organization automatically (policies in migrations).
 */
export default async function ClientsPage() {
  const supabase = await createSupabaseServerClient()

  // CN-7: deliberately archived-INCLUSIVE — this list and the profile are
  // the two staff surfaces that read archived rows (the "Archived" filter
  // chip reveals them; the default view stays live-only in ClientsList).
  // Every other staff surface keeps an explicit live-only filter (P0-2).
  const [{ data, error }, { data: categoryRows }] = await Promise.all([
    supabase
      .from('clients')
      .select(
        `id, first_name, last_name, email, user_id, invited_at,
         onboarded_at, archived_at, created_at, category_id,
         category:client_categories(name)`,
      )
      .order('created_at', { ascending: false }),
    // Category order drives the avatar tone (categoryToneFor) — same
    // ordering as the Settings editor and the profile's CN-5 picker.
    supabase
      .from('client_categories')
      .select('id')
      .is('deleted_at', null)
      .order('sort_order'),
  ])

  if (error) {
    throw new Error(`Failed to load clients: ${error.message}`)
  }

  const categoryIds = (categoryRows ?? []).map((c) => c.id)

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
    tone: categoryToneFor(c.category_id, categoryIds),
  }))

  // Header counts describe the working (live) caseload — archived rows are
  // reachable via the filter chip but never inflate the numbers.
  const live = clients.filter((c) => !c.archived_at)
  const total = live.length
  const newCount = live.filter((c) => !c.onboarded_at).length

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
          <Link href="/clients/new" className="btn primary">
            New client
          </Link>
        </div>
      </div>

      <ClientsList clients={clients} />
    </div>
  )
}

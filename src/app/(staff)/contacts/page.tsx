import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ContactsList, type ContactRow } from './_components/ContactsList'
import {
  CONTACT_GROUPS,
  groupLabel,
  isContactGroup,
} from './_lib/groups'

export const dynamic = 'force-dynamic'

export default async function ContactsPage() {
  return await renderContactsPage(null)
}

export async function renderContactsPage(groupKey: string | null) {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('contacts')
    .select('id, name, practice, phone, email, contact_group, tags, notes')
    .is('deleted_at', null)
    .order('name')

  if (error) throw new Error(`Load contacts: ${error.message}`)

  const contacts: ContactRow[] = (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    practice: c.practice,
    phone: c.phone,
    email: c.email,
    contact_group: c.contact_group,
    tags: c.tags ?? [],
    notes: c.notes,
  }))

  const initialGroup =
    groupKey && isContactGroup(groupKey) ? groupKey : 'all'

  const total = contacts.length
  const disciplineCount = new Set(contacts.map((c) => c.contact_group)).size

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Referral network</div>
          <h1>{initialGroup === 'all' ? 'Contacts' : groupLabel(initialGroup)}</h1>
          <div className="sub">
            {total === 0
              ? 'No referrers yet'
              : initialGroup === 'all'
                ? `${total} ${total === 1 ? 'referrer' : 'referrers'} across ${disciplineCount} discipline${disciplineCount === 1 ? '' : 's'}`
                : `${contacts.filter((c) => c.contact_group === initialGroup).length} ${groupLabel(initialGroup).toLowerCase()}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn outline" disabled>
            Export
          </button>
          <Link href="/contacts/new" className="btn primary">
            <Plus size={14} aria-hidden />
            Add contact
          </Link>
        </div>
      </div>

      <ContactsList contacts={contacts} initialGroup={initialGroup} />

      {/* Hidden — just keeps the discipline labels reachable via dependency
          tree so they stay in sync when CONTACT_GROUPS is edited. */}
      <span style={{ display: 'none' }}>
        {CONTACT_GROUPS.map((g) => g.key).join(',')}
      </span>
    </div>
  )
}

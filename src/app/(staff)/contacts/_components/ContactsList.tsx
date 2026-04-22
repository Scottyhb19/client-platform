'use client'

import { useMemo, useState } from 'react'
import { Mail, MoreHorizontal, Phone, Search } from 'lucide-react'
import {
  CONTACT_GROUPS,
  contactInitials,
  groupLabel,
  type ContactGroup,
} from '../_lib/groups'

export type ContactRow = {
  id: string
  name: string
  practice: string | null
  phone: string | null
  email: string | null
  contact_group: string
  tags: string[]
  notes: string | null
}

interface ContactsListProps {
  contacts: ContactRow[]
  initialGroup: ContactGroup | 'all'
}

export function ContactsList({
  contacts,
  initialGroup,
}: ContactsListProps) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<ContactGroup | 'all'>(initialGroup)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return contacts.filter((c) => {
      if (group !== 'all' && c.contact_group !== group) return false
      if (!q) return true
      const haystack = [
        c.name,
        c.practice ?? '',
        c.tags.join(' '),
        c.email ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [contacts, query, group])

  // Group the filtered rows by discipline for the "All" view.
  const grouped = useMemo(() => {
    const m = new Map<string, ContactRow[]>()
    for (const c of filtered) {
      const key = c.contact_group
      const list = m.get(key) ?? []
      list.push(c)
      m.set(key, list)
    }
    return m
  }, [filtered])

  return (
    <>
      {/* Search + chips */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 18,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 280, position: 'relative' }}>
          <Search
            size={16}
            aria-hidden
            style={{
              position: 'absolute',
              left: 12,
              top: 10,
              color: 'var(--color-muted)',
            }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, practice or tag…"
            aria-label="Search contacts"
            style={{
              width: '100%',
              height: 36,
              padding: '0 12px 0 36px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 7,
              background: '#fff',
              fontFamily: 'var(--font-sans)',
              fontSize: '.86rem',
              outline: 'none',
              color: 'var(--color-text)',
            }}
          />
        </div>
        <button
          type="button"
          className={`chip ${group === 'all' ? 'on' : ''}`}
          onClick={() => setGroup('all')}
        >
          All
        </button>
        {CONTACT_GROUPS.filter((g) => g.key !== 'other').map((g) => (
          <button
            key={g.key}
            type="button"
            className={`chip ${group === g.key ? 'on' : ''}`}
            onClick={() => setGroup(group === g.key ? 'all' : g.key)}
          >
            {g.short}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        contacts.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            className="card"
            style={{
              padding: 40,
              textAlign: 'center',
              color: 'var(--color-text-light)',
            }}
          >
            No contacts match your filters.
          </div>
        )
      ) : group === 'all' ? (
        // Group headers + cards
        CONTACT_GROUPS.map((g) => {
          const items = grouped.get(g.key)
          if (!items || items.length === 0) return null
          return (
            <div key={g.key} style={{ marginBottom: 22 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '.84rem',
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: 'var(--color-primary)',
                  }}
                >
                  {g.label}
                </div>
                <div
                  style={{
                    fontSize: '.7rem',
                    color: 'var(--color-muted)',
                  }}
                >
                  {items.length}
                </div>
              </div>
              <ContactCardGrid items={items} />
            </div>
          )
        })
      ) : (
        <ContactCardGrid items={filtered} />
      )}
    </>
  )
}

function ContactCardGrid({ items }: { items: ContactRow[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 12,
      }}
    >
      {items.map((c) => (
        <ContactCard key={c.id} contact={c} />
      ))}
    </div>
  )
}

function ContactCard({ contact: c }: { contact: ContactRow }) {
  const initials = contactInitials(c.name)
  return (
    <article className="card" style={{ padding: '16px 20px' }}>
      <div
        style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}
      >
        <span
          className="avatar n"
          style={{ width: 40, height: 40, fontSize: 40 * 0.38 }}
        >
          {initials}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 10,
            }}
          >
            <div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '.92rem',
                  color: 'var(--color-charcoal)',
                }}
              >
                {c.name}
              </div>
              <div
                style={{
                  fontSize: '.74rem',
                  color: 'var(--color-muted)',
                  marginTop: 1,
                }}
              >
                {c.practice ?? groupLabel(c.contact_group)}
              </div>
            </div>
            <MoreHorizontal
              size={16}
              aria-hidden
              style={{
                color: 'var(--color-muted)',
                flexShrink: 0,
              }}
            />
          </div>

          {(c.phone || c.email) && (
            <div
              style={{
                display: 'flex',
                gap: 14,
                marginTop: 10,
                fontSize: '.78rem',
                color: 'var(--color-text)',
                flexWrap: 'wrap',
              }}
            >
              {c.phone && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Phone
                    size={12}
                    aria-hidden
                    style={{ color: 'var(--color-muted)' }}
                  />
                  {c.phone}
                </span>
              )}
              {c.email && (
                <a
                  href={`mailto:${c.email}`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    color: 'var(--color-text)',
                    textDecoration: 'none',
                  }}
                >
                  <Mail
                    size={12}
                    aria-hidden
                    style={{ color: 'var(--color-muted)' }}
                  />
                  {c.email}
                </a>
              )}
            </div>
          )}

          {c.tags.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
                marginTop: 10,
              }}
            >
              {c.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: '.64rem',
                    fontWeight: 600,
                    color: 'var(--color-text-light)',
                    background: '#F5F0EA',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {c.notes && (
            <div
              style={{
                marginTop: 10,
                fontSize: '.78rem',
                color: 'var(--color-text-light)',
                lineHeight: 1.5,
                fontStyle: 'italic',
              }}
            >
              {c.notes}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function EmptyState() {
  return (
    <div
      className="card"
      style={{
        padding: '44px 28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.2rem',
          color: 'var(--color-charcoal)',
          marginBottom: 6,
        }}
      >
        Your referral network is empty
      </div>
      <p
        style={{
          fontSize: '.9rem',
          margin: '0 auto',
          lineHeight: 1.6,
          maxWidth: 440,
        }}
      >
        Add GPs, surgeons, physios and peers so their details are one click
        away — and referrals can be linked to client profiles later.
      </p>
    </div>
  )
}

'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Search } from 'lucide-react'
import {
  initialsFor,
  toneFor,
  statusFor,
  type ClientStatus,
} from '../_lib/client-helpers'

export type ClientRow = {
  id: string
  first_name: string
  last_name: string
  email: string
  user_id: string | null
  invited_at: string | null
  onboarded_at: string | null
  archived_at: string | null
  category_name: string | null
}

type Filter = 'all' | 'active' | 'invited'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'invited', label: 'New' },
]

interface ClientsListProps {
  clients: ClientRow[]
}

export function ClientsList({ clients }: ClientsListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients.filter((c) => {
      const status = statusFor(c)
      if (filter === 'active' && status !== 'active') return false
      if (filter === 'invited' && status !== 'invited') return false
      if (!q) return true
      const haystack = [
        c.first_name,
        c.last_name,
        c.email,
        c.category_name ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [clients, query, filter])

  return (
    <>
      {/* Search + chips */}
      <div style={{ marginBottom: 14, position: 'relative' }}>
        <Search
          size={16}
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            top: 11,
            color: 'var(--color-muted)',
          }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or category…"
          aria-label="Search clients"
          style={{
            width: '100%',
            height: 38,
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

      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          marginBottom: 20,
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`chip ${filter === f.key ? 'on' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <EmptyState hasAnyClients={clients.length > 0} filter={filter} />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {filtered.map((c, i) => (
            <ClientRowCard
              key={c.id}
              client={c}
              isLast={i === filtered.length - 1}
            />
          ))}
        </div>
      )}
    </>
  )
}

function ClientRowCard({
  client,
  isLast,
}: {
  client: ClientRow
  isLast: boolean
}) {
  const [hovered, setHovered] = useState(false)
  const status = statusFor(client)
  const subtitle = client.category_name ?? client.email

  return (
    <Link
      href={`/clients/${client.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 16,
        alignItems: 'center',
        padding: '14px 20px',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
        background: hovered ? '#F5F0EA' : 'transparent',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      <span
        className={`avatar ${toneFor(client.id)}`}
        style={{ width: 36, height: 36, fontSize: 36 * 0.38 }}
      >
        {initialsFor(client.first_name, client.last_name)}
      </span>
      <div>
        <div style={{ fontWeight: 600, fontSize: '.92rem' }}>
          {client.first_name} {client.last_name}
        </div>
        <div
          style={{
            fontSize: '.72rem',
            color: 'var(--color-muted)',
            marginTop: 1,
          }}
        >
          {subtitle}
        </div>
      </div>
      <StatusTag status={status} />
      <ChevronRight
        size={18}
        aria-hidden
        style={{ color: 'var(--color-muted)' }}
      />
    </Link>
  )
}

function StatusTag({ status }: { status: ClientStatus }) {
  if (status === 'active') return <span className="tag active">Active</span>
  if (status === 'invited') return <span className="tag new">New</span>
  return (
    <span className="tag" style={{ color: 'var(--color-muted)' }}>
      Archived
    </span>
  )
}

function EmptyState({
  hasAnyClients,
  filter,
}: {
  hasAnyClients: boolean
  filter: Filter
}) {
  if (!hasAnyClients) {
    return (
      <div
        className="card"
        style={{
          padding: '40px 28px',
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
          No clients yet
        </div>
        <p
          style={{
            fontSize: '.9rem',
            margin: '0 auto 18px',
            lineHeight: 1.6,
            maxWidth: 380,
          }}
        >
          Invite your first client to get started. They&rsquo;ll receive an
          email with a link to set up their portal account.
        </p>
        <Link href="/clients/new" className="btn primary">
          <Plus size={14} aria-hidden />
          Invite your first client
        </Link>
      </div>
    )
  }

  return (
    <div
      className="card"
      style={{
        padding: '28px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
        fontSize: '.88rem',
      }}
    >
      No clients match the {filter === 'active' ? 'Active' : 'New'} filter.
    </div>
  )
}

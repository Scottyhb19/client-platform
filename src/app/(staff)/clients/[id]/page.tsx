import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  initialsFor,
  toneFor,
  statusFor,
} from '../_lib/client-helpers'

export const dynamic = 'force-dynamic'

/**
 * 02b Client Profile — placeholder header.
 *
 * The profile tabs (Profile / Program / Reports / Bookings / Comms) come
 * in the next commit. This stub at least gives the list rows a live
 * destination with the correct client header chrome.
 */
export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createSupabaseServerClient()
  const { data: client, error } = await supabase
    .from('clients')
    .select(
      `id, first_name, last_name, email, phone, dob, user_id,
       invited_at, onboarded_at, archived_at,
       category:client_categories(name)`,
    )
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw new Error(`Failed to load client: ${error.message}`)
  if (!client) notFound()

  const status = statusFor(client)

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 6,
        }}
      >
        <Link
          href="/clients"
          aria-label="Back to clientele"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-light)',
            padding: 6,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <span
          className={`avatar ${toneFor(client.id)}`}
          style={{ width: 52, height: 52, fontSize: 52 * 0.38 }}
        >
          {initialsFor(client.first_name, client.last_name)}
        </span>
        <div style={{ flex: 1 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            {client.category?.name ?? 'No category'}
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.9rem',
              margin: 0,
              letterSpacing: '-.01em',
            }}
          >
            {client.first_name} {client.last_name}
          </h1>
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 4,
              alignItems: 'center',
            }}
          >
            <span className={`tag ${status === 'active' ? 'active' : 'new'}`}>
              {status === 'active' ? 'Active' : status === 'invited' ? 'New' : 'Archived'}
            </span>
            <span style={{ fontSize: '.78rem', color: 'var(--color-text-light)' }}>
              {client.email}
            </span>
          </div>
        </div>
      </div>

      <section
        className="card"
        style={{ padding: '24px 28px', marginTop: 28, maxWidth: 640 }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1.2rem',
            margin: 0,
            color: 'var(--color-charcoal)',
          }}
        >
          Profile tabs coming next
        </h2>
        <p
          style={{
            fontSize: '.9rem',
            lineHeight: 1.6,
            color: 'var(--color-text-light)',
            marginTop: 8,
          }}
        >
          Profile · Program · Reports · Bookings · Comms tabs land in the next
          commit, with real personal + clinical details, clinical notes, and
          the program snapshot.
        </p>
      </section>
    </div>
  )
}

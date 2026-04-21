import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { InviteClientForm } from './_components/InviteClientForm'

export const dynamic = 'force-dynamic'

export default async function NewClientPage() {
  const supabase = await createSupabaseServerClient()
  const { data: categories } = await supabase
    .from('client_categories')
    .select('id, name')
    .is('deleted_at', null)
    .order('sort_order')

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 6,
        }}
      >
        <Link
          href="/clients"
          aria-label="Back to clientele"
          style={{
            color: 'var(--color-text-light)',
            padding: 6,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <div>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            02 Clientele · New
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '2.2rem',
              margin: 0,
              letterSpacing: '-.01em',
              color: 'var(--color-charcoal)',
            }}
          >
            Invite a client
          </h1>
        </div>
      </div>

      <p
        style={{
          fontSize: '.9rem',
          color: 'var(--color-text-light)',
          maxWidth: 560,
          marginTop: 14,
          marginBottom: 24,
          lineHeight: 1.55,
        }}
      >
        Add a new client to your practice. They&rsquo;ll receive an email with
        a one-time link to set a password and access their portal.
      </p>

      <InviteClientForm categories={categories ?? []} />
    </div>
  )
}

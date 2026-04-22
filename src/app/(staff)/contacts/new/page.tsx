import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { NewContactForm } from './_components/NewContactForm'
import { isContactGroup } from '../_lib/groups'

export const dynamic = 'force-dynamic'

export default async function NewContactPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string }>
}) {
  const { group } = await searchParams
  const defaultGroup =
    group && isContactGroup(group) ? group : undefined

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
          href="/contacts"
          aria-label="Back to contacts"
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
            04 Contacts · New
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
            Add a contact
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
        Build your referral network so a GP&rsquo;s phone is one click away and
        cross-disciplinary notes live in one place.
      </p>

      <NewContactForm defaultGroup={defaultGroup} />
    </div>
  )
}

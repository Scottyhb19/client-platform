import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function PortalSessionPage({
  params,
}: {
  params: Promise<{ dayId: string }>
}) {
  await params // dayId used when the logger lands.
  return (
    <>
      <div
        style={{
          padding: '18px 20px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Link
          href="/portal"
          aria-label="Back to today"
          style={{
            color: 'var(--color-text-light)',
            padding: 6,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: 0,
          }}
        >
          In-session logger
        </h1>
      </div>
      <div
        style={{
          margin: '0 16px 16px',
          background: '#fff',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '32px 20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-charcoal)',
            marginBottom: 6,
          }}
        >
          Logger lands next
        </div>
        <p
          style={{
            fontSize: '.86rem',
            lineHeight: 1.5,
            color: 'var(--color-text-light)',
            margin: 0,
          }}
        >
          Per-set Reps / Load / RPE inputs, progress bar, rest timer, and the
          completion screen with subjective feedback wire up in the next
          commit.
        </p>
      </div>
    </>
  )
}

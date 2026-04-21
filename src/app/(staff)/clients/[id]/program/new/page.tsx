import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

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
          href={`/clients/${id}/program`}
          aria-label="Back to program calendar"
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
            08 Program · New
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
            Start a mesocycle
          </h1>
        </div>
      </div>

      <section
        className="card"
        style={{ padding: '24px 28px', marginTop: 20, maxWidth: 640 }}
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
          Program engine lands next session
        </h2>
        <p
          style={{
            fontSize: '.9rem',
            lineHeight: 1.6,
            color: 'var(--color-text-light)',
            marginTop: 8,
          }}
        >
          The mesocycle creator (name, duration, day split, start date, optional
          template) ships alongside the Session Builder — the two are tightly
          coupled and benefit from being built together.
        </p>
      </section>
    </div>
  )
}

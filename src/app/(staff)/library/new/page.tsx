import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export default function NewExercisePage() {
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
          href="/library"
          aria-label="Back to exercise library"
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
            05 Exercise Library · New
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
            Create exercise
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
          Form lands in the next commit
        </h2>
        <p
          style={{
            fontSize: '.9rem',
            lineHeight: 1.6,
            color: 'var(--color-text-light)',
            marginTop: 8,
          }}
        >
          Name, movement pattern, default sets/reps/load/RPE, tags, YouTube
          video URL, description, and coaching cues. Shipping shortly.
        </p>
      </section>
    </div>
  )
}

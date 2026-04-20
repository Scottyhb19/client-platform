/**
 * Shared placeholder for staff modules not yet implemented.
 * Replaces itself with the real page when each module is built.
 */

interface PlaceholderPageProps {
  eyebrow: string
  title: string
  description: string
  children?: React.ReactNode
}

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  children,
}: PlaceholderPageProps) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <div className="sub">{description}</div>
        </div>
      </div>

      <section className="card" style={{ padding: '24px 28px', maxWidth: 640 }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1.2rem',
            margin: 0,
            color: 'var(--color-charcoal)',
          }}
        >
          Coming next
        </h2>
        <p
          style={{
            fontSize: '0.9rem',
            lineHeight: 1.6,
            color: 'var(--color-text-light)',
            marginTop: 8,
          }}
        >
          This module is scaffolded as part of the staff shell. The real screen
          will be built in the order set by <code>CLAUDE.md</code>.
        </p>
        {children && <div style={{ marginTop: 16 }}>{children}</div>}
      </section>
    </div>
  )
}

export function PortalTop({
  title,
  greeting,
}: {
  title: string
  greeting?: string
}) {
  return (
    <div style={{ padding: '18px 20px 16px' }}>
      {greeting && (
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
          }}
        >
          {greeting}
        </div>
      )}
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: greeting ? '1.5rem' : '1.4rem',
          margin: greeting ? '2px 0 0' : 0,
          letterSpacing: '-.01em',
          lineHeight: 1.1,
        }}
      >
        {title}
      </h1>
    </div>
  )
}

export function PortalEmpty({
  title,
  message,
}: {
  title: string
  message: string
}) {
  return (
    <div
      style={{
        margin: '0 16px 16px',
        background: '#fff',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 14,
        padding: '32px 20px',
        textAlign: 'center',
        color: 'var(--color-text-light)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1.05rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: '.86rem', lineHeight: 1.5 }}>{message}</div>
    </div>
  )
}

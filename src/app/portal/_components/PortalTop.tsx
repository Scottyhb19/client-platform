export function PortalTop({
  title,
  greeting,
}: {
  title: string
  greeting?: string
}) {
  return (
    <div style={{ padding: '18px 20px 16px' }}>
      {greeting && <div className="portal-eyebrow">{greeting}</div>}
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
    <div className="portal-empty">
      <div className="portal-empty__title">{title}</div>
      <div className="portal-empty__body">{message}</div>
    </div>
  )
}

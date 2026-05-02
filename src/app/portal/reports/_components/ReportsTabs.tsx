import Link from 'next/link'

type ActiveTab = 'data' | 'files'

interface Props {
  active: ActiveTab
}

const TABS: ReadonlyArray<{ key: ActiveTab; label: string; href: string }> = [
  { key: 'data', label: 'Your data', href: '/portal/reports' },
  { key: 'files', label: 'Files', href: '/portal/reports?tab=files' },
]

export function ReportsTabs({ active }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Reports view"
      style={{
        display: 'flex',
        gap: 4,
        padding: '0 16px 12px',
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.78rem',
              letterSpacing: '.02em',
              textDecoration: 'none',
              color: isActive ? '#fff' : 'var(--color-muted)',
              background: isActive
                ? 'var(--color-charcoal)'
                : 'var(--color-surface)',
              border: `1px solid ${
                isActive ? 'var(--color-charcoal)' : 'var(--color-border-subtle)'
              }`,
              transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

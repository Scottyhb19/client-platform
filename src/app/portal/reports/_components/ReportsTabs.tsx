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
            className={`portal-tab${isActive ? ' is-active' : ''}`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart2, Calendar, Clock, Home, User } from 'lucide-react'

const ITEMS = [
  { key: 'today', label: 'Today', href: '/portal', icon: Home },
  { key: 'program', label: 'Program', href: '/portal/program', icon: Calendar },
  {
    key: 'reports',
    label: 'Reports',
    href: '/portal/reports',
    icon: BarChart2,
  },
  { key: 'book', label: 'Book', href: '/portal/book', icon: Clock },
  { key: 'you', label: 'You', href: '/portal/you', icon: User },
]

export function BottomNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Portal"
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        background: '#fff',
        borderTop: '1px solid #E2DDD7',
        paddingBottom: 'env(safe-area-inset-bottom, 14px)',
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        zIndex: 10,
      }}
    >
      {ITEMS.map((item) => {
        const isActive =
          item.href === '/portal'
            ? pathname === '/portal'
            : pathname === item.href ||
              pathname.startsWith(item.href + '/')
        const Icon = item.icon
        return (
          <Link
            key={item.key}
            href={item.href}
            style={{
              padding: '10px 4px 8px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              textDecoration: 'none',
              color: isActive
                ? 'var(--color-primary)'
                : 'var(--color-muted)',
            }}
          >
            <Icon
              size={20}
              aria-hidden
              strokeWidth={isActive ? 2.25 : 1.75}
            />
            <span
              style={{
                fontSize: '.62rem',
                fontWeight: isActive ? 700 : 500,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {item.label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}

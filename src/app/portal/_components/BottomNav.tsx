'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { BarChart2, Calendar, Clock, Home, MessageCircle, User } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

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
  {
    key: 'messages',
    label: 'Messages',
    href: '/portal/messages',
    icon: MessageCircle,
  },
  { key: 'you', label: 'You', href: '/portal/you', icon: User },
]

interface BottomNavProps {
  messageCount?: number
  threadId?: string | null
}

export function BottomNav({ messageCount = 0, threadId = null }: BottomNavProps) {
  const pathname = usePathname()
  const router = useRouter()

  // Live-refresh the unread badge. messageCount is server-rendered by the
  // portal layout; router.refresh() re-runs the count query whenever a
  // message changes (new staff reply → count up, read_at flip → count down).
  // The thread_id filter mirrors the working ClientThread subscription —
  // postgres_changes can silently drop events without a filter.
  useEffect(() => {
    if (!threadId) return
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`portal-bottomnav:${threadId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        } as never,
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [threadId, router])

  // Phones suspend WebSockets when the screen sleeps or the PWA is
  // backgrounded — events that fire during that window are dropped on
  // reconnect. Resync the count whenever the tab/PWA becomes visible.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [router])

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
        gridTemplateColumns: 'repeat(6, 1fr)',
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
        const showBadge = item.key === 'messages' && messageCount > 0
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-label={
              showBadge ? `${item.label} (${messageCount} unread)` : item.label
            }
            style={{
              position: 'relative',
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
            {showBadge && (
              <span aria-hidden className="portal-nav-badge">
                {messageCount > 9 ? '9+' : messageCount}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}

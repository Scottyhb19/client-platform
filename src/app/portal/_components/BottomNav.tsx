'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'
import { BarChart2, Clock, Home, MessageCircle, User } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  getServerSessionTheme,
  getSessionTheme,
  subscribeSessionTheme,
} from '../_lib/session-theme'

const ITEMS = [
  { key: 'today', label: 'Today', href: '/portal', icon: Home },
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

  // Match the persistent nav to the in-session screen theme while on a
  // session route (section 7 / P1-1) — dark nav under the dark logger,
  // light nav everywhere else. Reads the same store the session screen uses,
  // so a theme toggle is reflected on the nav too.
  const sessionTheme = useSyncExternalStore(
    subscribeSessionTheme,
    getSessionTheme,
    getServerSessionTheme,
  )
  const navTheme = pathname.startsWith('/portal/session/')
    ? sessionTheme
    : 'light'

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
      className="portal-bottom-nav"
      data-theme={navTheme}
      // Column count is per-instance (5 items since the Program tab was
      // removed — P1-6; the Today week-strip already is the program view).
      style={{ gridTemplateColumns: `repeat(${ITEMS.length}, 1fr)` }}
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
            className={`portal-bottom-nav__item${isActive ? ' is-active' : ''}`}
          >
            <Icon
              size={20}
              aria-hidden
              strokeWidth={isActive ? 2.25 : 1.75}
            />
            <span className="portal-bottom-nav__item-label">{item.label}</span>
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

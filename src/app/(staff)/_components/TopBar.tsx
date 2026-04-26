'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, MessageCircle, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

/**
 * Top bar for the staff platform.
 *
 * Ports .design-ref/project/components/Primitives.jsx → TopBar. Nav items
 * link to real routes via next/link; active state is derived from the current
 * pathname (not local state) so it stays correct across server navigation.
 *
 * Settings is a top-right cog, not a nav item, to match the design.
 */

type NavItem =
  | { kind: 'link'; key: string; label: string; href: string }
  | { kind: 'dropdown'; key: string; label: string; href: string }

// Order matches .design-ref Primitives.jsx TopBar `items` array.
const NAV_ITEMS: NavItem[] = [
  { kind: 'link', key: 'dashboard', label: 'Dashboard', href: '/dashboard' },
  { kind: 'link', key: 'schedule', label: 'Schedule', href: '/schedule' },
  { kind: 'link', key: 'clients', label: 'Clientele', href: '/clients' },
  { kind: 'dropdown', key: 'contacts', label: 'Contacts', href: '/contacts' },
  { kind: 'link', key: 'library', label: 'Exercise Library', href: '/library' },
  { kind: 'link', key: 'analytics', label: 'Analytics', href: '/analytics' },
]

const CONTACT_GROUPS: Array<[string, string]> = [
  ['gps', 'General Practitioners'],
  ['surgeons', 'Surgeons'],
  ['sports-doc', 'Sports Doctors'],
  ['physios', 'Physiotherapists'],
  ['chiros', 'Chiropractors'],
  ['eps', 'Exercise Physiologists'],
]

interface TopBarProps {
  userInitials: string
  todayLabel: string
  messageCount?: number
  organizationId: string
}

export function TopBar({ userInitials, todayLabel, messageCount = 0, organizationId }: TopBarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [contactsOpen, setContactsOpen] = useState(false)
  const contactsRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on route change or outside click.
  useEffect(() => {
    setContactsOpen(false)
  }, [pathname])

  // Live-refresh the unread badge. messageCount is server-rendered by the
  // staff layout, so router.refresh() re-runs the count query. We listen for
  // any messages event in this org (new client message → count up, read_at
  // flip → count down). RLS already gates which rows reach this subscriber.
  useEffect(() => {
    if (!organizationId) return
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`topbar-msgs:${organizationId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `organization_id=eq.${organizationId}`,
        } as never,
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [organizationId, router])

  useEffect(() => {
    if (!contactsOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (contactsRef.current && !contactsRef.current.contains(e.target as Node)) {
        setContactsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [contactsOpen])

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')
  const isContactsActive = pathname === '/contacts' || pathname.startsWith('/contacts/')
  const isSettingsActive = pathname === '/settings' || pathname.startsWith('/settings/')

  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <Link href="/dashboard" className="brand" style={{ textDecoration: 'none' }}>
          Odyssey<span className="dot">.</span>
        </Link>
        <nav className="topnav">
          {NAV_ITEMS.map((item) => {
            if (item.kind === 'link') {
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={isActive(item.href) ? 'active' : ''}
                >
                  {item.label}
                </Link>
              )
            }
            // Contacts dropdown, rendered in-place to preserve nav order.
            return (
              <div
                key={item.key}
                ref={contactsRef}
                style={{ position: 'relative' }}
                onMouseEnter={() => setContactsOpen(true)}
                onMouseLeave={() => setContactsOpen(false)}
              >
                <Link
                  href={item.href}
                  className={isContactsActive ? 'active' : ''}
                  onClick={() => setContactsOpen(false)}
                >
                  {item.label}
                  <ChevronDown size={12} aria-hidden />
                </Link>
                {contactsOpen && (
                  <div className="topnav-menu" role="menu">
                    <Link
                      href="/contacts"
                      className="topnav-menu__header"
                      onClick={() => setContactsOpen(false)}
                    >
                      All contacts
                    </Link>
                    <div className="topnav-menu__divider" />
                    {CONTACT_GROUPS.map(([slug, label]) => (
                      <Link
                        key={slug}
                        href={`/contacts/${slug}`}
                        className={`topnav-menu__item ${pathname === `/contacts/${slug}` ? 'active' : ''}`}
                        onClick={() => setContactsOpen(false)}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </div>

      <div className="topright">
        <span className="today-pill">{todayLabel}</span>
        <Link
          href="/messages"
          className={`bell ${pathname === '/messages' || pathname.startsWith('/messages/') ? 'active' : ''}`}
          title="Messages"
          aria-label={messageCount > 0 ? `Messages (${messageCount} unread)` : 'Messages'}
        >
          <MessageCircle size={16} aria-hidden />
          {messageCount > 0 && <span className="count">{messageCount}</span>}
        </Link>
        <Link
          href="/settings"
          className={`bell ${isSettingsActive ? 'active' : ''}`}
          title="Settings"
          aria-label="Settings"
        >
          <Settings size={16} aria-hidden />
        </Link>
        <span
          className="avatar g"
          style={{ width: 30, height: 30, fontSize: 30 * 0.38 }}
          aria-label="Signed-in user"
        >
          {userInitials}
        </span>
      </div>
    </div>
  )
}

import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { TopBar } from './_components/TopBar'

/**
 * Staff platform shell.
 *
 * This is a route-group layout — the `(staff)` segment is stripped from the
 * URL, so the pages inside still live at /dashboard, /clients, /schedule, etc.
 * Running the auth guard here means every staff page is gated uniformly —
 * adding a new page under (staff)/ inherits the guard for free.
 *
 * RLS is the real security boundary; this guard is a UX fence.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, email, organizationId } = await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()

  const [{ data: profile }, { data: org }, unreadCountResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('timezone')
      .eq('id', organizationId)
      .maybeSingle(),
    // Unread client→staff messages across the whole org. RLS already scopes;
    // the index messages_org_unread_idx covers this lookup.
    supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_role', 'client')
      .is('read_at', null)
      .is('deleted_at', null),
  ])

  const initials = computeInitials(profile?.first_name, profile?.last_name, email)
  const todayLabel = formatToday(org?.timezone ?? 'Australia/Sydney')
  const messageCount = unreadCountResult.count ?? 0

  return (
    <>
      <TopBar
        userInitials={initials}
        todayLabel={todayLabel}
        messageCount={messageCount}
        organizationId={organizationId}
      />
      <div className="flex-1">{children}</div>
    </>
  )
}

function computeInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string,
): string {
  const f = (firstName ?? '').trim()
  const l = (lastName ?? '').trim()
  if (f && l) return (f[0] + l[0]).toUpperCase()
  if (f) return f.slice(0, 2).toUpperCase()
  return email.slice(0, 2).toUpperCase()
}

function formatToday(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone,
    }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(new Date())
  }
}

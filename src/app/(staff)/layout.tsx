import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { TopBar } from './_components/TopBar'
import { NoticeHost } from './_components/Notice'

/**
 * Staff platform shell.
 *
 * This is a route-group layout — the `(staff)` segment is stripped from the
 * URL, so the pages inside still live at /dashboard, /clients, /schedule, etc.
 * Running the auth guard here means every staff page is gated uniformly —
 * adding a new page under (staff)/ inherits the guard for free.
 *
 * RLS is the real security boundary; this guard is a UX fence.
 *
 * G-15 REGISTRATION RULE: a NEW top-level route under (staff)/ must ALSO be
 * added to the isProtected prefix list in src/lib/supabase/middleware.ts, or
 * a logged-out deep link to it silently lands on /dashboard after login
 * instead of returning to the page (the middleware sets ?next=; requireRole
 * here deliberately does not).
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
    // the index messages_org_unread_idx covers this lookup. !inner on
    // message_threads drops messages sitting in archived threads: archiving a
    // client archives the thread (client_cascade_thread_archive) but leaves
    // its messages deleted_at NULL, and without this join those rows inflate
    // the badge forever — the inbox filters archived threads out, so there is
    // no row to open and clear them. Deliberately a read-side filter, not a
    // read_at stamp at archive time: read_at is recipient-only integrity
    // (a bulk stamp would forge reads) and must survive client restore.
    supabase
      .from('messages')
      .select('id, message_threads!inner(deleted_at)', {
        count: 'exact',
        head: true,
      })
      .eq('sender_role', 'client')
      .is('read_at', null)
      .is('deleted_at', null)
      .is('message_threads.deleted_at', null),
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
      {/* App-wide host for on-system notices (the alert() replacement at
          no-slot sites). Mounted once; notify() reaches it from anywhere. */}
      <NoticeHost />
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

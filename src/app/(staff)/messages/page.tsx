import Link from 'next/link'
import { Filter, Edit3 } from 'lucide-react'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { MessageRow, SenderRole } from '@/lib/messages/types'
import { Inbox } from './_components/Inbox'

interface PageProps {
  searchParams: Promise<{ thread?: string }>
}

export default async function MessagesPage({ searchParams }: PageProps) {
  const { userId, organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  // Threads list — joined to clients for name/initials/age. RLS already
  // scopes to the user's organization, so no .eq('organization_id', ...) needed.
  // !inner on clients drops threads whose client is soft-deleted (the clients
  // SELECT policy filters deleted_at IS NULL). Without this, archiving a
  // client leaves an orphan thread with a null embed → blank name + "?" avatar.
  const { data: threadsRaw } = await supabase
    .from('message_threads')
    .select(
      'id, client_id, last_message_at, last_message_preview, last_message_sender_role, clients!inner(first_name, last_name, email, phone, dob)',
    )
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(100)

  const threads = threadsRaw ?? []

  // Per-thread unread count of client→staff messages, computed once.
  const unreadByThread = new Map<string, number>()
  if (threads.length > 0) {
    const { data: unreadRows } = await supabase
      .from('messages')
      .select('thread_id')
      .in(
        'thread_id',
        threads.map((t) => t.id),
      )
      .eq('sender_role', 'client')
      .is('read_at', null)
      .is('deleted_at', null)

    for (const row of unreadRows ?? []) {
      unreadByThread.set(row.thread_id, (unreadByThread.get(row.thread_id) ?? 0) + 1)
    }
  }

  // Resolve which thread to show. If no ?thread param, default to the most
  // recent. If there are zero threads, the client component renders an empty
  // state and the messages query is skipped.
  const activeThreadId =
    params.thread && threads.some((t) => t.id === params.thread)
      ? params.thread
      : threads[0]?.id ?? null

  let activeMessages: MessageRow[] = []
  if (activeThreadId) {
    const { data: msgs } = await supabase
      .from('messages')
      .select(
        'id, thread_id, organization_id, sender_user_id, sender_role, body, read_at, created_at, updated_at, deleted_at',
      )
      .eq('thread_id', activeThreadId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500)
    activeMessages = msgs ?? []
  }

  const totalUnread = Array.from(unreadByThread.values()).reduce((a, b) => a + b, 0)
  const awaitingReply = threads.filter(
    (t) => t.last_message_sender_role === 'client',
  ).length

  return (
    <div className="page">
      <div className="page-head" style={{ marginBottom: 18 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Inbox</div>
          <h1>Messages.</h1>
          <div className="sub">
            {totalUnread} unread · {awaitingReply} awaiting reply
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="btn outline">
            <Filter size={14} aria-hidden /> All
          </button>
          <Link href="/clients" className="btn primary">
            <Edit3 size={14} aria-hidden /> New message
          </Link>
        </div>
      </div>

      <div className="card inbox-shell">
        <Inbox
          threads={threads.map((t) => ({
            id: t.id,
            clientId: t.client_id,
            firstName: t.clients?.first_name ?? '?',
            lastName: t.clients?.last_name ?? '',
            email: t.clients?.email ?? '',
            phone: t.clients?.phone ?? null,
            dob: t.clients?.dob ?? null,
            lastMessageAt: t.last_message_at,
            lastMessagePreview: t.last_message_preview,
            // CHECK constraint guarantees one of these two values, but the
            // generated type is the loose `string | null`. Narrow at the boundary.
            lastMessageSenderRole: t.last_message_sender_role as SenderRole | null,
            unreadCount: unreadByThread.get(t.id) ?? 0,
          }))}
          activeThreadId={activeThreadId}
          initialMessages={activeMessages}
          currentUserId={userId}
          organizationId={organizationId}
        />
      </div>
    </div>
  )
}

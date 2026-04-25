import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { MessageRow, MessageThreadRow } from '@/lib/messages/types'
import { ClientThread } from './_components/ClientThread'

export default async function PortalMessagesPage() {
  const { userId } = await requireRole(['client'])
  const supabase = await createSupabaseServerClient()

  // RLS already restricts to the caller's own thread — no .eq needed.
  type Mt = Pick<MessageThreadRow, 'id' | 'organization_id'>
  const { data: threadRow } = await supabase
    .from('message_threads' as never)
    .select('id, organization_id')
    .is('deleted_at', null)
    .maybeSingle()

  const thread = (threadRow ?? null) as Mt | null

  let messages: MessageRow[] = []
  let practitionerName: string | null = null

  if (thread) {
    const [msgsRes, orgRes] = await Promise.all([
      supabase
        .from('messages' as never)
        .select(
          'id, thread_id, organization_id, sender_user_id, sender_role, body, read_at, created_at, updated_at, deleted_at',
        )
        .eq('thread_id', thread.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(500),
      // Show the practice name as the conversation header so the client
      // knows who they're talking to. Single-practitioner orgs in v1.
      supabase
        .from('organizations')
        .select('name')
        .eq('id', thread.organization_id)
        .maybeSingle(),
    ])
    messages = (msgsRes.data ?? []) as unknown as MessageRow[]
    practitionerName = orgRes.data?.name ?? null
  }

  return (
    <ClientThread
      threadId={thread?.id ?? null}
      organizationId={thread?.organization_id ?? null}
      currentUserId={userId}
      initialMessages={messages}
      practitionerName={practitionerName}
    />
  )
}

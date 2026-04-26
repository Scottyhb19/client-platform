'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Paperclip, Send, Phone, User as UserIcon } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  MESSAGE_BODY_MAX,
  type MessageRow,
  type SenderRole,
} from '@/lib/messages/types'
import { markThreadReadAction, sendStaffMessageAction } from '../actions'

export interface ThreadSummary {
  id: string
  clientId: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  dob: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastMessageSenderRole: SenderRole | null
  unreadCount: number
}

interface InboxProps {
  threads: ThreadSummary[]
  activeThreadId: string | null
  initialMessages: MessageRow[]
  currentUserId: string
  organizationId: string
}

const AVATAR_TONES: Array<'g' | 'r' | 'a' | 'n'> = ['g', 'r', 'a', 'n']

function avatarTone(seed: string): 'g' | 'r' | 'a' | 'n' {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

function initials(first: string, last: string): string {
  const f = (first ?? '').trim()
  const l = (last ?? '').trim()
  if (f && l) return (f[0] + l[0]).toUpperCase()
  if (f) return f.slice(0, 2).toUpperCase()
  return '?'
}

function ageFromDob(dob: string | null): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age
}

/**
 * Format a thread-list timestamp:
 * - today: "8:42am"
 * - yesterday: "Yesterday"
 * - within last week: "Mon"
 * - older: "20 Apr"
 * Mirrors the deck's relative-time conventions (slide 05).
 */
function formatThreadTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d
      .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
      .toLowerCase()
      .replace(' ', '')
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday'
  }
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 7) {
    return d.toLocaleDateString('en-AU', { weekday: 'short' })
  }
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function formatBubbleTime(iso: string): string {
  const d = new Date(iso)
  return d
    .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
    .replace(' ', '')
}

function formatDayDivider(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const dayName = d.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return sameDay ? `Today · ${dayName}` : dayName
}

const QUICK_REPLIES = [
  'Confirming session',
  'Reschedule?',
  'Pain check-in',
  'Send program',
]

export function Inbox(props: InboxProps) {
  const {
    threads,
    activeThreadId,
    initialMessages,
    currentUserId,
    organizationId,
  } = props

  const router = useRouter()
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<MessageRow[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)

  // Sync local state when navigating between threads (server props change).
  useEffect(() => {
    setMessages(initialMessages)
    setDraft('')
    setError(null)
  }, [initialMessages, activeThreadId])

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, activeThreadId])

  // Mark client→staff messages read once we open the thread.
  useEffect(() => {
    if (!activeThreadId) return
    const hasUnread = messages.some(
      (m) => m.sender_role === 'client' && m.read_at === null,
    )
    if (!hasUnread) return
    void markThreadReadAction(activeThreadId).then((res) => {
      if (!res.error) router.refresh()
    })
  }, [activeThreadId, messages, router])

  // Realtime — subscribe to INSERTs on the active thread. RLS scopes which
  // rows we receive; the filter narrows what the channel even tries to push.
  useEffect(() => {
    if (!activeThreadId) return
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`thread:${activeThreadId}`)
      .on(
        'postgres_changes' as never,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${activeThreadId}`,
        } as never,
        (payload: { new: MessageRow }) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev
            // Drop any optimistic row that this realtime event canonicalises.
            // Without this we'd race the post-send callback and end up with
            // two rows sharing the same real id (duplicate React key).
            const filtered = prev.filter(
              (m) =>
                !(
                  m.id.startsWith('optimistic-') &&
                  m.sender_user_id === payload.new.sender_user_id &&
                  m.sender_role === payload.new.sender_role &&
                  m.body === payload.new.body
                ),
            )
            return [...filtered, payload.new]
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [activeThreadId])

  // Also subscribe at the org level so the thread list re-sorts on any new
  // message, even in a non-active thread. router.refresh() is cheap enough
  // for the volumes a solo EP sees; revisit if this gets chatty.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`org-threads:${organizationId}`)
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'message_threads',
          filter: `organization_id=eq.${organizationId}`,
        } as never,
        () => router.refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [organizationId, router])

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  )

  function handleSend(text: string) {
    const body = text.trim()
    if (!body || isSending || !activeThread) return
    if (body.length > MESSAGE_BODY_MAX) {
      setError(`Message is ${body.length} characters; cap is ${MESSAGE_BODY_MAX}.`)
      return
    }
    setError(null)
    setDraft('')

    // Optimistic insert
    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    const optimistic: MessageRow = {
      id: optimisticId,
      thread_id: activeThread.id,
      organization_id: organizationId,
      sender_user_id: currentUserId,
      sender_role: 'staff',
      body,
      read_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    setMessages((prev) => [...prev, optimistic])

    startTransition(async () => {
      const res = await sendStaffMessageAction({
        threadId: activeThread.id,
        body,
      })
      if (res.error || !res.data) {
        setError(res.error ?? 'Send failed.')
        // Roll back the optimistic message
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        setDraft(body)
        return
      }
      // Replace optimistic with the canonical row id — unless the realtime
      // event has already inserted it, in which case just drop the optimistic
      // (the realtime row is now the source of truth).
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.data!.messageId)) {
          return prev.filter((m) => m.id !== optimisticId)
        }
        return prev.map((m) =>
          m.id === optimisticId ? { ...m, id: res.data!.messageId } : m,
        )
      })
      router.refresh()
    })
  }

  return (
    <>
      <ThreadList
        threads={threads}
        activeThreadId={activeThreadId}
        searchParams={searchParams}
      />
      {activeThread ? (
        <ThreadPane
          thread={activeThread}
          messages={messages}
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => handleSend(draft)}
          onQuickReply={(text) => setDraft((d) => (d ? `${d} ${text}` : text))}
          isSending={isSending}
          error={error}
        />
      ) : (
        <div className="thread-pane">
          <div className="thread-pane__empty">
            {threads.length === 0
              ? 'No conversations yet. Start one from a client profile.'
              : 'Select a conversation.'}
          </div>
        </div>
      )}
      {activeThread && <SidePanel thread={activeThread} />}
    </>
  )
}

function ThreadList({
  threads,
  activeThreadId,
  searchParams,
}: {
  threads: ThreadSummary[]
  activeThreadId: string | null
  searchParams: ReturnType<typeof useSearchParams>
}) {
  const [filter, setFilter] = useState('')
  const filtered = useMemo(() => {
    if (!filter.trim()) return threads
    const q = filter.toLowerCase()
    return threads.filter((t) =>
      `${t.firstName} ${t.lastName} ${t.lastMessagePreview ?? ''}`
        .toLowerCase()
        .includes(q),
    )
  }, [threads, filter])

  return (
    <div className="inbox-list">
      <div className="inbox-list__search">
        <input
          type="search"
          className="search-input"
          placeholder="Search messages…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="inbox-list__rows">
        {filtered.length === 0 ? (
          <div className="inbox-list__empty">
            {threads.length === 0
              ? 'No messages yet.'
              : 'No matches for that search.'}
          </div>
        ) : (
          filtered.map((t) => {
            const tone = avatarTone(t.clientId)
            const isActive = t.id === activeThreadId
            const isUnread = t.unreadCount > 0
            const params = new URLSearchParams(searchParams?.toString() ?? '')
            params.set('thread', t.id)
            return (
              <Link
                key={t.id}
                href={`/messages?${params.toString()}`}
                className={`inbox-list__row ${isUnread ? 'unread' : ''} ${
                  isActive ? 'active' : ''
                }`}
              >
                <span
                  className={`avatar ${tone}`}
                  style={{ width: 36, height: 36, fontSize: 13 }}
                  aria-hidden
                >
                  {initials(t.firstName, t.lastName)}
                </span>
                <div className="inbox-list__row-body">
                  <div className="inbox-list__row-top">
                    <span className="inbox-list__row-name">
                      {t.firstName} {t.lastName}
                    </span>
                    <span className="inbox-list__row-time">
                      {formatThreadTime(t.lastMessageAt)}
                    </span>
                  </div>
                  <div className="inbox-list__row-preview">
                    {t.lastMessagePreview ?? 'No messages yet'}
                  </div>
                </div>
                {isUnread && <span className="inbox-list__row-dot" aria-hidden />}
              </Link>
            )
          })
        )}
      </div>
    </div>
  )
}

function ThreadPane({
  thread,
  messages,
  draft,
  onDraftChange,
  onSend,
  onQuickReply,
  isSending,
  error,
}: {
  thread: ThreadSummary
  messages: MessageRow[]
  draft: string
  onDraftChange: (v: string) => void
  onSend: () => void
  onQuickReply: (text: string) => void
  isSending: boolean
  error: string | null
}) {
  const tone = avatarTone(thread.clientId)
  const counterClass =
    draft.length > MESSAGE_BODY_MAX
      ? 'thread-pane__counter error'
      : draft.length > MESSAGE_BODY_MAX - 100
      ? 'thread-pane__counter warn'
      : 'thread-pane__counter'

  // Group messages into "today" / "yesterday" / etc. dividers. Dedupes by id
  // as cheap insurance — if state ever drifts (race conditions, double
  // realtime delivery), we render once instead of crashing on duplicate keys.
  const grouped = useMemo(() => {
    const out: Array<{ kind: 'divider'; key: string; label: string } | { kind: 'msg'; msg: MessageRow }> = []
    const seen = new Set<string>()
    let lastDayKey = ''
    for (const m of messages) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      const d = new Date(m.created_at)
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (dayKey !== lastDayKey) {
        out.push({ kind: 'divider', key: `d-${dayKey}`, label: formatDayDivider(m.created_at) })
        lastDayKey = dayKey
      }
      out.push({ kind: 'msg', msg: m })
    }
    return out
  }, [messages])

  return (
    <div className="thread-pane">
      <div className="thread-pane__head">
        <span
          className={`avatar ${tone}`}
          style={{ width: 36, height: 36, fontSize: 13 }}
          aria-hidden
        >
          {initials(thread.firstName, thread.lastName)}
        </span>
        <div style={{ flex: 1 }}>
          <div className="thread-pane__head-name">
            {thread.firstName} {thread.lastName}
          </div>
          <div className="thread-pane__head-meta">{thread.email}</div>
        </div>
        {thread.phone && (
          <a className="btn ghost" href={`tel:${thread.phone}`} aria-label="Call">
            <Phone size={14} aria-hidden />
          </a>
        )}
        <Link className="btn ghost" href={`/clients/${thread.clientId}`}>
          <UserIcon size={14} aria-hidden /> Open profile
        </Link>
      </div>

      <div className="thread-pane__body" ref={(el) => {
        // ref via callback so we can scroll the same element auto-scroll uses;
        // see the parent useEffect for the actual scroll-to-bottom hook.
        if (el) (el as HTMLDivElement & { __scrollHost?: true }).__scrollHost = true
      }}>
        {grouped.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: '.85rem', marginTop: 40 }}>
            No messages yet — say hello.
          </div>
        ) : (
          grouped.map((item) =>
            item.kind === 'divider' ? (
              <div key={item.key} className="thread-pane__divider">
                {item.label}
              </div>
            ) : (
              <div
                key={item.msg.id}
                className={`thread-pane__row ${item.msg.sender_role === 'staff' ? 'me' : 'them'}`}
              >
                <div
                  className={`thread-pane__bubble ${item.msg.sender_role === 'staff' ? 'me' : 'them'}`}
                >
                  {item.msg.body}
                  <div className="thread-pane__bubble-time">
                    {formatBubbleTime(item.msg.created_at)}
                  </div>
                </div>
              </div>
            ),
          )
        )}
      </div>

      <div className="thread-pane__composer">
        <div className="thread-pane__composer-row">
          <button
            type="button"
            className="btn ghost"
            aria-label="Attach (coming soon)"
            disabled
            title="Attachments coming in a later phase"
          >
            <Paperclip size={14} aria-hidden />
          </button>
          <textarea
            placeholder={`Reply to ${thread.firstName}…`}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                onSend()
              }
            }}
            maxLength={MESSAGE_BODY_MAX + 200}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!draft.trim() || isSending || draft.length > MESSAGE_BODY_MAX}
            onClick={onSend}
          >
            <Send size={14} aria-hidden /> Send
          </button>
        </div>
        <div className="thread-pane__composer-quick">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              className="chip"
              onClick={() => onQuickReply(q)}
            >
              + {q}
            </button>
          ))}
        </div>
        {error && (
          <div style={{ color: 'var(--color-alert)', fontSize: '.78rem', marginTop: 6 }}>
            {error}
          </div>
        )}
        <div className={counterClass}>
          {draft.length} / {MESSAGE_BODY_MAX} · ⌘/Ctrl + Enter to send
        </div>
      </div>
    </div>
  )
}

function SidePanel({ thread }: { thread: ThreadSummary }) {
  const tone = avatarTone(thread.clientId)
  const age = ageFromDob(thread.dob)
  return (
    <aside className="inbox-side">
      <div className="eyebrow">Client snapshot</div>
      <div className="inbox-side__profile">
        <span
          className={`avatar ${tone}`}
          style={{ width: 48, height: 48, fontSize: 16 }}
          aria-hidden
        >
          {initials(thread.firstName, thread.lastName)}
        </span>
        <div>
          <div className="inbox-side__profile-name">
            {thread.firstName} {thread.lastName}
          </div>
          <div className="inbox-side__profile-meta">
            Client{age !== null ? ` · ${age} yrs` : ''}
          </div>
        </div>
      </div>

      <div className="inbox-side__urgency-banner">
        For urgent issues, call <strong>000</strong>. For clinical questions
        please book an appointment.
      </div>

      <div className="inbox-side__stats">
        <div className="inbox-side__stat">
          <span className="inbox-side__stat-label">Email</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>
            {thread.email}
          </span>
        </div>
        {thread.phone && (
          <div className="inbox-side__stat">
            <span className="inbox-side__stat-label">Phone</span>
            <span>{thread.phone}</span>
          </div>
        )}
      </div>

      <Link
        href={`/clients/${thread.clientId}`}
        className="btn outline"
        style={{ marginTop: 18, width: '100%', justifyContent: 'center' }}
      >
        Open full profile
      </Link>
    </aside>
  )
}

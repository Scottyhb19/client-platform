'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { MESSAGE_BODY_MAX, type MessageRow } from '@/lib/messages/types'
import {
  markClientThreadReadAction,
  sendClientMessageAction,
} from '../actions'

interface ClientThreadProps {
  threadId: string | null
  organizationId: string | null
  currentUserId: string
  initialMessages: MessageRow[]
  practitionerName: string | null
}

function formatBubbleTime(iso: string): string {
  return new Date(iso)
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

export function ClientThread(props: ClientThreadProps) {
  const { threadId, organizationId, currentUserId, initialMessages, practitionerName } = props

  const router = useRouter()
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  // Mark staff→client messages read when the page is open
  useEffect(() => {
    if (!threadId) return
    const hasUnread = messages.some(
      (m) => m.sender_role === 'staff' && m.read_at === null,
    )
    if (!hasUnread) return
    void markClientThreadReadAction().then((res) => {
      if (!res.error) router.refresh()
    })
  }, [threadId, messages, router])

  // Realtime subscription for incoming staff messages
  useEffect(() => {
    if (!threadId) return
    const supabase = createSupabaseBrowserClient()
    const channel = supabase
      .channel(`portal-thread:${threadId}`)
      .on(
        'postgres_changes' as never,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        } as never,
        (payload: { new: MessageRow }) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev
            // Drop any optimistic row this realtime event canonicalises so we
            // don't end up with two rows sharing the same id once the post-
            // send callback also tries to swap the id in.
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
  }, [threadId])

  function handleSend() {
    const body = draft.trim()
    if (!body || isSending || !threadId || !organizationId) return
    if (body.length > MESSAGE_BODY_MAX) {
      setError(`Message is too long. Max ${MESSAGE_BODY_MAX} characters.`)
      return
    }
    setError(null)
    setDraft('')

    const optimisticId = `optimistic-${crypto.randomUUID()}`
    const now = new Date().toISOString()
    const optimistic: MessageRow = {
      id: optimisticId,
      thread_id: threadId,
      organization_id: organizationId,
      sender_user_id: currentUserId,
      sender_role: 'client',
      body,
      read_at: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    setMessages((prev) => [...prev, optimistic])

    startTransition(async () => {
      const res = await sendClientMessageAction(body)
      if (res.error || !res.data) {
        setError(res.error ?? 'Send failed.')
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        setDraft(body)
        return
      }
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

  const grouped = useMemo(() => {
    const out: Array<
      | { kind: 'divider'; key: string; label: string }
      | { kind: 'msg'; msg: MessageRow }
    > = []
    const seen = new Set<string>()
    let lastDayKey = ''
    for (const m of messages) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      const d = new Date(m.created_at)
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (dayKey !== lastDayKey) {
        out.push({
          kind: 'divider',
          key: `d-${dayKey}`,
          label: formatDayDivider(m.created_at),
        })
        lastDayKey = dayKey
      }
      out.push({ kind: 'msg', msg: m })
    }
    return out
  }, [messages])

  if (!threadId) {
    return (
      <div className="portal-thread">
        <div className="portal-thread__head">
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Messages</div>
            <div style={{ fontSize: '.78rem', color: 'var(--color-text-light)' }}>
              {practitionerName ?? 'Your practitioner'}
            </div>
          </div>
        </div>
        <div className="portal-thread__body">
          <div
            style={{
              margin: 'auto',
              textAlign: 'center',
              maxWidth: 280,
              color: 'var(--color-text-light)',
              fontSize: '.92rem',
              lineHeight: 1.5,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.1rem',
                color: 'var(--color-charcoal)',
                marginBottom: 8,
              }}
            >
              No conversation yet
            </div>
            Your practitioner will start a thread once your first session is
            booked. For urgent issues, call <strong>000</strong>.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="portal-thread">
      <div className="portal-thread__head">
        <span
          className="avatar g"
          style={{ width: 38, height: 38, fontSize: 14 }}
          aria-hidden
        >
          {(practitionerName ?? 'EP').slice(0, 2).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '.98rem' }}>
            {practitionerName ?? 'Your practitioner'}
          </div>
          <div style={{ fontSize: '.74rem', color: 'var(--color-text-light)' }}>
            Reply within business hours
          </div>
        </div>
      </div>

      <div className="portal-thread__body" ref={bodyRef}>
        {grouped.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              color: 'var(--color-text-light)',
              fontSize: '.85rem',
            }}
          >
            Say hello.
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
                className={`thread-pane__row ${item.msg.sender_role === 'client' ? 'me' : 'them'}`}
              >
                <div
                  className={`thread-pane__bubble ${item.msg.sender_role === 'client' ? 'me' : 'them'}`}
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

      <div className="portal-thread__composer">
        <div className="thread-pane__composer-row">
          <textarea
            placeholder="Message your practitioner…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MESSAGE_BODY_MAX + 200}
            style={{ minHeight: 38 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSend()
              }
            }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!draft.trim() || isSending || draft.length > MESSAGE_BODY_MAX}
            onClick={handleSend}
            aria-label="Send"
          >
            <Send size={14} aria-hidden />
          </button>
        </div>
        {error && (
          <div style={{ color: 'var(--color-alert)', fontSize: '.78rem', marginTop: 6 }}>
            {error}
          </div>
        )}
        <div
          style={{
            fontSize: '.66rem',
            color: 'var(--color-muted)',
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          For urgent issues call <strong>000</strong> · {draft.length}/{MESSAGE_BODY_MAX}
        </div>
      </div>
    </div>
  )
}

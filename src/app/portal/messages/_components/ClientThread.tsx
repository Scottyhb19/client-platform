'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, Send, X } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import {
  CLIENT_PHOTO_MAX_BYTES,
  MESSAGE_ATTACHMENTS_MAX,
  MESSAGE_BODY_MAX,
  type AttachmentView,
  type MessageRow,
} from '@/lib/messages/types'
import {
  removeUploadedAttachments,
  uploadMessageAttachments,
} from '@/lib/messages/upload'
import { MessageAttachments } from '@/components/messages/MessageAttachments'
import {
  getClientAttachmentDownloadUrlAction,
  getClientAttachmentViewsAction,
  markClientThreadReadAction,
  sendClientMessageAction,
  sendClientPhotoMessageAction,
} from '../actions'

// P2-1: clinical-safety disclosure dismissal, read from localStorage via a
// tiny external store + useSyncExternalStore rather than a setState-in-effect.
// The server snapshot returns "dismissed", so the banner never renders on the
// server — no hydration mismatch — and it appears after hydration for
// first-time clients. Mirrors the BottomNav session-theme store pattern.
const DISCLAIMER_DISMISSED_KEY = 'odyssey-portal-msg-disclaimer-dismissed'

const disclaimerListeners = new Set<() => void>()

function readDisclaimerDismissed(): boolean {
  try {
    return localStorage.getItem(DISCLAIMER_DISMISSED_KEY) === '1'
  } catch {
    // localStorage unavailable (e.g. private mode) — don't nag.
    return true
  }
}

function subscribeDisclaimer(cb: () => void): () => void {
  disclaimerListeners.add(cb)
  return () => {
    disclaimerListeners.delete(cb)
  }
}

function dismissDisclaimer(): void {
  try {
    localStorage.setItem(DISCLAIMER_DISMISSED_KEY, '1')
  } catch {
    // best-effort; if it can't persist it'll show again next load.
  }
  disclaimerListeners.forEach((cb) => cb())
}

interface ClientThreadProps {
  threadId: string | null
  organizationId: string | null
  currentUserId: string
  initialMessages: MessageRow[]
  /** Attachment views for initialMessages, keyed by message id. */
  initialAttachments: Record<string, AttachmentView[]>
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
  const {
    threadId,
    organizationId,
    currentUserId,
    initialMessages,
    initialAttachments,
    practitionerName,
  } = props

  const router = useRouter()
  const [messages, setMessages] = useState(initialMessages)
  const [attachmentsByMsg, setAttachmentsByMsg] =
    useState<Record<string, AttachmentView[]>>(initialAttachments)
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // Object URLs for the pending-photo thumbnails — derived, revoked on change.
  const pendingPreviews = useMemo(
    () => pendingPhotos.map((f) => URL.createObjectURL(f)),
    [pendingPhotos],
  )
  useEffect(
    () => () => {
      pendingPreviews.forEach((u) => URL.revokeObjectURL(u))
    },
    [pendingPreviews],
  )

  // P2-1: show the clinical-safety disclosure unless dismissed (client-only
  // localStorage read). Factual, non-alarming — the persistent 000 footer in
  // the composer remains regardless.
  const disclaimerDismissed = useSyncExternalStore(
    subscribeDisclaimer,
    readDisclaimerDismissed,
    () => true, // server snapshot: dismissed → no SSR render, no hydration split.
  )

  // Sync local messages when the server hands down a new initialMessages.
  // Done during render via the previous-value pattern, not an effect
  // (react-hooks/set-state-in-effect).
  const [prevInitialMessages, setPrevInitialMessages] = useState(initialMessages)
  if (prevInitialMessages !== initialMessages) {
    setPrevInitialMessages(initialMessages)
    setMessages(initialMessages)
    setAttachmentsByMsg(initialAttachments)
  }

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
          // Attachment rows aren't in the realtime payload — fetch views for
          // an incoming photo/file message (FM-L). Idempotent on self-sends.
          if (payload.new.has_attachments) {
            void getClientAttachmentViewsAction(payload.new.id).then((res) => {
              if (res.data && res.data.length > 0) {
                setAttachmentsByMsg((prev) => ({
                  ...prev,
                  [payload.new.id]: res.data!,
                }))
              }
            })
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [threadId])

  function handlePickPhotos(picked: FileList | null) {
    if (!picked || picked.length === 0) return
    setError(null)
    const incoming = Array.from(picked)
    const merged = [...pendingPhotos, ...incoming]
    if (merged.length > MESSAGE_ATTACHMENTS_MAX) {
      setError(`Up to ${MESSAGE_ATTACHMENTS_MAX} photos per message.`)
      return
    }
    for (const f of incoming) {
      if (!f.type.startsWith('image/')) {
        setError('Photos only in here.')
        return
      }
      if (f.size > CLIENT_PHOTO_MAX_BYTES) {
        setError(
          `That photo is ${(f.size / 1024 / 1024).toFixed(1)} MB — the cap is 10 MB.`,
        )
        return
      }
    }
    setPendingPhotos(merged)
  }

  function handleSendPhotos(body: string) {
    if (!threadId || !organizationId) return
    const files = pendingPhotos
    startTransition(async () => {
      const up = await uploadMessageAttachments({
        organizationId,
        threadId,
        files,
      })
      if (up.error || !up.uploaded) {
        setError(up.error ?? 'Upload failed — check your connection and try again.')
        return
      }
      const res = await sendClientPhotoMessageAction({
        body,
        attachments: up.uploaded,
      })
      if (res.error || !res.data) {
        // Message never landed — clean up the orphan blobs (FM-F).
        await removeUploadedAttachments(up.uploaded)
        setError(res.error ?? 'Send failed — your photos were not sent.')
        return
      }
      const { message, attachments } = res.data
      setAttachmentsByMsg((prev) => ({ ...prev, [message.id]: attachments }))
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      )
      setPendingPhotos([])
      setDraft('')
      router.refresh()
    })
  }

  function handleSend() {
    const body = draft.trim()
    if (isSending || !threadId || !organizationId) return
    if (body.length > MESSAGE_BODY_MAX) {
      setError(`Message is too long. Max ${MESSAGE_BODY_MAX} characters.`)
      return
    }
    if (pendingPhotos.length > 0) {
      // Photo sends skip the optimistic bubble — the upload is the slow part
      // and a bubble that could still fail would be dishonest. The Sending…
      // button state carries the feedback instead.
      setError(null)
      handleSendPhotos(body)
      return
    }
    if (!body) return
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
      has_attachments: false,
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

      {!disclaimerDismissed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '8px 14px',
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border-subtle)',
            fontSize: '.72rem',
            lineHeight: 1.45,
            color: 'var(--color-text-light)',
          }}
        >
          <span style={{ flex: 1 }}>
            This channel isn&rsquo;t for urgent or clinical concerns. In an
            emergency call <strong>000</strong>; for clinical questions, book an
            appointment.
          </span>
          <button
            type="button"
            onClick={dismissDisclaimer}
            aria-label="Dismiss"
            style={{
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: 'var(--color-muted)',
              flexShrink: 0,
            }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="portal-thread__body" ref={bodyRef}>
        {grouped.length === 0 ? (
          <div
            style={{
              margin: 'auto',
              color: 'var(--color-text-light)',
              fontSize: '.85rem',
            }}
          >
            No messages yet.
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
                  {(attachmentsByMsg[item.msg.id]?.length ?? 0) > 0 && (
                    <MessageAttachments
                      attachments={attachmentsByMsg[item.msg.id]!}
                      onDownload={async (id) => {
                        const r = await getClientAttachmentDownloadUrlAction(id)
                        return { url: r.data?.url ?? null, error: r.error }
                      }}
                    />
                  )}
                  {item.msg.body.trim().length > 0 && item.msg.body}
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
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              handlePickPhotos(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn ghost"
            aria-label="Add photos"
            title="Add photos"
            disabled={isSending}
            onClick={() => photoInputRef.current?.click()}
          >
            <ImagePlus size={16} aria-hidden />
          </button>
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
            disabled={
              (!draft.trim() && pendingPhotos.length === 0) ||
              isSending ||
              draft.length > MESSAGE_BODY_MAX
            }
            onClick={handleSend}
            aria-label="Send"
          >
            <Send size={14} aria-hidden />
          </button>
        </div>
        {pendingPhotos.length > 0 && (
          <div className="composer-pending">
            {pendingPhotos.map((f, i) => (
              <span key={`${f.name}-${i}`} className="composer-pending__thumb">
                {/* Local object URL preview of a photo about to be sent. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pendingPreviews[i]} alt={f.name} />
                <button
                  type="button"
                  className="composer-pending__remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={() =>
                    setPendingPhotos((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  disabled={isSending}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
            {isSending && (
              <span className="composer-pending__sending">Sending…</span>
            )}
          </div>
        )}
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

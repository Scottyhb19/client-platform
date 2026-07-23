'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import { MessageAttachments } from '@/components/messages/MessageAttachments'
import { getStaffAttachmentDownloadUrlAction } from '@/app/(staff)/messages/actions'
import type { AttachmentView } from '@/lib/messages/types'

/**
 * §12 Part B (logging half) — the client-profile Comms tab (brief §6.7:
 * "sent communications logged to the client's Comms tab").
 *
 * A read-only, newest-first record of what the practice has sent this
 * client: invites, booking confirmations, reschedule notifications, and
 * appointment reminders (logged DB-side by reminder_log_communication).
 * Failed sends appear too — this is the EP-facing surfacing that §12
 * Part A's P1-3 deliberately left to this tab.
 *
 * Rows expand to the stored body (the plaintext of what actually went
 * out for app-side sends; a factual summary line for reminder sends).
 *
 * FM-8 (2026-07-23): for an ARCHIVED client this tab additionally renders
 * the in-app message history (read-only transcript). Archiving cascades
 * deleted_at onto the thread, which removes it from the staff inbox — the
 * archived-arm SELECT policy (migration 20260723160000) makes it readable
 * again HERE, so the clinical record stays producible in-app (AHPRA/APP
 * record production). Live clients keep using /messages; archivedMessages
 * is null for them and the section never renders.
 */
export interface ArchivedThreadMessage {
  id: string
  created_at: string
  sender_role: 'staff' | 'client'
  body: string
  // Full views, not a count — record production includes the attachment
  // bytes (images render inline off signed URLs; files download via the
  // staff download action, RLS-authorised with no liveness predicate).
  attachments: AttachmentView[]
}

export interface ProfileCommunication {
  id: string
  created_at: string
  communication_type: string
  status: string
  subject: string | null
  body: string
  recipient_email: string | null
  failure_reason: string | null
  sender_user_id: string | null
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  bounced: 'Bounced',
  queued: 'Queued',
  draft: 'Draft',
}

const FAILED = new Set(['failed', 'bounced'])

// Reminder rows are logged DB-side by reminder_log_communication (migration
// 20260721160000): `body` holds a factual summary line, NOT the verbatim
// email that went out (the Edge Function's render isn't captured yet). Every
// other send (invite, booking confirmation, reschedule) stores the real
// plaintext body. Without this marker an EP reading the record back would
// reasonably treat the summary as the message that was sent. Keyed on the
// trigger's subject constant + system-send — keep in sync if the trigger's
// subject changes.
const REMINDER_SUBJECT = 'Appointment reminder'

function isReminderSummary(c: ProfileCommunication): boolean {
  return c.sender_user_id === null && c.subject?.trim() === REMINDER_SUBJECT
}

function formatCommDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: PRACTICE_TIMEZONE,
  })
}

function formatCommTime(iso: string): string {
  return new Date(iso)
    .toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: PRACTICE_TIMEZONE,
    })
    .toLowerCase()
}

export function CommsTab({
  comms,
  archivedMessages = null,
  clientFirstName = null,
}: {
  comms: ProfileCommunication[]
  /**
   * FM-8: the archived client's in-app message transcript (oldest-first).
   * null = live client (or no thread) — the section doesn't render.
   */
  archivedMessages?: ArchivedThreadMessage[] | null
  clientFirstName?: string | null
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (comms.length === 0 && archivedMessages === null) {
    return (
      <div style={{ padding: '18px 22px 22px' }}>
        <div
          style={{
            fontSize: '.85rem',
            color: 'var(--color-text-light)',
            padding: '22px 0',
          }}
        >
          Nothing sent yet. Invites, booking confirmations, and appointment
          reminders will appear here once they go out.
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '18px 22px 22px' }}>
      {comms.length === 0 ? (
        <div
          style={{
            fontSize: '.85rem',
            color: 'var(--color-text-light)',
            padding: '0 0 18px',
          }}
        >
          Nothing sent — no emails were logged before this client was
          archived.
        </div>
      ) : (
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border-hairline)',
          borderRadius: 10,
        }}
      >
        {comms.map((c, i) => {
          const open = openId === c.id
          const failed = FAILED.has(c.status)
          const summary = isReminderSummary(c)
          return (
            <div
              key={c.id}
              style={{
                borderTop:
                  i > 0 ? '1px solid var(--color-border-hairline)' : 'none',
              }}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : c.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: 'none',
                  padding: '12px 14px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 600,
                      fontSize: '.95rem',
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.subject?.trim() || 'Email'}
                  </div>
                  <div
                    style={{
                      fontSize: '.8rem',
                      color: 'var(--color-text-light)',
                      marginTop: 1,
                    }}
                  >
                    {formatCommDate(c.created_at)},{' '}
                    {formatCommTime(c.created_at)}
                    {c.sender_user_id === null ? ' · Automatic' : ''}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '.66rem',
                    fontWeight: 700,
                    letterSpacing: '.04em',
                    textTransform: 'uppercase',
                    color: failed ? 'var(--color-alert)' : 'var(--color-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {STATUS_LABEL[c.status] ?? c.status}
                </span>
                {open ? (
                  <ChevronUp size={15} color="var(--color-muted)" />
                ) : (
                  <ChevronDown size={15} color="var(--color-muted)" />
                )}
              </button>
              {open && (
                <div style={{ padding: '0 14px 14px' }}>
                  {c.recipient_email ? (
                    <div
                      style={{
                        fontSize: '.78rem',
                        color: 'var(--color-text-light)',
                        marginBottom: 8,
                      }}
                    >
                      To {c.recipient_email}
                    </div>
                  ) : null}
                  {failed && c.failure_reason ? (
                    <div
                      style={{
                        fontSize: '.8rem',
                        color: 'var(--color-alert)',
                        marginBottom: 8,
                      }}
                    >
                      {c.failure_reason}
                    </div>
                  ) : null}
                  {summary ? (
                    <div
                      style={{
                        fontSize: '.72rem',
                        color: 'var(--color-text-light)',
                        marginBottom: 6,
                      }}
                    >
                      Summary of the reminder — the exact message sent isn’t
                      stored.
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: '.85rem',
                      color: 'var(--color-text)',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'break-word',
                    }}
                  >
                    {c.body}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      {archivedMessages !== null && (
        <ArchivedMessagesSection
          messages={archivedMessages}
          clientFirstName={clientFirstName}
        />
      )}
    </div>
  )
}

/**
 * FM-8 — the archived client's in-app message transcript, read-only.
 * Oldest-first (a record reads top-down); no compose affordance exists or
 * ever will here — the thread is frozen by message_enforce_immutability and
 * the send RPC's live-thread pin.
 */
function ArchivedMessagesSection({
  messages,
  clientFirstName,
}: {
  messages: ArchivedThreadMessage[]
  clientFirstName: string | null
}) {
  return (
    <div style={{ marginTop: 26 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.72rem',
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: 'var(--color-text-faint)',
          marginBottom: 6,
        }}
      >
        In-app messages
      </div>
      <div
        style={{
          fontSize: '.78rem',
          color: 'var(--color-text-light)',
          marginBottom: 10,
        }}
      >
        Messages exchanged through the portal before this client was
        archived. Read-only — part of the retained record.
      </div>
      {messages.length === 0 ? (
        <div style={{ fontSize: '.85rem', color: 'var(--color-text-light)' }}>
          No messages were exchanged.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border-hairline)',
            borderRadius: 10,
          }}
        >
          {messages.map((m, i) => (
            <div
              key={m.id}
              style={{
                borderTop:
                  i > 0 ? '1px solid var(--color-border-hairline)' : 'none',
                padding: '10px 14px',
              }}
            >
              <div
                style={{
                  fontSize: '.74rem',
                  color: 'var(--color-text-light)',
                  marginBottom: 3,
                }}
              >
                <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                  {m.sender_role === 'staff'
                    ? 'Staff'
                    : clientFirstName || 'Client'}
                </span>{' '}
                · {formatCommDate(m.created_at)}, {formatCommTime(m.created_at)}
              </div>
              <div
                style={{
                  fontSize: '.85rem',
                  color: 'var(--color-text)',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                }}
              >
                {m.body}
              </div>
              {m.attachments.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <MessageAttachments
                    attachments={m.attachments}
                    onDownload={async (attachmentId) => {
                      const r =
                        await getStaffAttachmentDownloadUrlAction(attachmentId)
                      return { url: r.data?.url ?? null, error: r.error }
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

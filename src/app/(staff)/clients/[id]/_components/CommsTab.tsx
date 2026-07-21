'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { PRACTICE_TIMEZONE } from '@/lib/constants'

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
 */
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

export function CommsTab({ comms }: { comms: ProfileCommunication[] }) {
  const [openId, setOpenId] = useState<string | null>(null)

  if (comms.length === 0) {
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
    </div>
  )
}

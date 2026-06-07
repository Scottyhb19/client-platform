'use client'

import { useState, useTransition } from 'react'
import { resendInviteAction } from '../actions'
import { timeAgo } from '@/lib/format/time-ago'

/**
 * Resend-invite control for the client profile header (C-5, closes F-5).
 *
 * Structure mirrors the G-10 ResendConfirmationButton atom (idle →
 * pending → sent/error, swap-on-success), but renders in the client-
 * profile surface's dialect: inline style + CSS vars for the text lines
 * (matching the header's openError block), and the global `.btn ghost`
 * atom for the control. resendInviteAction returns `{ error: string |
 * null }`, so success is `error === null` rather than G-10's status union.
 *
 * The parent only renders this when canResendInvite holds (user_id IS NULL
 * AND invited_at IS NOT NULL), so lastInviteSentAt is expected non-null;
 * the hint line guards on it anyway.
 */
export function ResendInviteButton({
  clientId,
  lastInviteSentAt,
}: {
  clientId: string
  lastInviteSentAt: string | null
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ error: string | null } | null>(null)

  function handleResend() {
    startTransition(async () => {
      setResult(await resendInviteAction(clientId))
    })
  }

  // Swap-on-success: a clean send replaces the hint + button with a quiet
  // confirmation line, mirroring the G-10 atom. (result non-null with a
  // null error is the success signal; we returned before the button.)
  if (result && result.error === null) {
    return (
      <p
        style={{
          margin: 0,
          fontSize: '.78rem',
          color: 'var(--color-text-light)',
        }}
      >
        Invite resent.
      </p>
    )
  }

  return (
    <div>
      {lastInviteSentAt && (
        <div style={{ fontSize: '.78rem', color: 'var(--color-text-light)' }}>
          Last invite sent: {timeAgo(lastInviteSentAt)}
        </div>
      )}
      <button
        type="button"
        onClick={handleResend}
        disabled={isPending}
        className="btn ghost"
        style={{
          fontSize: '.78rem',
          marginTop: 4,
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? 'Sending…' : 'Resend invite'}
      </button>
      {result?.error && (
        <p
          style={{
            marginTop: 4,
            fontSize: '.78rem',
            color: 'var(--color-alert)',
          }}
        >
          {result.error}
        </p>
      )}
    </div>
  )
}

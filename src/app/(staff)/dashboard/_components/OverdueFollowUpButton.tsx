'use client'

import { useState, useTransition } from 'react'
import { Check } from 'lucide-react'
import { acknowledgeOverdueFollowupAction } from '../actions'

/**
 * "Program checked & message sent" — the manual exit for the two attention
 * triggers with no natural clear: Overdue and Onboarding.
 *
 * Both only clear on an action the EP can't force the DB to witness: Overdue
 * clears when the *client* logs a session; Onboarding clears when the client
 * gets going — and the EP's reach-out (call / message) leaves no other trace.
 * (Ending / New / Ended drop off on their own once the EP drafts or the state
 * changes.) This records the follow-up and snoozes the row ~10 days. It is an
 * acknowledgement only — it does not send anything; the EP does that via the
 * client / messaging screens.
 *
 * On success the server action revalidates /dashboard, so the row drops off the
 * panel on the next render. On failure the error surfaces inline and the row
 * stays put (nothing was acknowledged).
 */
export function OverdueFollowUpButton({ clientId }: { clientId: string }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <button
        type="button"
        className="btn outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const res = await acknowledgeOverdueFollowupAction(clientId)
            if (res.error) setError(res.error)
          })
        }
        title="Mark this overdue follow-up done — you've checked their program and sent a message. Resets the overdue clock (~10 days)."
        style={{ whiteSpace: 'nowrap' }}
      >
        <Check size={14} aria-hidden />
        {pending ? 'Saving…' : 'Program checked & message sent'}
      </button>
      {error && (
        <span
          style={{
            fontSize: '.72rem',
            color: 'var(--color-alert)',
            maxWidth: 220,
            textAlign: 'right',
          }}
        >
          {error}
        </span>
      )}
    </div>
  )
}

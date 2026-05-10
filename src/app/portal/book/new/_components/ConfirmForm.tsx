'use client'

import { useActionState } from 'react'
import { confirmBookingActionState } from '../actions'

/**
 * Client wrapper around the booking confirm action. Uses useActionState so
 * the action's return value (`{ error }`) can render inline below the
 * button — the success path redirects, so we never need to render success
 * state here.
 *
 * Hidden inputs carry the resolved booking parameters from the URL (set
 * by the server-rendered StepReview). Tap-and-wait UX: button shows
 * "Booking…" while the action is in flight.
 */
export function ConfirmForm({
  sessionTypeId,
  staffUserId,
  startIso,
  endIso,
  day,
}: {
  sessionTypeId: string
  staffUserId: string
  startIso: string
  endIso: string
  day: string
}) {
  const [state, formAction, pending] = useActionState(
    confirmBookingActionState,
    { error: null },
  )

  return (
    <form action={formAction}>
      <input type="hidden" name="session_type_id" value={sessionTypeId} />
      <input type="hidden" name="staff_user_id" value={staffUserId} />
      <input type="hidden" name="start_at" value={startIso} />
      <input type="hidden" name="end_at" value={endIso} />
      <input type="hidden" name="day" value={day} />
      <button
        type="submit"
        className="portal-btn-primary"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Booking…' : 'Book session'}
      </button>
      {state.error && (
        <div
          role="alert"
          style={{
            marginTop: 12,
            padding: '10px 12px',
            background: 'rgba(214, 64, 69, 0.06)',
            border: '1px solid rgba(214, 64, 69, 0.25)',
            borderRadius: 'var(--radius-chip)',
            fontSize: '.86rem',
            color: 'var(--color-alert)',
            lineHeight: 1.45,
          }}
        >
          {state.error}
        </div>
      )}
    </form>
  )
}

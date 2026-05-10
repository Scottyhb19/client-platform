'use client'

import { useState, useTransition } from 'react'
import { cancelAppointmentAction } from '../actions'

/**
 * Client-side cancel control. Two-tap flow: first tap reveals a confirm
 * row inline ("Cancel this booking? • Yes, cancel / Keep it"). This is
 * cheaper than a modal on mobile and matches the design system's restraint.
 *
 * The 24-hour cutoff is enforced server-side by the RPC; this component
 * is only rendered when the parent has already determined the booking is
 * outside the window. If the RPC rejects anyway (e.g. because the user
 * left the tab open and the window has since closed), the error string
 * surfaces inline.
 */
export function CancelButton({ appointmentId }: { appointmentId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleCancel() {
    setError(null)
    const fd = new FormData()
    fd.set('appointment_id', appointmentId)
    startTransition(async () => {
      const result = await cancelAppointmentAction(fd)
      if (result.error) {
        setError(result.error)
        setConfirming(false)
      }
      // Success path: server action revalidates /portal/book; the row
      // disappears from the next render. No client-side state work needed.
    })
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: '.86rem',
          color: 'var(--color-alert)',
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Cancel
      </button>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: '.82rem', color: 'var(--color-text-light)' }}>
        {error ?? 'Cancel this booking?'}
      </span>
      <button
        type="button"
        onClick={handleCancel}
        disabled={pending}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: '.86rem',
          color: 'var(--color-alert)',
          fontWeight: 700,
          cursor: pending ? 'wait' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {pending ? 'Cancelling…' : 'Yes, cancel'}
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false)
          setError(null)
        }}
        disabled={pending}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          fontSize: '.86rem',
          color: 'var(--color-muted)',
          fontWeight: 500,
          cursor: pending ? 'wait' : 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Keep it
      </button>
    </div>
  )
}

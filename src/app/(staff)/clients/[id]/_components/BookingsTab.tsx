'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelAppointmentAction } from '../../../schedule/actions'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import {
  formatBookingDateLine,
  formatBookingTimeRange,
} from '@/app/portal/book/new/_lib/format'
import type { ProfileAppointment } from './ClientProfile'

/**
 * §6.1 Bookings tab. Renders this client's appointments (already loaded on the
 * profile) split into upcoming and past, with a cancel affordance on upcoming
 * ones. Reschedule lives on the /schedule grid (drag-to-move) — this surface is
 * history + quick-cancel. All times in the practice timezone (P0-2).
 */
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
  completed: 'Completed',
}

export function BookingsTab({
  appointments,
}: {
  appointments: ProfileAppointment[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const now = Date.now()
  const isUpcoming = (a: ProfileAppointment) =>
    new Date(a.start_at).getTime() >= now &&
    (a.status === 'pending' || a.status === 'confirmed')

  const upcoming = appointments
    .filter(isUpcoming)
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
    )
  const past = appointments
    .filter((a) => !isUpcoming(a))
    .sort(
      (a, b) =>
        new Date(b.start_at).getTime() - new Date(a.start_at).getTime(),
    )

  function handleCancel(a: ProfileAppointment) {
    if (
      !window.confirm(
        `Cancel the ${formatBookingDateLine(a.start_at, PRACTICE_TIMEZONE)} ${a.appointment_type}?`,
      )
    ) {
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await cancelAppointmentAction(a.id, null)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function renderRow(a: ProfileAppointment, cancellable: boolean) {
    const isCancelled = a.status === 'cancelled'
    return (
      <div
        key={a.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 16px',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 10,
          background: 'var(--color-card)',
          opacity: isCancelled ? 0.6 : 1,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: '.95rem',
              color: 'var(--color-text)',
            }}
          >
            {formatBookingDateLine(a.start_at, PRACTICE_TIMEZONE)}
          </div>
          <div
            style={{
              fontSize: '.8rem',
              color: 'var(--color-text-light)',
              marginTop: 1,
            }}
          >
            {formatBookingTimeRange(a.start_at, a.end_at, PRACTICE_TIMEZONE)} ·{' '}
            {a.appointment_type}
          </div>
        </div>
        <span
          style={{
            fontSize: '.66rem',
            fontWeight: 700,
            letterSpacing: '.04em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {STATUS_LABEL[a.status] ?? a.status}
        </span>
        {cancellable && (
          <button
            type="button"
            onClick={() => handleCancel(a)}
            disabled={pending}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-alert)',
              fontFamily: 'var(--font-sans)',
              fontSize: '.8rem',
              fontWeight: 600,
              cursor: pending ? 'wait' : 'pointer',
              padding: '4px 6px',
              whiteSpace: 'nowrap',
            }}
          >
            Cancel
          </button>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '18px 22px 22px', display: 'grid', gap: 18 }}>
      {appointments.length === 0 && (
        <div
          style={{
            fontSize: '.88rem',
            color: 'var(--color-text-light)',
          }}
        >
          No bookings yet.
        </div>
      )}

      {upcoming.length > 0 && (
        <section style={{ display: 'grid', gap: 8 }}>
          <SectionLabel>Upcoming</SectionLabel>
          {upcoming.map((a) => renderRow(a, true))}
        </section>
      )}

      {past.length > 0 && (
        <section style={{ display: 'grid', gap: 8 }}>
          <SectionLabel>Past</SectionLabel>
          {past.map((a) => renderRow(a, false))}
        </section>
      )}

      {error && (
        <div role="alert" style={{ fontSize: '.8rem', color: 'var(--color-alert)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '.64rem',
        fontWeight: 700,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        color: 'var(--color-muted)',
      }}
    >
      {children}
    </div>
  )
}

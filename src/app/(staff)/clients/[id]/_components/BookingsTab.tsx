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
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'

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
  const [confirmCancel, setConfirmCancel] = useState<ProfileAppointment | null>(
    null,
  )
  const [cancelError, setCancelError] = useState<string | null>(null)

  // eslint-disable-next-line react-hooks/purity -- intentional per-render current-time read; the upcoming/past split must reflect the live clock.
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

  // On-system confirm (shared ConfirmDialog) in place of browser confirm();
  // a cancel failure shows inside the dialog so the EP can retry.
  function runCancel() {
    const a = confirmCancel
    if (!a) return
    setCancelError(null)
    startTransition(async () => {
      const res = await cancelAppointmentAction(a.id, null)
      if (res.error) {
        setCancelError(res.error)
        return
      }
      setConfirmCancel(null)
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
            onClick={() => {
              setCancelError(null)
              setConfirmCancel(a)
            }}
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

      {confirmCancel && (
        <ConfirmDialog
          title="Cancel this booking?"
          body={
            <>
              Cancel the{' '}
              {formatBookingDateLine(
                confirmCancel.start_at,
                PRACTICE_TIMEZONE,
              )}{' '}
              {confirmCancel.appointment_type}?
            </>
          }
          confirmLabel="Cancel booking"
          busy={pending}
          error={cancelError}
          onCancel={() => {
            if (pending) return
            setConfirmCancel(null)
            setCancelError(null)
          }}
          onConfirm={runCancel}
        />
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

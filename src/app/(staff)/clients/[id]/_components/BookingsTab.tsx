'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
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
 * profile) as two side-by-side tiles — Past and Upcoming — each with its
 * nearest appointment front-and-centre and a chevron to drop the full list.
 * Reschedule lives on the /schedule grid (drag-to-move); this surface is
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

  // Upcoming sorted soonest-first so upcoming[0] is the closest appointment;
  // past sorted newest-first so past[0] is the most recent. Those two are the
  // "front and centre" headlines of their tiles.
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

  function renderRow(
    a: ProfileAppointment,
    cancellable: boolean,
    topSeparator: boolean,
  ) {
    const isCancelled = a.status === 'cancelled'
    return (
      <div
        key={a.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '11px 4px',
          borderTop: topSeparator
            ? '1px solid var(--color-border-hairline)'
            : 'none',
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
    <div style={{ padding: '18px 22px 22px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 16,
          // Each tile sizes to its own content — without this, grid's default
          // align-items: stretch makes the collapsed tile grow to match the
          // expanded one, leaving dead space beside a dropped-down list.
          alignItems: 'start',
        }}
      >
        <SessionTile
          label="Past"
          emptyText="No past bookings."
          items={past}
          cancellable={false}
          renderRow={renderRow}
        />
        <SessionTile
          label="Upcoming"
          emptyText="No upcoming bookings."
          items={upcoming}
          cancellable={true}
          renderRow={renderRow}
        />
      </div>

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

/**
 * One tile: header (label + count), the nearest appointment front-and-centre,
 * and — when there's more than one — a chevron that drops the full list. Owns
 * its own expand state so Past and Upcoming toggle independently.
 */
function SessionTile({
  label,
  emptyText,
  items,
  cancellable,
  renderRow,
}: {
  label: string
  emptyText: string
  items: ProfileAppointment[]
  cancellable: boolean
  renderRow: (
    a: ProfileAppointment,
    cancellable: boolean,
    topSeparator: boolean,
  ) => React.ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const headline = items[0] ?? null
  const rest = items.slice(1)

  return (
    <section
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <SectionLabel>{label}</SectionLabel>
        {items.length > 0 && (
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '.8rem',
              color: 'var(--color-muted)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {items.length}
          </span>
        )}
      </header>

      {headline === null ? (
        <div
          style={{
            padding: '18px 16px',
            fontSize: '.86rem',
            color: 'var(--color-text-light)',
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div style={{ padding: '6px 12px 10px' }}>
          {renderRow(headline, cancellable, false)}
          {expanded && rest.map((a) => renderRow(a, cancellable, true))}
          {rest.length > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? `Hide the rest of ${label.toLowerCase()} bookings`
                  : `Show all ${items.length} ${label.toLowerCase()} bookings`
              }
              onClick={() => setExpanded((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                width: '100%',
                marginTop: 6,
                padding: '7px 8px',
                border: 'none',
                borderTop: '1px solid var(--color-border-hairline)',
                borderRadius: 0,
                background: 'transparent',
                color: 'var(--color-text-light)',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: '.72rem',
                letterSpacing: '.03em',
                cursor: 'pointer',
                transition: 'color 150ms cubic-bezier(0.4,0,0.2,1)',
              }}
            >
              {expanded ? 'Show less' : `${rest.length} more`}
              {expanded ? (
                <ChevronUp size={15} aria-hidden />
              ) : (
                <ChevronDown size={15} aria-hidden />
              )}
            </button>
          )}
        </div>
      )}
    </section>
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

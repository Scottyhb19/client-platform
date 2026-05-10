import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { StepNav } from './StepNav'
import { formatBookingDayShort, formatBookingTime } from '../_lib/format'

interface Slot {
  staff_user_id: string
  slot_start: string
  slot_end: string
}

interface SessionType {
  id: string
  name: string
  color: string
}

/**
 * Step 3 — pick a time. Vertical list of `.portal-card` chips with the
 * slot's start time. Tap → step 4 (review). When the previous attempt
 * collided with a freshly-booked slot, an inline notice appears at the
 * top — refreshed slot list below it gives the user a clean retry.
 */
export function StepTime({
  sessionType,
  day,
  slots,
  timezone,
  slotTaken,
}: {
  sessionType: SessionType
  day: string
  slots: Slot[]
  timezone: string
  slotTaken: boolean
}) {
  const dayLabel =
    slots.length > 0
      ? formatBookingDayShort(slots[0].slot_start, timezone)
      : day

  const backParams = new URLSearchParams({
    step: 'day',
    type: sessionType.id,
  })

  return (
    <>
      <StepNav
        backHref={`/portal/book/new?${backParams.toString()}`}
        title="Pick a time"
        stepIndex={3}
      />
      <div style={{ padding: '0 16px 4px' }}>
        <div className="portal-eyebrow" style={{ marginBottom: 4 }}>
          {dayLabel}
        </div>
        <div
          style={{
            fontSize: '.86rem',
            color: 'var(--color-text-light)',
            marginBottom: 12,
          }}
        >
          {sessionType.name}
        </div>
      </div>

      {slotTaken && (
        <div
          style={{
            margin: '0 16px 12px',
            padding: '12px 14px',
            background: 'rgba(232, 163, 23, 0.1)',
            border: '1px solid rgba(232, 163, 23, 0.4)',
            borderRadius: 'var(--radius-chip)',
            fontSize: '.86rem',
            color: 'var(--color-text)',
            lineHeight: 1.45,
          }}
        >
          That time was just taken. Pick another from the refreshed list below.
        </div>
      )}

      <div style={{ padding: '0 16px 24px' }}>
        {slots.length === 0 ? (
          <div
            className="portal-card"
            style={{
              padding: '20px 16px',
              textAlign: 'center',
              color: 'var(--color-text-light)',
            }}
          >
            No times open on this day. Tap back and pick another.
          </div>
        ) : (
          slots.map((s) => {
            const params = new URLSearchParams({
              step: 'review',
              type: sessionType.id,
              day,
              start: s.slot_start,
              end: s.slot_end,
              staff: s.staff_user_id,
            })
            return (
              <Link
                key={`${s.slot_start}-${s.staff_user_id}`}
                href={`/portal/book/new?${params.toString()}`}
                className="portal-card is-compact"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '14px 16px',
                  marginBottom: 6,
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: 'var(--color-charcoal)',
                    flex: 1,
                  }}
                >
                  {formatBookingTime(s.slot_start, timezone)}
                </div>
                <ChevronRight
                  size={18}
                  strokeWidth={2}
                  aria-hidden
                  style={{ color: 'var(--color-text-light)' }}
                />
              </Link>
            )
          })
        )}
      </div>
    </>
  )
}

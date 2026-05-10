import { StepNav } from './StepNav'
import {
  formatBookingDateLine,
  formatBookingTimeRange,
} from '../_lib/format'
import { ConfirmForm } from './ConfirmForm'

interface SessionType {
  id: string
  name: string
  color: string
}

/**
 * Step 4 — review and confirm. Single card summarising the chosen type,
 * day, and time, with a primary "Book session" button submitting a form
 * action. The action calls the client_book_appointment RPC; on success
 * it redirects to /portal/book?booked=1.
 *
 * On 'slot no longer available' the action redirects back to step 3 with
 * ?error=slot-taken so this component does not need to render any error
 * state — the user lands back on the time picker with refreshed slots.
 */
export function StepReview({
  sessionType,
  day,
  startIso,
  endIso,
  staffUserId,
  timezone,
}: {
  sessionType: SessionType
  day: string
  startIso: string
  endIso: string
  staffUserId: string
  timezone: string
}) {
  const dateLine = formatBookingDateLine(startIso, timezone)
  const timeLine = formatBookingTimeRange(startIso, endIso, timezone)

  const backParams = new URLSearchParams({
    step: 'time',
    type: sessionType.id,
    day,
  })

  return (
    <>
      <StepNav
        backHref={`/portal/book/new?${backParams.toString()}`}
        title="Review and book"
        stepIndex={4}
      />
      <div style={{ padding: '0 16px 24px' }}>
        <div
          className="portal-card"
          style={{
            padding: '20px 18px',
            marginBottom: 12,
            borderLeft: `4px solid ${sessionType.color}`,
          }}
        >
          <SummaryRow label="Type" value={sessionType.name} />
          <SummaryRow label="Date" value={dateLine} />
          <SummaryRow label="Time" value={timeLine} />
        </div>

        <ConfirmForm
          sessionTypeId={sessionType.id}
          staffUserId={staffUserId}
          startIso={startIso}
          endIso={endIso}
          day={day}
        />

        <p
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            margin: '14px 4px 0',
            lineHeight: 1.5,
          }}
        >
          You can cancel up to 24 hours before the session. Inside that window,
          message your EP through the portal.
        </p>
      </div>
    </>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr',
        gap: 10,
        padding: '6px 0',
      }}
    >
      <div className="portal-eyebrow">{label}</div>
      <div
        style={{
          fontSize: '.95rem',
          color: 'var(--color-charcoal)',
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  )
}

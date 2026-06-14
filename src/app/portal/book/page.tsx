import Link from 'next/link'
import { Plus } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PortalEmpty, PortalTop } from '../_components/PortalTop'
import { CancelButton } from './_components/CancelButton'
import {
  formatBookingDateLine,
  formatBookingTimeRange,
} from './new/_lib/format'

export const dynamic = 'force-dynamic'

/**
 * /portal/book — upcoming bookings view + entry to the picker.
 *
 * Lists the caller's confirmed/pending appointments with start_at >= now()
 * sorted ascending. Each row shows date + time + type + (Cancel | Message
 * your EP) depending on whether the start is more than 24 hours away.
 *
 * Empty state when there are no upcoming bookings — single CTA "Book a
 * session" jumps to /portal/book/new.
 *
 * The optional ?booked=1 query param renders a brief success notice — set
 * by the booking-confirm action's redirect.
 */
export default async function PortalBookPage({
  searchParams,
}: {
  searchParams: Promise<{ booked?: string }>
}) {
  const params = await searchParams
  const justBooked = params.booked === '1'

  const supabase = await createSupabaseServerClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('timezone, phone')
    .maybeSingle()
  const timezone = org?.timezone ?? 'Australia/Sydney'
  const practicePhone = org?.phone?.trim() || null

  const nowIso = new Date().toISOString()
  const { data: rows } = await supabase
    .from('appointments')
    .select(
      `id, start_at, end_at, appointment_type, location, status`,
    )
    .gte('start_at', nowIso)
    .neq('status', 'cancelled')
    .is('deleted_at', null)
    .order('start_at', { ascending: true })

  const upcoming = rows ?? []

  return (
    <>
      <PortalTop title="Bookings" greeting="Your sessions" />

      {justBooked && (
        <div
          role="status"
          style={{
            margin: '0 16px 12px',
            padding: '12px 14px',
            background: 'rgba(45, 178, 76, 0.08)',
            border: '1px solid rgba(45, 178, 76, 0.4)',
            borderRadius: 'var(--radius-chip)',
            fontSize: '.86rem',
            color: 'var(--color-text)',
            lineHeight: 1.45,
          }}
        >
          Booked. We&rsquo;ve sent a confirmation to your email and will remind
          you 24 hours before.
        </div>
      )}

      {upcoming.length === 0 ? (
        <>
          <PortalEmpty
            title="No bookings yet"
            message="When you book a session it'll show up here. Tap the button below to find a time."
          />
          <div style={{ padding: '0 16px 24px' }}>
            <Link href="/portal/book/new" className="portal-btn-primary">
              Book a session
            </Link>
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: '0 16px 24px' }}>
            {upcoming.map((appt) => {
              const startMs = new Date(appt.start_at).getTime()
              const hoursAway = (startMs - Date.now()) / (1000 * 60 * 60)
              const canCancel = hoursAway >= 24

              return (
                <div
                  key={appt.id}
                  className="portal-card"
                  style={{
                    padding: '16px 18px',
                    marginBottom: 10,
                  }}
                >
                  <div className="portal-eyebrow" style={{ marginBottom: 4 }}>
                    {appt.appointment_type}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: '1.05rem',
                      color: 'var(--color-charcoal)',
                      lineHeight: 1.2,
                    }}
                  >
                    {formatBookingDateLine(appt.start_at, timezone)}
                  </div>
                  <div
                    style={{
                      fontSize: '.92rem',
                      color: 'var(--color-text)',
                      marginTop: 2,
                    }}
                  >
                    {formatBookingTimeRange(
                      appt.start_at,
                      appt.end_at,
                      timezone,
                    )}
                  </div>
                  {appt.location && (
                    <div
                      style={{
                        fontSize: '.82rem',
                        color: 'var(--color-text-light)',
                        marginTop: 4,
                      }}
                    >
                      {appt.location}
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: '1px solid var(--color-border-subtle)',
                    }}
                  >
                    {canCancel ? (
                      <CancelButton appointmentId={appt.id} />
                    ) : (
                      <p
                        style={{
                          margin: 0,
                          fontSize: '.86rem',
                          lineHeight: 1.5,
                          color: 'var(--color-text-light)',
                        }}
                      >
                        {practicePhone
                          ? `Please call the practice on ${practicePhone} to cancel this session as it is within 24 hours.`
                          : 'Please call the practice to cancel this session as it is within 24 hours.'}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}

            <Link
              href="/portal/book/new"
              className="portal-btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                marginTop: 6,
              }}
            >
              <Plus size={18} strokeWidth={2.25} aria-hidden />
              Book another session
            </Link>
          </div>
        </>
      )}
    </>
  )
}

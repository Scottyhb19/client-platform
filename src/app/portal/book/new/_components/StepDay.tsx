import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { StepNav } from './StepNav'
import { formatBookingDayShort, isoDateInTz } from '../_lib/format'

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
 * Step 2 — pick a day. Groups the next four weeks of slots by date in the
 * org timezone, renders one card per date with at least one open slot,
 * shows the count of open slots.
 *
 * Days with no slots are not rendered. (Showing them as disabled would
 * read as "we have nothing to offer this week" which is technically true
 * but bad copy. The shorter list is honest.)
 */
export function StepDay({
  sessionType,
  slots,
  timezone,
}: {
  sessionType: SessionType
  slots: Slot[]
  timezone: string
}) {
  // Group by ISO date (in org tz) preserving slot count.
  const dayCounts = new Map<string, { count: number; firstStart: string }>()
  for (const slot of slots) {
    const key = isoDateInTz(slot.slot_start, timezone)
    const existing = dayCounts.get(key)
    if (existing) {
      existing.count += 1
    } else {
      dayCounts.set(key, { count: 1, firstStart: slot.slot_start })
    }
  }

  const days = Array.from(dayCounts.entries())
    .map(([dayKey, info]) => ({
      dayKey,
      count: info.count,
      firstStart: info.firstStart,
    }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey))

  const backHref = '/portal/book/new'

  return (
    <>
      <StepNav backHref={backHref} title="Pick a day" stepIndex={2} />
      <div style={{ padding: '0 16px 4px' }}>
        <div
          className="portal-eyebrow"
          style={{ marginBottom: 10, color: sessionType.color }}
        >
          {sessionType.name}
        </div>
      </div>
      <div style={{ padding: '0 16px 24px' }}>
        {days.map((d) => {
          const params = new URLSearchParams({
            step: 'time',
            type: sessionType.id,
            day: d.dayKey,
          })
          const dayLabel = formatBookingDayShort(d.firstStart, timezone)
          return (
            <Link
              key={d.dayKey}
              href={`/portal/book/new?${params.toString()}`}
              className="portal-card is-compact"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '16px',
                marginBottom: 8,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '1rem',
                    color: 'var(--color-charcoal)',
                  }}
                >
                  {dayLabel}
                </div>
                <div
                  style={{
                    fontSize: '.78rem',
                    color: 'var(--color-text-light)',
                    marginTop: 2,
                  }}
                >
                  {d.count === 1 ? '1 time available' : `${d.count} times available`}
                </div>
              </div>
              <ChevronRight
                size={18}
                strokeWidth={2}
                aria-hidden
                style={{ color: 'var(--color-text-light)' }}
              />
            </Link>
          )
        })}
      </div>
    </>
  )
}

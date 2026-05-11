'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { sameCalendarDay, type WeekDot } from '../_lib/portal-helpers'

// WeekDot is the type for the strip of seven dots across the top of the
// portal Today screen. Defined in portal-helpers (a non-client module) so
// the server page can call buildWeekDots while this client component just
// renders. Re-exported here so existing import sites (page.tsx) keep
// working until they migrate to the helpers import.
export type { WeekDot }

export type TodaySessionExercise = {
  id: string
  letter: string
  name: string
  rx: string
  // Tone names match the .portal-seq[data-tone] selectors in globals.css.
  // Renamed in Phase B from the misleading charcoal/primary/accent/amber
  // (the original "amber" never rendered amber). New names describe what
  // the bubble actually looks like.
  tone: 'default' | 'muted' | 'parchment' | 'outline'
}

export type TodaySession = {
  dayId: string
  dayLabel: string
  dayTitle: string // e.g. "Day C — Full Body"
  metaLine: string // e.g. "6 exercises · Block 2, Wk 3"
  exercises: TodaySessionExercise[]
}


interface TodayScreenProps {
  greeting: string
  name: string
  weekHeading: string // "Sat 18 Apr · Week 3"
  weekDots: WeekDot[] // exactly 7
  session: TodaySession | null
  weekStats: {
    completed: number
    remaining: number
    avgRpe: number | null
  }
  // Week navigation chrome.
  monthLabel: string // "April 2026"
  prevWeekHref: string // "/portal?w=2026-04-13"
  nextWeekHref: string // "/portal?w=2026-04-27"
  isCurrentWeek: boolean // hides "back to today" pill when true
  backToTodayHref: string // "/portal"
}

export function TodayScreen({
  greeting,
  name,
  weekHeading,
  weekDots,
  session,
  weekStats,
  monthLabel,
  prevWeekHref,
  nextWeekHref,
  isCurrentWeek,
  backToTodayHref,
}: TodayScreenProps) {
  const todayIdx = weekDots.findIndex((d) =>
    sameCalendarDay(d.date, new Date()),
  )
  const [selectedIdx, setSelectedIdx] = useState(
    todayIdx >= 0 ? todayIdx : 0,
  )

  return (
    <>
      {/* Top greeting */}
      <div style={{ padding: '18px 20px 16px' }}>
        <div className="portal-eyebrow">{weekHeading}</div>
        <h1
          // Hero h1 keeps its own sizing — not a primitive worth extracting
          // for one consumer. Promote if a second hero appears.
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.5rem',
            margin: '2px 0 0',
            letterSpacing: '-.01em',
            lineHeight: 1.1,
          }}
        >
          {greeting}, {name}.
        </h1>
      </div>

      {/* Week strip nav — month label + prev/next chevrons. Mirrors the
          .week-strip-nav block in the client-portal.html prototype. The
          "Back to today" pill appears only when the user has navigated
          away from the current week. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px 8px',
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.92rem',
            color: 'var(--color-charcoal)',
          }}
        >
          {monthLabel}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {!isCurrentWeek && (
            <Link
              href={backToTodayHref}
              style={{
                fontSize: '.7rem',
                fontWeight: 600,
                color: 'var(--color-text-light)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-subtle)',
                padding: '4px 10px',
                borderRadius: 999,
                textDecoration: 'none',
              }}
            >
              Back to today
            </Link>
          )}
          <Link
            href={prevWeekHref}
            aria-label="Previous week"
            style={weekArrowStyle}
          >
            <ChevronLeft size={14} aria-hidden />
          </Link>
          <Link
            href={nextWeekHref}
            aria-label="Next week"
            style={weekArrowStyle}
          >
            <ChevronRight size={14} aria-hidden />
          </Link>
        </div>
      </div>

      {/* Week strip — cells with a programmed (published) day for the
          caller render as Links into the Logger for that day; rest days
          stay as inert buttons that update the local selection highlight
          (the existing pre-navigation idiom). */}
      <div className="portal-week-strip">
        {weekDots.map((d, i) => {
          const sel = i === selectedIdx
          const cls = `portal-day-cell${sel ? ' is-selected' : ''}`
          const inner = (
            <>
              <span className="portal-day-cell__weekday">
                {weekdayShort(d.date)}
              </span>
              <span className="portal-day-cell__date">{d.date.getDate()}</span>
              {d.dayLabel && (
                <span className="portal-day-cell__tag">{d.dayLabel}</span>
              )}
              {/* Green dot signals "session programmed today" at a glance,
                  per the client-portal.html prototype's .has-session::after
                  pattern. Renders for any state except 'rest' — the tag
                  above refines which day variant; the dot is the primary
                  visual cue. */}
              {d.state !== 'rest' && (
                <span className="portal-day-cell__dot" />
              )}
            </>
          )
          return d.dayId ? (
            <Link
              key={i}
              href={`/portal/session/${d.dayId}`}
              className={cls}
            >
              {inner}
            </Link>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedIdx(i)}
              className={cls}
            >
              {inner}
            </button>
          )
        })}
      </div>

      {/* Session card (or rest-day empty) */}
      {session ? (
        <div
          className="portal-card"
          style={{ margin: '0 16px 16px', overflow: 'hidden' }}
        >
          <div
            // Internal card header — padding + bottom divider. Not a
            // primitive; the .portal-card primitive deliberately leaves
            // internal layout to consumers.
            style={{
              padding: '16px 18px 12px',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <div
              className="portal-eyebrow"
              // Override muted → primary: the day label is the active
              // anchor of the card, not a quiet sub-label.
              style={{ color: 'var(--color-primary)' }}
            >
              {session.dayLabel}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.3rem',
                color: 'var(--color-charcoal)',
                margin: '2px 0 0',
              }}
            >
              {session.dayTitle}
            </div>
            <div
              style={{
                fontSize: '.76rem',
                color: 'var(--color-text-light)',
                marginTop: 2,
              }}
            >
              {session.metaLine}
            </div>
          </div>
          <div style={{ padding: '8px 18px' }}>
            {session.exercises.length === 0 ? (
              <div
                style={{
                  padding: '14px 0',
                  fontSize: '.84rem',
                  color: 'var(--color-muted)',
                }}
              >
                No exercises assigned yet. Check back soon.
              </div>
            ) : (
              session.exercises.map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 0',
                    // Internal card divider — 4% black is intentionally
                    // lighter than --color-border-hairline. Stays inline.
                    borderBottom: '1px solid rgba(0,0,0,.04)',
                  }}
                >
                  <span className="portal-seq" data-tone={e.tone}>
                    {e.letter}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontWeight: 600,
                      fontSize: '.88rem',
                    }}
                  >
                    {e.name}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: '.82rem',
                      color: 'var(--color-text-light)',
                    }}
                  >
                    {e.rx}
                  </span>
                </div>
              ))
            )}
          </div>
          <div style={{ padding: '12px 16px 16px' }}>
            <Link
              href={`/portal/session/${session.dayId}`}
              className="portal-btn-primary"
            >
              Begin session
            </Link>
          </div>
        </div>
      ) : (
        <div className="portal-empty is-rest-day">
          <div className="portal-empty__title">Rest day</div>
          <div className="portal-empty__body">
            Nothing scheduled. Recovery is part of the plan — hydrate, walk,
            sleep.
          </div>
        </div>
      )}

      {/* This week stats */}
      <div style={{ padding: '0 16px 24px', marginTop: 6 }}>
        <div className="portal-eyebrow" style={{ marginBottom: 8 }}>
          This week
        </div>
        <div
          style={{
            display: 'flex',
            gap: 16,
            fontSize: '.82rem',
            color: 'var(--color-text)',
          }}
        >
          <div className="portal-stat" data-tone="primary">
            <span className="portal-stat__big">{weekStats.completed}</span>
            <span className="portal-stat__label">Completed</span>
          </div>
          <div className="portal-stat">
            <span className="portal-stat__big">{weekStats.remaining}</span>
            <span className="portal-stat__label">Remaining</span>
          </div>
          <div className="portal-stat" data-tone="accent">
            <span className="portal-stat__big">
              {weekStats.avgRpe !== null
                ? `RPE ${weekStats.avgRpe.toFixed(1)}`
                : '—'}
            </span>
            <span className="portal-stat__label">Avg</span>
          </div>
        </div>
      </div>
    </>
  )
}

function weekdayShort(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'narrow' })
}

// Shared style for the prev/next week chevron buttons. Same posture as the
// prototype's .week-arrow: 28×28, hairline border, parchment background,
// muted icon colour.
const weekArrowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  background: 'var(--color-card)',
  color: 'var(--color-text-light)',
  textDecoration: 'none',
}

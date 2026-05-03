'use client'

import Link from 'next/link'
import { useState } from 'react'
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
  tone: 'charcoal' | 'primary' | 'accent' | 'amber'
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
}

export function TodayScreen({
  greeting,
  name,
  weekHeading,
  weekDots,
  session,
  weekStats,
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
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
          }}
        >
          {weekHeading}
        </div>
        <h1
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

      {/* Week strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 6,
          padding: '6px 16px 14px',
        }}
      >
        {weekDots.map((d, i) => {
          const sel = i === selectedIdx
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelectedIdx(i)}
              style={{
                padding: '10px 0',
                background: sel ? 'var(--color-charcoal)' : '#fff',
                border: `1px solid ${sel ? 'var(--color-charcoal)' : 'var(--color-border-subtle)'}`,
                borderRadius: 10,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                minHeight: 68,
              }}
            >
              <span
                style={{
                  fontSize: '.66rem',
                  fontWeight: 600,
                  color: sel
                    ? 'rgba(255,255,255,.6)'
                    : 'var(--color-muted)',
                  letterSpacing: '.04em',
                }}
              >
                {weekdayShort(d.date)}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: sel ? '#fff' : 'var(--color-charcoal)',
                }}
              >
                {d.date.getDate()}
              </span>
              {d.dayLabel && (
                <span
                  style={{
                    fontSize: '.58rem',
                    fontWeight: 700,
                    color: sel
                      ? 'var(--color-accent)'
                      : 'var(--color-primary)',
                    background: sel
                      ? 'rgba(45,178,76,.15)'
                      : 'rgba(45,178,76,.1)',
                    padding: '1px 5px',
                    borderRadius: 4,
                  }}
                >
                  {d.dayLabel}
                </span>
              )}
              {d.state === 'done' && !d.dayLabel && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--color-accent)',
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Session card (or rest-day empty) */}
      {session ? (
        <div
          style={{
            margin: '0 16px 16px',
            background: '#fff',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 14,
            boxShadow: '0 1px 3px rgba(0,0,0,.06)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '16px 18px 12px',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.7rem',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--color-primary)',
              }}
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
                    borderBottom: '1px solid rgba(0,0,0,.04)',
                  }}
                >
                  <Seq letter={e.letter} tone={e.tone} />
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
              style={{
                width: '100%',
                display: 'block',
                textAlign: 'center',
                padding: 16,
                background: 'var(--color-primary)',
                color: '#fff',
                borderRadius: 12,
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.1rem',
                letterSpacing: '.02em',
                textDecoration: 'none',
              }}
            >
              Begin session
            </Link>
          </div>
        </div>
      ) : (
        <div
          style={{
            margin: '0 16px 16px',
            background: '#fff',
            border: '1px dashed var(--color-border-subtle)',
            borderRadius: 14,
            padding: '32px 20px',
            textAlign: 'center',
            color: 'var(--color-text-light)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
              marginBottom: 4,
            }}
          >
            Rest day
          </div>
          <div style={{ fontSize: '.86rem', lineHeight: 1.5 }}>
            Nothing scheduled. Recovery is part of the plan — hydrate, walk,
            sleep.
          </div>
        </div>
      )}

      {/* This week stats */}
      <div style={{ padding: '0 16px 24px', marginTop: 6 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.72rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-muted)',
            marginBottom: 8,
          }}
        >
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
          <Stat
            big={String(weekStats.completed)}
            label="Completed"
            tone="primary"
          />
          <Stat
            big={String(weekStats.remaining)}
            label="Remaining"
            tone="neutral"
          />
          <Stat
            big={
              weekStats.avgRpe !== null
                ? `RPE ${weekStats.avgRpe.toFixed(1)}`
                : '—'
            }
            label="Avg"
            tone="accent"
          />
        </div>
      </div>
    </>
  )
}

function Stat({
  big,
  label,
  tone,
}: {
  big: string
  label: string
  tone: 'primary' | 'neutral' | 'accent'
}) {
  const color =
    tone === 'primary'
      ? 'var(--color-primary)'
      : tone === 'accent'
        ? 'var(--color-accent)'
        : 'var(--color-charcoal)'
  return (
    <div>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          fontSize: '1.4rem',
          color,
          display: 'block',
        }}
      >
        {big}
      </span>
      {label}
    </div>
  )
}

function Seq({
  letter,
  tone,
}: {
  letter: string
  tone: 'charcoal' | 'primary' | 'accent' | 'amber'
}) {
  const styles = {
    charcoal: { bg: 'var(--color-primary)', color: '#fff' },
    primary: { bg: '#78746F', color: '#fff' },
    accent: { bg: '#D9D2C8', color: 'var(--color-text)' },
    amber: {
      bg: 'var(--color-surface-2)',
      color: 'var(--color-text)',
      ring: true,
    },
  } as const
  const s = styles[tone]
  return (
    <span
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '.78rem',
        color: s.color,
        background: s.bg,
        boxShadow:
          'ring' in s && s.ring
            ? 'inset 0 0 0 1px var(--color-border-subtle)'
            : undefined,
        width: 26,
        height: 26,
        borderRadius: '50%',
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        letterSpacing: '.02em',
      }}
    >
      {letter}
    </span>
  )
}

function weekdayShort(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'narrow' })
}


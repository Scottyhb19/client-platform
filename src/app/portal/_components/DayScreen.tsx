'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react'
import { rescheduleAndStartSessionAction } from '../session/[dayId]/actions'
import {
  type DayState,
  type WeekDot,
} from '../_lib/portal-helpers'

// Re-exported so existing import sites (page.tsx) keep working through the
// rename. Phase K (2026-05-13) renamed TodayScreen → DayScreen to match
// what the component now renders — the selected day's view, which is
// often not today.
export type { WeekDot }

export type DaySessionExercise = {
  id: string
  letter: string
  name: string
  rx: string
  // Tone names match the .portal-seq[data-tone] selectors in globals.css.
  tone: 'default' | 'muted' | 'parchment' | 'outline'
}

export type DaySession = {
  dayId: string
  dayLabel: string
  dayTitle: string // e.g. "Day C — Full Body"
  metaLine: string // e.g. "6 exercises · Block 2, Wk 3"
  exercises: DaySessionExercise[]
  // Discriminated state machine (computed server-side in page.tsx).
  // Drives which CTA renders below the exercise list and whether the
  // exercise list itself is dimmed (past-skipped).
  state: DayState
}

interface DayScreenProps {
  greeting: string
  name: string
  weekHeading: string // "Sat 18 Apr · Week 3"
  weekDots: WeekDot[] // exactly 7
  session: DaySession | null
  weekStats: {
    completed: number
    remaining: number
  }
  // Week navigation chrome.
  monthLabel: string // "April 2026"
  prevWeekHref: string // "/portal?w=2026-04-13"
  nextWeekHref: string // "/portal?w=2026-04-27"
  isCurrentWeek: boolean // hides "back to today" pill when true
  backToTodayHref: string // "/portal"
  // ISO YYYY-MM-DD of the selected day; used to highlight the right
  // strip cell on first paint (server-driven; no client-side derivation).
  // Empty string falls back to "today's cell" so a stray ?d= miss reads
  // as "no selection."
  selectedDayIso: string
  // ISO `YYYY-MM-DD` of "today" in the device/org timezone (section 7 /
  // P0-1) — the first-paint strip-highlight fallback uses this instead of a
  // client-side `new Date()`, which could disagree with the server's
  // tz-anchored today (a hydration split) and rendered the wrong cell.
  todayIso: string
  // C-9: true only for a client with no client-visible program (any
  // status) and no sessions ever — computed server-side in page.tsx.
  // Swaps the empty-card slot from "Rest day" (false for a client with
  // no plan) to the first-run welcome card. A programmed client on a
  // rest day never sees this; their firstRun is always false.
  firstRun: boolean
  // ISO YYYY-MM-DD per strip cell (one per dot). Phase K (Q-K7): every
  // cell navigates — programmed and rest days alike — to /portal?d=<iso>
  // so the card swaps in place rather than leaving the strip decorative.
  // Carries the week token too so navigating across weeks doesn't lose
  // the user's place on the strip.
  cellHrefs: string[] // one per weekDots entry; same index
}

export function DayScreen({
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
  selectedDayIso,
  todayIso,
  cellHrefs,
  firstRun,
}: DayScreenProps) {
  // First-paint selected index — derived from the server-provided ISO so
  // the highlight is correct before any client-side hook runs. Falls back
  // to today's cell if selectedDayIso doesn't match any dot.
  const selectedIdx = (() => {
    const idx = weekDots.findIndex((d) => isoOf(d.date) === selectedDayIso)
    if (idx >= 0) return idx
    const todayIdx = weekDots.findIndex((d) => isoOf(d.date) === todayIso)
    return todayIdx >= 0 ? todayIdx : 0
  })()

  return (
    <>
      {/* Top greeting */}
      <div style={{ padding: '18px 20px 16px' }}>
        <div className="portal-eyebrow">{weekHeading}</div>
        <h1
          // Hero h1 keeps its own sizing — not a primitive worth extracting
          // for one consumer.
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

      {/* Week strip nav — month label + prev/next chevrons. */}
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

      {/* Week strip — Phase K: every cell is a <Link> to /portal?d=<iso>.
          Programmed and rest days alike. The card below swaps in place. */}
      <div className="portal-week-strip">
        {weekDots.map((d, i) => {
          const sel = i === selectedIdx
          const cls = `portal-day-cell${sel ? ' is-selected' : ''}`
          return (
            <Link key={i} href={cellHrefs[i] ?? '/portal'} className={cls}>
              <span className="portal-day-cell__weekday">
                {weekdayShort(d.date)}
              </span>
              <span className="portal-day-cell__date">{d.date.getDate()}</span>
              {d.dayLabel && (
                <span className="portal-day-cell__tag">{d.dayLabel}</span>
              )}
              {/* Green dot — single semantic per Q-K5: "session here." */}
              {d.state !== 'rest' && (
                <span className="portal-day-cell__dot" />
              )}
            </Link>
          )
        })}
      </div>

      {/* Card surface — discriminated render by session.state.kind.
          C-9: the no-session slot splits on firstRun — a brand-new client
          (no program ever, no sessions ever) gets the welcome card; every
          other no-session render keeps the rest-day card. Solid border
          (no is-rest-day dash): this is a state card, not a calendar gap. */}
      {session ? (
        <DayCard session={session} />
      ) : firstRun ? (
        <div className="portal-empty">
          <ClipboardList
            size={28}
            strokeWidth={2}
            color="var(--color-text-light)"
            aria-hidden
            style={{ marginBottom: 8 }}
          />
          <div className="portal-empty__title">Welcome to Odyssey.</div>
          <div className="portal-empty__body">
            {"Your practitioner is building your program. It'll appear right here when it's ready."}
          </div>
        </div>
      ) : (
        <div className="portal-empty is-rest-day">
          <div className="portal-empty__title">Rest day</div>
          <div className="portal-empty__body">
            Nothing scheduled, {name}. Recovery is part of the plan — hydrate,
            walk, sleep.
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
        </div>
      </div>
    </>
  )
}

/* ============================================================================
 * DayCard
 *
 * The per-day card surface for a programmed day. Renders header (eyebrow +
 * title + meta), exercise list, and a state-appropriate CTA at the bottom.
 *
 * Past-skipped is the only state that dims the exercise list (60% opacity
 * per Q-K4 (a)) — every other state shows the full-strength list because
 * the client either has done the work, is about to, or is reading ahead.
 *
 * The future-scheduled state is the only state that mounts a confirm
 * dialog (the EP-locked verbatim copy). Native confirm() would corrupt the
 * copy on iOS (system alert chrome prefixes the page URL), so this is a
 * styled .portal-card overlay with two CTAs per Q-K3.iii.
 * ============================================================================ */
function DayCard({ session }: { session: DaySession }) {
  const dim = session.state.kind === 'past-skipped'
  return (
    <div
      className="portal-card"
      style={{ margin: '0 16px 16px', overflow: 'hidden' }}
    >
      <div
        // Internal card header — padding + bottom divider.
        style={{
          padding: '16px 18px 12px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          className="portal-eyebrow"
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
      <div style={{ padding: '8px 18px', opacity: dim ? 0.6 : 1 }}>
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
                // 4% black is intentionally lighter than --color-border-
                // hairline. Stays inline — internal-only divider.
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
        <DayCtaRow session={session} />
      </div>
    </div>
  )
}

/**
 * Renders one of seven CTA rows based on session.state.kind. Exhaustive
 * switch — TypeScript flags any new state.kind added to DayState that
 * isn't handled here.
 */
function DayCtaRow({ session }: { session: DaySession }) {
  const dayId = session.dayId
  const state = session.state

  switch (state.kind) {
    case 'today-not-started':
      return (
        <Link href={`/portal/session/${dayId}`} className="portal-btn-primary">
          Begin session
        </Link>
      )
    case 'today-in-progress':
      return (
        <Link href={`/portal/session/${dayId}`} className="portal-btn-primary">
          Resume session
        </Link>
      )
    case 'today-completed':
      return (
        <Link
          href={`/portal/session/${dayId}/complete`}
          className="portal-btn-primary"
        >
          Session complete · view summary
        </Link>
      )
    case 'past-completed':
      return (
        <Link
          href={`/portal/session/${dayId}/complete`}
          className="portal-btn-primary"
        >
          View summary
        </Link>
      )
    case 'past-skipped':
      // Phase K addendum (2026-05-13): EP requested that past-skipped
      // sessions be actionable rather than inert. The recovery framing
      // is "Move to today" — same backend operation as future-scheduled's
      // "Begin session early" (reschedule + start), just from a different
      // direction. Without this, a client who missed a session could
      // only recover it by surrendering a future day.
      return (
        <RescheduleToTodayCta
          dayId={dayId}
          buttonLabel="Move to today"
          confirmMessage="Move this session to today and start it now?"
          confirmCtaLabel="Yes, move it"
          preLabel={null}
          postNote={
            <div
              style={{
                fontSize: '.78rem',
                color: 'var(--color-text-light)',
                textAlign: 'center',
                marginTop: 10,
                lineHeight: 1.5,
              }}
            >
              Or{' '}
              <Link
                href="/portal/messages"
                style={{
                  color: 'var(--color-primary)',
                  textDecoration: 'underline',
                }}
              >
                message your EP
              </Link>{' '}
              for a different fix.
            </div>
          }
        />
      )
    case 'future-scheduled':
      return (
        <RescheduleToTodayCta
          dayId={dayId}
          buttonLabel="Begin session early"
          // EP-locked verbatim copy (chat 2026-05-13). Do not rephrase.
          confirmMessage="Are you sure you want to move this session to today, it will no longer be available to complete on this day?"
          confirmCtaLabel="Yes, move it"
          preLabel={`Scheduled for ${state.scheduledLabel}`}
          postNote={null}
        />
      )
    case 'rest-day':
      // Programmed-day card with rest-day state — shouldn't reach here;
      // page.tsx hands session=null on rest days and the screen renders
      // the PortalEmpty above. Defensive empty.
      return null
  }
}

/**
 * Generalised reschedule-to-today CTA. Used by two `DayState.kind` cases:
 *
 *   future-scheduled  → "Begin session early"  (forward-move to today)
 *   past-skipped      → "Move to today"        (recovery-move to today)
 *
 * Both do the same backend operation (reschedule the program_day's
 * scheduled_date to today, then start a session). The two cases differ
 * only in presentation:
 *   - preLabel  — "Scheduled for {date}" (future) vs nothing (past-skipped)
 *   - buttonLabel — "Begin session early" vs "Move to today"
 *   - confirmMessage — EP-locked future copy vs the recovery framing
 *   - postNote — nothing (future) vs "or message your EP" link (past-skipped)
 *
 * Styled overlay rather than native confirm() per Q-K3.iii: native
 * confirm() on iOS shows the page URL in the prompt, which would corrupt
 * the EP-locked verbatim copy display. The overlay is one .portal-card
 * with two stacked CTAs — minimal but consistent with the design system.
 */
function RescheduleToTodayCta({
  dayId,
  buttonLabel,
  confirmMessage,
  confirmCtaLabel,
  preLabel,
  postNote,
}: {
  dayId: string
  buttonLabel: string
  confirmMessage: string
  confirmCtaLabel: string
  // Caption above the primary button. e.g. "Scheduled for Thu 14 May".
  // null = no caption (past-skipped doesn't need one — the eyebrow on
  // the card header already says when the day was).
  preLabel: string | null
  // Optional supplemental copy below the primary button (e.g. the
  // "Or message your EP" link for the past-skipped case). null = nothing.
  postNote: React.ReactNode | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const handleConfirm = () => {
    setError(null)
    startTransition(async () => {
      const { sessionId, error } =
        await rescheduleAndStartSessionAction(dayId)
      if (error || !sessionId) {
        setError(error ?? 'Could not start this session.')
        return
      }
      // Land in the Logger. The day's scheduled_date is now today, so
      // the route resolves normally; the Phase I page-level completion
      // guard won't fire because no completed session exists for this
      // program_day yet.
      router.push(`/portal/session/${dayId}`)
    })
  }

  return (
    <>
      {preLabel && (
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            textAlign: 'center',
            marginBottom: 10,
          }}
        >
          {preLabel}
        </div>
      )}
      <button
        type="button"
        className="portal-btn-primary"
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </button>
      {postNote}

      {open && (
        <ConfirmOverlay
          message={confirmMessage}
          confirmLabel={pending ? 'Moving session…' : confirmCtaLabel}
          cancelLabel="Cancel"
          confirmDisabled={pending}
          error={error}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (pending) return
            setOpen(false)
            setError(null)
          }}
        />
      )}
    </>
  )
}

/**
 * Centred modal overlay with two stacked CTAs and an optional error line.
 * Inline-styled (one consumer, one use case) — promote to globals.css if
 * a second consumer appears. Uses --color-overlay for the dim if defined;
 * otherwise a tokenless 50% black (the only place a non-token rgba lives
 * in the portal, intentionally — the overlay isn't visual-system content).
 */
function ConfirmOverlay({
  message,
  confirmLabel,
  cancelLabel,
  confirmDisabled,
  error,
  onConfirm,
  onCancel,
}: {
  message: string
  confirmLabel: string
  cancelLabel: string
  confirmDisabled: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        className="portal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 20,
        }}
      >
        <p
          style={{
            fontSize: '.95rem',
            lineHeight: 1.5,
            color: 'var(--color-charcoal)',
            margin: '0 0 18px',
          }}
        >
          {message}
        </p>
        {error && (
          <p
            style={{
              fontSize: '.82rem',
              lineHeight: 1.5,
              color: 'var(--color-alert)',
              margin: '0 0 12px',
            }}
          >
            {error}
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            className="portal-btn-primary"
            onClick={onConfirm}
            disabled={confirmDisabled}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            className="portal-btn-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function weekdayShort(d: Date): string {
  return d.toLocaleDateString('en-AU', { weekday: 'narrow' })
}

function isoOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

// Shared style for the prev/next week chevron buttons.
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

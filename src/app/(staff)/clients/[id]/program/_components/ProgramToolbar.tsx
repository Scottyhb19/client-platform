'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  AlertCircle,
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Plus,
  Repeat,
  X,
} from 'lucide-react'
import {
  monthArrowStyle,
} from '../../../../_components/MonthYearPicker'
import {
  archiveProgramAction,
  copyProgramAction,
  repeatProgramAction,
} from '../program-actions'

// ============================================================================
// Phase D — block-level toolbar.
//
// Three buttons replace the legacy "Copy week" / "Clinical notes" /
// "New training block" trio:
//
//   1. Copy current block — opens a date-picker modal, EP picks a
//      future start date, action clones the entire program (weeks +
//      days + exercises) onto that date.
//   2. Repeat current block — single-click confirm modal. New program
//      starts the day after the current one ends; same shape, same
//      duration.
//   3. New training block — link to the existing /program/new flow.
//
// "Current block" comes from the parent page's resolveCurrentBlock
// helper. If it's null (no programs yet), Copy and Repeat are hidden
// and only New training block remains.
// ============================================================================

const FULL_MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface CurrentBlock {
  id: string
  name: string
  start_date: string       // ISO 'YYYY-MM-DD'
  duration_weeks: number
}

interface ProgramToolbarProps {
  clientId: string
  currentBlock: CurrentBlock | null
  todayIso: string
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'copy-pick' }
  | { kind: 'confirm-repeat' }
  | { kind: 'confirm-archive' }
  | { kind: 'error'; title: string; description: string }

export function ProgramToolbar({
  clientId,
  currentBlock,
  todayIso,
}: ProgramToolbarProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && mode.kind !== 'idle') {
        setMode({ kind: 'idle' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode.kind])

  async function runCopy(newStartDate: string, newName: string) {
    if (!currentBlock) return
    setBusy(true)
    try {
      const result = await copyProgramAction(
        clientId,
        currentBlock.id,
        newStartDate,
        newName,
      )
      if ('error' in result) {
        setMode({
          kind: 'error',
          title: 'Copy failed',
          description: result.error,
        })
        return
      }
      switch (result.status) {
        case 'created':
          setMode({ kind: 'idle' })
          startTransition(() => router.refresh())
          break
        case 'overlap':
          setMode({
            kind: 'error',
            title: 'Date range overlaps another block',
            description:
              "Pick a start date that doesn't fall inside another active training block for this client.",
          })
          break
        case 'invalid_source':
          setMode({
            kind: 'error',
            title: 'Source block missing dates',
            description:
              'The current block has no start date or duration. Set those before copying.',
          })
          break
      }
    } finally {
      setBusy(false)
    }
  }

  async function runArchive() {
    if (!currentBlock) return
    setBusy(true)
    try {
      const result = await archiveProgramAction(clientId, currentBlock.id)
      if ('error' in result) {
        setMode({
          kind: 'error',
          title: 'Archive failed',
          description: result.error,
        })
        return
      }
      setMode({ kind: 'idle' })
      startTransition(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  async function runRepeat() {
    if (!currentBlock) return
    setBusy(true)
    try {
      const result = await repeatProgramAction(clientId, currentBlock.id)
      if ('error' in result) {
        setMode({
          kind: 'error',
          title: 'Repeat failed',
          description: result.error,
        })
        return
      }
      switch (result.status) {
        case 'created':
          setMode({ kind: 'idle' })
          startTransition(() => router.refresh())
          break
        case 'overlap':
          setMode({
            kind: 'error',
            title: 'Block range overlaps another block',
            description:
              "Another active block already starts where this would land. Archive that block first, or move it.",
          })
          break
        case 'invalid_source':
          setMode({
            kind: 'error',
            title: 'Source block missing dates',
            description:
              'The current block has no start date or duration. Set those before repeating.',
          })
          break
      }
    } finally {
      setBusy(false)
    }
  }

  // Compute the back-to-back start date for the repeat-confirm dialog.
  const repeatStartIso = useMemo(() => {
    if (!currentBlock) return null
    const start = parseIso(currentBlock.start_date)
    return isoFromDate(addDaysTo(start, currentBlock.duration_weeks * 7))
  }, [currentBlock])

  return (
    <>
      <div style={{ display: 'flex', gap: 10 }}>
        {currentBlock && (
          <>
            <button
              type="button"
              className="btn outline"
              onClick={() => setMode({ kind: 'copy-pick' })}
              disabled={busy}
            >
              <Copy size={14} aria-hidden />
              Copy current block
            </button>
            <button
              type="button"
              className="btn outline"
              onClick={() => setMode({ kind: 'confirm-repeat' })}
              disabled={busy}
            >
              <Repeat size={14} aria-hidden />
              Repeat current block
            </button>
            <button
              type="button"
              className="btn outline"
              onClick={() => setMode({ kind: 'confirm-archive' })}
              disabled={busy}
              title="Archive this training block — frees the date range for a new block"
            >
              <Archive size={14} aria-hidden />
              Archive block
            </button>
          </>
        )}
        <Link
          href={`/clients/${clientId}/program/new`}
          className="btn primary"
        >
          <Plus size={14} aria-hidden />
          New training block
        </Link>
      </div>

      {mode.kind === 'copy-pick' && currentBlock && (
        <CopyBlockDialog
          currentBlock={currentBlock}
          todayIso={todayIso}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={(date, name) => runCopy(date, name)}
          busy={busy}
        />
      )}

      {mode.kind === 'confirm-repeat' && currentBlock && repeatStartIso && (
        <RepeatBlockDialog
          currentBlock={currentBlock}
          newStartIso={repeatStartIso}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={runRepeat}
          busy={busy}
        />
      )}

      {mode.kind === 'confirm-archive' && currentBlock && (
        <ArchiveBlockDialog
          currentBlock={currentBlock}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={runArchive}
          busy={busy}
        />
      )}

      {mode.kind === 'error' && (
        <ErrorDialog
          title={mode.title}
          description={mode.description}
          onClose={() => setMode({ kind: 'idle' })}
        />
      )}
    </>
  )
}


// ============================================================================
// CopyBlockDialog — pick a new start date (mini calendar) + edit name.
// ============================================================================

interface CopyBlockDialogProps {
  currentBlock: CurrentBlock
  todayIso: string
  onCancel: () => void
  onConfirm: (newStartDate: string, newName: string) => void
  busy: boolean
}

function CopyBlockDialog({
  currentBlock,
  todayIso,
  onCancel,
  onConfirm,
  busy,
}: CopyBlockDialogProps) {
  const today = parseIso(todayIso)
  const blockStart = parseIso(currentBlock.start_date)
  const blockEnd = addDaysTo(
    blockStart,
    currentBlock.duration_weeks * 7 - 1,
  )

  // Default visible month: the day after current block ends.
  const defaultStart = isoFromDate(
    addDaysTo(blockEnd, 1) > today
      ? addDaysTo(blockEnd, 1)
      : addDaysTo(today, 7),
  )
  const defaultParsed = parseIso(defaultStart)

  const [pickedStart, setPickedStart] = useState<string>(defaultStart)
  const [name, setName] = useState<string>(`${currentBlock.name} (copy)`)
  const [visibleYear, setVisibleYear] = useState(defaultParsed.getFullYear())
  const [visibleMonth, setVisibleMonth] = useState(defaultParsed.getMonth())

  const cells = useMemo(
    () => buildMonthCells(visibleYear, visibleMonth),
    [visibleYear, visibleMonth],
  )

  const previewEndIso = useMemo(() => {
    if (!pickedStart) return null
    return isoFromDate(
      addDaysTo(parseIso(pickedStart), currentBlock.duration_weeks * 7 - 1),
    )
  }, [pickedStart, currentBlock.duration_weeks])

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'prev' ? -1 : 1
    const next = new Date(visibleYear, visibleMonth + delta, 1)
    setVisibleYear(next.getFullYear())
    setVisibleMonth(next.getMonth())
  }

  return (
    <DialogShell onCancel={onCancel} disabled={busy} width={400}>
      <DialogHeader
        title={`Copy ${currentBlock.name}`}
        subtitle={`Cloned with the same exercises and shape, ${currentBlock.duration_weeks} weeks long.`}
        onClose={onCancel}
      />

      {/* Name input */}
      <label
        style={{
          display: 'block',
          fontSize: '.74rem',
          fontWeight: 600,
          color: 'var(--color-text-light)',
          marginBottom: 4,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        Block name
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          fontSize: '.86rem',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 7,
          background: 'var(--color-card)',
          color: 'var(--color-charcoal)',
          marginBottom: 14,
          fontFamily: 'inherit',
        }}
        disabled={busy}
      />

      {/* Month nav */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <button
          type="button"
          onClick={() => gotoMonth('prev')}
          aria-label="Previous month"
          style={monthArrowStyle}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.95rem',
            color: 'var(--color-charcoal)',
            minWidth: 140,
            textAlign: 'center',
          }}
        >
          {FULL_MONTH_LABELS[visibleMonth]} {visibleYear}
        </div>
        <button
          type="button"
          onClick={() => gotoMonth('next')}
          aria-label="Next month"
          style={monthArrowStyle}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {/* Weekday header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
          marginBottom: 4,
        }}
      >
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            style={{
              fontSize: '.62rem',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--color-muted)',
              textAlign: 'center',
              padding: '2px 0',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 2,
        }}
      >
        {cells.map((c) => {
          const isPicked = pickedStart === c.iso
          const isPast = c.iso < todayIso
          // Dim cells inside the source block so the EP doesn't pick a
          // start date that obviously overlaps. The EXCLUDE constraint
          // catches it server-side too, but visual hint helps.
          const isInSourceBlock =
            c.iso >= currentBlock.start_date &&
            c.iso <= isoFromDate(blockEnd)
          const dimmed = !c.inMonth || isPast
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => {
                if (isPast) return
                setPickedStart(c.iso)
              }}
              disabled={isPast || busy}
              aria-label={c.iso}
              style={{
                padding: '8px 0',
                fontSize: '.78rem',
                fontVariantNumeric: 'tabular-nums',
                color: isPicked
                  ? '#fff'
                  : dimmed
                  ? 'var(--color-muted)'
                  : 'var(--color-charcoal)',
                background: isPicked
                  ? 'var(--color-primary)'
                  : isInSourceBlock
                  ? 'rgba(28, 25, 23, 0.04)'
                  : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: isPast ? 'not-allowed' : 'pointer',
                opacity: dimmed ? 0.45 : 1,
                fontWeight: isPicked ? 700 : 400,
              }}
            >
              {c.date}
            </button>
          )
        })}
      </div>

      {/* Preview */}
      <div
        style={{
          marginTop: 12,
          padding: '8px 10px',
          background: 'var(--color-surface)',
          borderRadius: 7,
          fontSize: '.78rem',
          color: 'var(--color-text-light)',
        }}
      >
        {pickedStart && previewEndIso ? (
          <>
            New block runs <strong style={{ color: 'var(--color-charcoal)' }}>
              {formatLongDate(pickedStart)}
            </strong>{' '}
            → <strong style={{ color: 'var(--color-charcoal)' }}>
              {formatLongDate(previewEndIso)}
            </strong>
          </>
        ) : (
          <span>Pick a start date.</span>
        )}
      </div>

      <DialogActions
        onCancel={onCancel}
        onConfirm={() => onConfirm(pickedStart, name.trim())}
        confirmLabel={busy ? 'Copying…' : 'Copy block'}
        confirmDisabled={!pickedStart || !name.trim() || busy}
        cancelDisabled={busy}
      />
    </DialogShell>
  )
}


// ============================================================================
// RepeatBlockDialog — confirm the back-to-back clone with computed dates.
// ============================================================================

interface RepeatBlockDialogProps {
  currentBlock: CurrentBlock
  newStartIso: string
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}

function RepeatBlockDialog({
  currentBlock,
  newStartIso,
  onCancel,
  onConfirm,
  busy,
}: RepeatBlockDialogProps) {
  const newEndIso = isoFromDate(
    addDaysTo(parseIso(newStartIso), currentBlock.duration_weeks * 7 - 1),
  )
  return (
    <DialogShell onCancel={onCancel} disabled={busy} width={400}>
      <DialogHeader
        title={`Repeat ${currentBlock.name}`}
        subtitle="Same exercises, same shape, immediately following the current block."
        onClose={onCancel}
      />

      <div
        style={{
          padding: '14px 16px',
          background: 'var(--color-surface)',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: '.86rem',
          color: 'var(--color-text)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--color-muted)' }}>New block:</span>{' '}
          <strong>{currentBlock.name} (next)</strong>
        </div>
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--color-muted)' }}>Starts:</span>{' '}
          <strong>{formatLongDate(newStartIso)}</strong>
        </div>
        <div>
          <span style={{ color: 'var(--color-muted)' }}>Ends:</span>{' '}
          <strong>{formatLongDate(newEndIso)}</strong>{' '}
          <span style={{ color: 'var(--color-muted)' }}>
            ({currentBlock.duration_weeks} weeks)
          </span>
        </div>
      </div>

      <DialogActions
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmLabel={busy ? 'Repeating…' : 'Repeat block'}
        confirmDisabled={busy}
        cancelDisabled={busy}
      />
    </DialogShell>
  )
}


// ============================================================================
// ArchiveBlockDialog — confirm before flipping status to archived.
// Frees the EXCLUDE date range so a new block can be created in the
// same window. The block is preserved (deleted_at stays null) so it
// remains findable in archived-blocks history.
// ============================================================================

interface ArchiveBlockDialogProps {
  currentBlock: CurrentBlock
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}

function ArchiveBlockDialog({
  currentBlock,
  onCancel,
  onConfirm,
  busy,
}: ArchiveBlockDialogProps) {
  const endIso = isoFromDate(
    addDaysTo(parseIso(currentBlock.start_date), currentBlock.duration_weeks * 7 - 1),
  )
  return (
    <DialogShell onCancel={onCancel} disabled={busy} width={420}>
      <DialogHeader
        title={`Archive ${currentBlock.name}?`}
        subtitle="The block stays in archived history; sessions disappear from the calendar and the date range opens up for a new block."
        onClose={onCancel}
      />

      <div
        style={{
          padding: '14px 16px',
          background: 'var(--color-surface)',
          borderRadius: 8,
          marginBottom: 16,
          fontSize: '.86rem',
          color: 'var(--color-text)',
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: 6 }}>
          <span style={{ color: 'var(--color-muted)' }}>Block:</span>{' '}
          <strong>{currentBlock.name}</strong>
        </div>
        <div>
          <span style={{ color: 'var(--color-muted)' }}>Range:</span>{' '}
          <strong>{formatLongDate(currentBlock.start_date)}</strong>
          {' → '}
          <strong>{formatLongDate(endIso)}</strong>{' '}
          <span style={{ color: 'var(--color-muted)' }}>
            ({currentBlock.duration_weeks} weeks)
          </span>
        </div>
      </div>

      <DialogActions
        onCancel={onCancel}
        onConfirm={onConfirm}
        confirmLabel={busy ? 'Archiving…' : 'Archive block'}
        confirmDisabled={busy}
        cancelDisabled={busy}
      />
    </DialogShell>
  )
}


// ============================================================================
// ErrorDialog — single OK button. Used for overlap and other errors.
// ============================================================================

interface ErrorDialogProps {
  title: string
  description: string
  onClose: () => void
}

function ErrorDialog({ title, description, onClose }: ErrorDialogProps) {
  return (
    <DialogShell onCancel={onClose} disabled={false} width={420}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <AlertCircle
          size={18}
          aria-hidden
          style={{ color: '#d97706', flexShrink: 0, marginTop: 2 }}
        />
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.05rem',
              color: 'var(--color-charcoal)',
              marginBottom: 6,
            }}
          >
            {title}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '.88rem',
              color: 'var(--color-text)',
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onClose}
          className="btn primary"
          style={{ padding: '6px 14px', fontSize: '.82rem' }}
        >
          OK
        </button>
      </div>
    </DialogShell>
  )
}


// ============================================================================
// Reusable dialog primitives (kept in this file since they're tightly
// coupled to the toolbar's three modals — extract later if reused).
// ============================================================================

function DialogShell({
  children,
  onCancel,
  disabled,
  width,
}: {
  children: React.ReactNode
  onCancel: () => void
  disabled: boolean
  width: number
}) {
  return (
    <div
      role="dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(28, 25, 23, 0.5)',
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !disabled) onCancel()
      }}
    >
      <div
        style={{
          width,
          maxWidth: '90vw',
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,.18)',
          padding: 20,
        }}
      >
        {children}
      </div>
    </div>
  )
}

function DialogHeader({
  title,
  subtitle,
  onClose,
}: {
  title: string
  subtitle?: string
  onClose: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 14,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.1rem',
            color: 'var(--color-charcoal)',
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: '.78rem',
              color: 'var(--color-muted)',
              marginTop: 2,
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          width: 22,
          height: 22,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--color-muted)',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 5,
        }}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}

function DialogActions({
  onCancel,
  onConfirm,
  confirmLabel,
  confirmDisabled,
  cancelDisabled,
}: {
  onCancel: () => void
  onConfirm: () => void
  confirmLabel: string
  confirmDisabled: boolean
  cancelDisabled: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
      <button
        type="button"
        onClick={onCancel}
        className="btn outline"
        style={{ padding: '6px 14px', fontSize: '.82rem' }}
        disabled={cancelDisabled}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="btn primary"
        style={{ padding: '6px 14px', fontSize: '.82rem' }}
        disabled={confirmDisabled}
      >
        {confirmLabel}
      </button>
    </div>
  )
}


// ============================================================================
// Pure helpers (duplicated from MonthCalendar — short-lived; could be
// extracted to a shared module if Phase E or F creates a third user).
// ============================================================================

function buildMonthCells(year: number, month: number) {
  const firstOfMonth = new Date(year, month, 1)
  const dowOfFirst = (firstOfMonth.getDay() + 6) % 7
  const start = addDaysTo(firstOfMonth, -dowOfFirst)

  const cells: { iso: string; date: number; inMonth: boolean }[] = []
  for (let i = 0; i < 42; i++) {
    const d = addDaysTo(start, i)
    cells.push({
      iso: isoFromDate(d),
      date: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
    })
  }
  return cells
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

function isoFromDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

function addDaysTo(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

function formatLongDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(parseIso(iso))
  } catch {
    return iso
  }
}

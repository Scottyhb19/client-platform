'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  AlertCircle,
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Layers,
  LayoutTemplate,
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
  saveProgramAsTemplateAction,
  type BlockConflict,
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
  // All active blocks for the client, ascending by start_date. Feeds the
  // copy-source selector (P1-4 issue 3) so the EP can copy ANY block, not
  // just the resolved current one, and see each block's date range.
  blocks: CurrentBlock[]
  todayIso: string
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'copy-pick' }
  | { kind: 'confirm-repeat' }
  | { kind: 'confirm-archive' }
  | { kind: 'save-template' }
  | { kind: 'notice'; title: string; description: string }
  // error carries optional block conflicts (P1-4) so an overlap names the
  // colliding block(s) by date instead of a bare "pick another date".
  | {
      kind: 'error'
      title: string
      description: string
      conflicts?: BlockConflict[]
    }

export function ProgramToolbar({
  clientId,
  currentBlock,
  blocks,
  todayIso,
}: ProgramToolbarProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  // P2-6 — the four block actions live behind one "Training block actions"
  // menu so the header stops squashing the title.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && mode.kind !== 'idle') {
        setMode({ kind: 'idle' })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode.kind])

  // Close the actions menu on Esc or an outside click.
  useEffect(() => {
    if (!menuOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [menuOpen])

  async function runCopy(
    sourceBlockId: string,
    newStartDate: string,
    newName: string,
  ) {
    setBusy(true)
    try {
      const result = await copyProgramAction(
        clientId,
        sourceBlockId,
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
          // P1-4 — name the colliding block(s). The bare message was
          // unexplainable when an auto-extended block covered "empty"
          // weeks the EP couldn't see on the calendar.
          setMode({
            kind: 'error',
            title: 'Date range overlaps another block',
            description:
              'The new block would overlap an existing active block for this client. Pick a start date after it ends:',
            conflicts: result.conflicts,
          })
          break
        case 'invalid_source':
          setMode({
            kind: 'error',
            title: 'Source block missing dates',
            description:
              'That block has no start date or duration. Set those before copying.',
          })
          break
      }
    } finally {
      setBusy(false)
    }
  }

  async function runArchive(blockId: string) {
    setBusy(true)
    try {
      const result = await archiveProgramAction(clientId, blockId)
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
              'The back-to-back block would overlap an existing active block. Archive it first, or use Copy block to pick a later start:',
            conflicts: result.conflicts,
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

  async function runSaveTemplate(name: string) {
    if (!currentBlock) return
    setBusy(true)
    try {
      const result = await saveProgramAsTemplateAction(currentBlock.id, name)
      if ('error' in result) {
        setMode({
          kind: 'error',
          title: 'Save as template failed',
          description: result.error,
        })
        return
      }
      switch (result.status) {
        case 'created':
          setMode({
            kind: 'notice',
            title: 'Template saved',
            description: `"${result.name}" is in your template library. Pick it under "Start from template" when creating a training block for any client.`,
          })
          break
        case 'duplicate_name':
          setMode({
            kind: 'error',
            title: 'A template already has that name',
            description: `"${result.name}" is taken. Save again with a different name.`,
          })
          break
        case 'invalid_source':
          setMode({
            kind: 'error',
            title: 'Block has no start date',
            description:
              'Templates are saved from the block structure, which needs a start date. Set one before saving.',
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
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn outline"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Layers size={14} aria-hidden />
              Training block actions
              <ChevronDown
                size={14}
                aria-hidden
                style={{
                  transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: menuOpen ? 'rotate(180deg)' : 'none',
                }}
              />
            </button>

            {menuOpen && (
              <div
                role="menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 50,
                  minWidth: 208,
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 4,
                  background: 'var(--color-card)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 10,
                }}
              >
                <ActionMenuItem
                  icon={<Copy size={14} aria-hidden />}
                  label="Copy block"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    setMode({ kind: 'copy-pick' })
                  }}
                />
                <ActionMenuItem
                  icon={<Repeat size={14} aria-hidden />}
                  label="Repeat block"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    setMode({ kind: 'confirm-repeat' })
                  }}
                />
                <ActionMenuItem
                  icon={<Archive size={14} aria-hidden />}
                  label="Archive block"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    setMode({ kind: 'confirm-archive' })
                  }}
                />
                <ActionMenuItem
                  icon={<LayoutTemplate size={14} aria-hidden />}
                  label="Save as template"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false)
                    setMode({ kind: 'save-template' })
                  }}
                />
              </div>
            )}
          </div>
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
          blocks={blocks.length > 0 ? blocks : [currentBlock]}
          defaultSourceBlock={currentBlock}
          todayIso={todayIso}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={(sourceId, date, name) => runCopy(sourceId, date, name)}
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
          blocks={blocks.length > 0 ? blocks : [currentBlock]}
          defaultBlock={currentBlock}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={runArchive}
          busy={busy}
        />
      )}

      {mode.kind === 'save-template' && currentBlock && (
        <SaveTemplateDialog
          currentBlock={currentBlock}
          onCancel={() => setMode({ kind: 'idle' })}
          onConfirm={runSaveTemplate}
          busy={busy}
        />
      )}

      {mode.kind === 'notice' && (
        <NoticeDialog
          title={mode.title}
          description={mode.description}
          onClose={() => setMode({ kind: 'idle' })}
        />
      )}

      {mode.kind === 'error' && (
        <ErrorDialog
          title={mode.title}
          description={mode.description}
          conflicts={mode.conflicts}
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
  blocks: CurrentBlock[]
  defaultSourceBlock: CurrentBlock
  todayIso: string
  onCancel: () => void
  onConfirm: (sourceBlockId: string, newStartDate: string, newName: string) => void
  busy: boolean
}

function CopyBlockDialog({
  blocks,
  defaultSourceBlock,
  todayIso,
  onCancel,
  onConfirm,
  busy,
}: CopyBlockDialogProps) {
  // Suggested defaults for a source block: start the copy the day after it
  // ends. That day is already source-weekday-aligned (a whole-week offset
  // from the block start); if it's in the past, roll forward by whole weeks
  // until it's today-or-later, keeping the weekday. Name "<b> (copy)".
  function defaultsFor(block: CurrentBlock) {
    const bEnd = addDaysTo(parseIso(block.start_date), block.duration_weeks * 7 - 1)
    let startIso = isoFromDate(addDaysTo(bEnd, 1))
    while (startIso < todayIso) {
      startIso = isoFromDate(addDaysTo(parseIso(startIso), 7))
    }
    return { start: startIso, name: `${block.name} (copy)` }
  }

  const initial = defaultsFor(defaultSourceBlock)
  const initialParsed = parseIso(initial.start)

  const [sourceId, setSourceId] = useState<string>(defaultSourceBlock.id)
  const [pickedStart, setPickedStart] = useState<string>(initial.start)
  const [name, setName] = useState<string>(initial.name)
  const [visibleYear, setVisibleYear] = useState(initialParsed.getFullYear())
  const [visibleMonth, setVisibleMonth] = useState(initialParsed.getMonth())

  const sourceBlock = blocks.find((b) => b.id === sourceId) ?? defaultSourceBlock
  const sourceEndIso = isoFromDate(
    addDaysTo(parseIso(sourceBlock.start_date), sourceBlock.duration_weeks * 7 - 1),
  )

  // Switching the source block re-derives the suggested start, name, and
  // visible month in one handler — no effect (avoids set-state-in-effect).
  function changeSource(nextId: string) {
    const next = blocks.find((b) => b.id === nextId) ?? defaultSourceBlock
    const d = defaultsFor(next)
    const dp = parseIso(d.start)
    setSourceId(nextId)
    setPickedStart(d.start)
    setName(d.name)
    setVisibleYear(dp.getFullYear())
    setVisibleMonth(dp.getMonth())
  }

  const cells = useMemo(
    () => buildMonthCells(visibleYear, visibleMonth),
    [visibleYear, visibleMonth],
  )

  const previewEndIso = useMemo(() => {
    if (!pickedStart) return null
    return isoFromDate(
      addDaysTo(parseIso(pickedStart), sourceBlock.duration_weeks * 7 - 1),
    )
  }, [pickedStart, sourceBlock.duration_weeks])

  function gotoMonth(direction: 'prev' | 'next') {
    const delta = direction === 'prev' ? -1 : 1
    const next = new Date(visibleYear, visibleMonth + delta, 1)
    setVisibleYear(next.getFullYear())
    setVisibleMonth(next.getMonth())
  }

  return (
    <DialogShell onCancel={onCancel} disabled={busy} width={400}>
      <DialogHeader
        title="Copy block"
        subtitle={`Cloned with the same exercises and shape, ${sourceBlock.duration_weeks} weeks long.`}
        onClose={onCancel}
      />

      {/* Source-block selector (P1-4 issue 3) — choose WHICH block to copy
          and see each block's date range, so the EP knows where the gap
          they're aiming for begins. */}
      <BlockSourceField
        blocks={blocks}
        sourceId={sourceId}
        currentId={defaultSourceBlock.id}
        onChange={changeSource}
        disabled={busy}
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
            c.iso >= sourceBlock.start_date &&
            c.iso <= sourceEndIso
          const dimmed = !c.inMonth || isPast
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => {
                if (isPast) return
                // Snap to the source weekday in the clicked week so the
                // clone preserves session weekdays (P1-4 issue 5). Push a
                // week forward only if the aligned date would be in the past.
                let aligned = alignToSourceWeekday(c.iso, sourceBlock.start_date)
                if (aligned < todayIso) {
                  aligned = isoFromDate(addDaysTo(parseIso(aligned), 7))
                }
                setPickedStart(aligned)
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
            <span style={{ display: 'block', marginTop: 4, color: 'var(--color-muted)' }}>
              Sessions keep the same weekdays as the source — the date you
              pick chooses the week.
            </span>
          </>
        ) : (
          <span>Pick a start date.</span>
        )}
      </div>

      <DialogActions
        onCancel={onCancel}
        onConfirm={() => onConfirm(sourceId, pickedStart, name.trim())}
        confirmLabel={busy ? 'Copying…' : 'Copy block'}
        confirmDisabled={!pickedStart || !name.trim() || busy}
        cancelDisabled={busy}
      />
    </DialogShell>
  )
}


// ============================================================================
// ActionMenuItem — one row in the "Training block actions" menu (P2-6).
// Sentence-case label + Lucide icon, subtle surface hover, no shadow
// (design system: menus carry no shadow).
// ============================================================================

interface ActionMenuItemProps {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled: boolean
}

function ActionMenuItem({ icon, label, onClick, disabled }: ActionMenuItemProps) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        fontFamily: 'inherit',
        fontSize: '.86rem',
        color: 'var(--color-charcoal)',
        background: hover && !disabled ? 'var(--color-surface)' : 'transparent',
        border: 'none',
        borderRadius: 7,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background 150ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}


// ============================================================================
// BlockSourceField — "copy which block" control inside CopyBlockDialog.
// Dropdown when the client has 2+ active blocks; a static line (still
// showing the date range) when there's only one. (P1-4 issue 3.)
// ============================================================================

interface BlockSourceFieldProps {
  blocks: CurrentBlock[]
  sourceId: string
  currentId: string
  onChange: (id: string) => void
  disabled: boolean
  // Caller-supplied wording so the same control reads naturally for copy
  // ("Copy which block" / "Copying from") and archive ("Archive which
  // block" / "Archiving").
  label?: string
  singleLabel?: string
}

const blockFieldLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '.74rem',
  fontWeight: 600,
  color: 'var(--color-text-light)',
  marginBottom: 4,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

function blockRangeLabel(b: CurrentBlock): string {
  const endIso = isoFromDate(
    addDaysTo(parseIso(b.start_date), b.duration_weeks * 7 - 1),
  )
  return `${formatDateAU(b.start_date)} – ${formatDateAU(endIso)}`
}

function BlockSourceField({
  blocks,
  sourceId,
  currentId,
  onChange,
  disabled,
  label = 'Copy which block',
  singleLabel = 'Copying from',
}: BlockSourceFieldProps) {
  // Single block: read-only line. Still surfaces the dates so the EP knows
  // where this block ends before picking the copy's start.
  if (blocks.length < 2) {
    const b = blocks.find((x) => x.id === sourceId) ?? blocks[0]
    if (!b) return null
    return (
      <div style={{ marginBottom: 14 }}>
        <span style={blockFieldLabelStyle}>{singleLabel}</span>
        <div style={{ fontSize: '.86rem', color: 'var(--color-charcoal)' }}>
          <strong style={{ fontWeight: 600 }}>{b.name}</strong>{' '}
          <span style={{ color: 'var(--color-muted)' }}>
            · {blockRangeLabel(b)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <label htmlFor="block-source-select" style={blockFieldLabelStyle}>
        {label}
      </label>
      <select
        id="block-source-select"
        value={sourceId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          fontSize: '.86rem',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 7,
          background: 'var(--color-card)',
          color: 'var(--color-charcoal)',
          fontFamily: 'inherit',
        }}
      >
        {blocks.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} · {blockRangeLabel(b)}
            {b.id === currentId ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </div>
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
  blocks: CurrentBlock[]
  defaultBlock: CurrentBlock
  onCancel: () => void
  onConfirm: (blockId: string) => void
  busy: boolean
}

function ArchiveBlockDialog({
  blocks,
  defaultBlock,
  onCancel,
  onConfirm,
  busy,
}: ArchiveBlockDialogProps) {
  // P1-4 issue 4 — the EP picks WHICH block to archive (the toolbar used to
  // act only on the resolved current block, so a second block couldn't be
  // archived at all). Defaults to the resolved current one.
  const [blockId, setBlockId] = useState<string>(defaultBlock.id)
  const block = blocks.find((b) => b.id === blockId) ?? defaultBlock
  const endIso = isoFromDate(
    addDaysTo(parseIso(block.start_date), block.duration_weeks * 7 - 1),
  )
  return (
    <DialogShell onCancel={onCancel} disabled={busy} width={420}>
      <DialogHeader
        title="Archive a block?"
        subtitle="The block stays in archived history; sessions disappear from the calendar and the date range opens up for a new block."
        onClose={onCancel}
      />

      <BlockSourceField
        blocks={blocks}
        sourceId={blockId}
        currentId={defaultBlock.id}
        onChange={setBlockId}
        disabled={busy}
        label="Archive which block"
        singleLabel="Archiving"
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
        <div>
          <span style={{ color: 'var(--color-muted)' }}>Range:</span>{' '}
          <strong>{formatLongDate(block.start_date)}</strong>
          {' → '}
          <strong>{formatLongDate(endIso)}</strong>{' '}
          <span style={{ color: 'var(--color-muted)' }}>
            ({block.duration_weeks} weeks)
          </span>
        </div>
      </div>

      <DialogActions
        onCancel={onCancel}
        onConfirm={() => onConfirm(blockId)}
        confirmLabel={busy ? 'Archiving…' : 'Archive block'}
        confirmDisabled={busy}
        cancelDisabled={busy}
      />
    </DialogShell>
  )
}


// ============================================================================
// SaveTemplateDialog — name the template (defaults to the block name)
// before snapshotting it into the org's template library (G-2).
// ============================================================================

interface SaveTemplateDialogProps {
  currentBlock: CurrentBlock
  onCancel: () => void
  onConfirm: (name: string) => void
  busy: boolean
}

function SaveTemplateDialog({
  currentBlock,
  onCancel,
  onConfirm,
  busy,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(currentBlock.name)
  const trimmed = name.trim()
  return (
    <DialogShell onCancel={onCancel} disabled={busy} width={420}>
      <DialogHeader
        title="Save as template"
        subtitle="Snapshots this block's weeks, days, exercises and per-set prescriptions. Reusable for any client; later edits to this block don't change the template."
        onClose={onCancel}
      />

      <div style={{ marginBottom: 4 }}>
        <div
          style={{
            fontSize: '.64rem',
            fontWeight: 700,
            color: 'var(--color-muted)',
            textTransform: 'uppercase',
            letterSpacing: '.06em',
            marginBottom: 5,
          }}
        >
          Template name
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ACL Rehab Phase 2"
          aria-label="Template name"
          autoFocus
          style={{
            width: '100%',
            height: 36,
            padding: '0 12px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 7,
            background: 'var(--color-surface)',
            fontFamily: 'var(--font-sans)',
            fontSize: '.86rem',
            outline: 'none',
            color: 'var(--color-text)',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <DialogActions
        onCancel={onCancel}
        onConfirm={() => onConfirm(trimmed)}
        confirmLabel={busy ? 'Saving…' : 'Save template'}
        confirmDisabled={busy || trimmed.length === 0}
        cancelDisabled={busy}
      />
    </DialogShell>
  )
}


// ============================================================================
// NoticeDialog — single OK button, success/neutral tone. Accent check
// is a sanctioned success-state use of the green.
// ============================================================================

interface NoticeDialogProps {
  title: string
  description: string
  onClose: () => void
}

function NoticeDialog({ title, description, onClose }: NoticeDialogProps) {
  return (
    <DialogShell onCancel={onClose} disabled={false} width={420}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <Check
          size={18}
          aria-hidden
          style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 2 }}
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
// ErrorDialog — single OK button. Used for overlap and other errors.
// ============================================================================

interface ErrorDialogProps {
  title: string
  description: string
  conflicts?: BlockConflict[]
  onClose: () => void
}

function ErrorDialog({ title, description, conflicts, onClose }: ErrorDialogProps) {
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
          {/* P1-4 — name the colliding block(s) with their date range so
              the EP knows exactly where the gap they're aiming for ends. */}
          {conflicts && conflicts.length > 0 && (
            <ul
              style={{
                margin: '10px 0 0',
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {conflicts.map((c) => (
                <li
                  key={`${c.name}-${c.startDate}`}
                  style={{
                    fontSize: '.84rem',
                    color: 'var(--color-charcoal)',
                    padding: '6px 10px',
                    background: 'var(--color-surface)',
                    borderRadius: 7,
                  }}
                >
                  <strong style={{ fontWeight: 600 }}>{c.name}</strong>
                  <span style={{ color: 'var(--color-muted)' }}>
                    {' '}— {formatLongDate(c.startDate)} to{' '}
                    {formatLongDate(c.endDate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
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

// P1-4 issue 5 — place the source-start weekday within the picked date's
// Mon–Sun week. The result differs from source_start by whole weeks, so a
// clone shifted to it preserves every session's weekday. Mirrors the SQL
// in copy_program (20260612180000) so the dialog preview matches the RPC.
function alignToSourceWeekday(pickedIso: string, sourceStartIso: string): string {
  const picked = parseIso(pickedIso)
  const src = parseIso(sourceStartIso)
  const pickedMonOffset = (picked.getDay() + 6) % 7 // 0=Mon .. 6=Sun
  const mondayOfPicked = addDaysTo(picked, -pickedMonOffset)
  const srcOffset = (src.getDay() + 6) % 7
  return isoFromDate(addDaysTo(mondayOfPicked, srcOffset))
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

// Day-month-year (e.g. "8 May 2026") — block ranges can span years, so the
// source selector carries the year the weekday-form formatLongDate omits.
function formatDateAU(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(parseIso(iso))
  } catch {
    return iso
  }
}

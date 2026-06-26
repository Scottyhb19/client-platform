'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarOff, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  createDateClosureAction,
  deleteAvailabilityRuleAction,
  type AvailabilityRuleRow,
} from '../actions'
import { RuleForm } from './RuleForm'
import { formatDate, formatTime } from '../_lib/format'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'

/**
 * Secondary panel for one-off rules. Two kinds sit here:
 *   • positive exceptions — extra clinics / changed hours for a date (ADD slots);
 *   • closures (is_blocked) — "close a date" for a holiday / sick day / leave,
 *     which SUBTRACT bookable time (P1-5). Whole-day by default, or a window;
 *     a date range closes each day in it.
 */
type EditingState =
  | { kind: 'create' }
  | { kind: 'edit'; rule: AvailabilityRuleRow }
  | null

const WHOLE_DAY_START = '00:00:00'
const WHOLE_DAY_END = '23:59:59'

function isWholeDay(rule: AvailabilityRuleRow): boolean {
  return rule.start_time === WHOLE_DAY_START && rule.end_time === WHOLE_DAY_END
}

export function OneOffOverrides({
  rules,
}: {
  rules: AvailabilityRuleRow[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<EditingState>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{
    rule: AvailabilityRuleRow
    isClosure: boolean
  } | null>(null)

  // Closure ("close a date") form state.
  const [closing, setClosing] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [wholeDay, setWholeDay] = useState(true)
  const [closeStart, setCloseStart] = useState('09:00')
  const [closeEnd, setCloseEnd] = useState('12:00')
  const [closeError, setCloseError] = useState<string | null>(null)

  const positives = rules
    .filter((r) => !r.is_blocked)
    .sort((a, b) => {
      const ad = a.specific_date ?? ''
      const bd = b.specific_date ?? ''
      if (ad !== bd) return ad.localeCompare(bd)
      return a.start_time.localeCompare(b.start_time)
    })
  const closures = rules
    .filter((r) => r.is_blocked)
    .sort((a, b) => (a.specific_date ?? '').localeCompare(b.specific_date ?? ''))

  // On-system confirm (shared ConfirmDialog) in place of browser confirm();
  // a failure shows inside the dialog so the EP can retry.
  function runDelete() {
    const target = confirmDelete
    if (!target || !target.rule.specific_date) return
    setError(null)
    startTransition(async () => {
      const r = await deleteAvailabilityRuleAction(target.rule.id)
      if (r.error) {
        setError(r.error)
        return
      }
      setConfirmDelete(null)
      router.refresh()
    })
  }

  function handleCloseDate() {
    if (!fromDate) {
      setCloseError('Pick a date to close.')
      return
    }
    setCloseError(null)
    startTransition(async () => {
      const res = await createDateClosureAction({
        from_date: fromDate,
        to_date: toDate || null,
        start_time: wholeDay ? null : closeStart,
        end_time: wholeDay ? null : closeEnd,
      })
      if (res.error) {
        setCloseError(res.error)
        return
      }
      setClosing(false)
      setFromDate('')
      setToDate('')
      setWholeDay(true)
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '14px 22px 22px' }}>
      {positives.length === 0 && (
        <div
          style={{
            fontSize: '.86rem',
            color: 'var(--color-text-light)',
            padding: '4px 0 14px',
          }}
        >
          No one-off exceptions yet.
        </div>
      )}

      {positives.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 14,
          }}
        >
          {positives.map((rule) => (
            <div
              key={rule.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                gap: 14,
                padding: '10px 14px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 8,
                background: 'var(--color-card)',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '.92rem',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                  }}
                >
                  {rule.specific_date ? formatDate(rule.specific_date) : '—'}
                </div>
                <div
                  style={{
                    fontSize: '.76rem',
                    color: 'var(--color-text-light)',
                    marginTop: 1,
                  }}
                >
                  {formatTime(rule.start_time)}–{formatTime(rule.end_time)}
                </div>
              </div>
              <div
                style={{
                  fontSize: '.74rem',
                  color: 'var(--color-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {rule.slot_duration_minutes} min
              </div>
              <button
                type="button"
                onClick={() => setEditing({ kind: 'edit', rule })}
                disabled={pending}
                aria-label="Edit exception"
                style={iconButtonStyle}
              >
                <Pencil size={14} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setConfirmDelete({ rule, isClosure: false })
                }}
                disabled={pending}
                aria-label="Delete exception"
                style={{ ...iconButtonStyle, color: 'var(--color-alert)' }}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Closures (P1-5) — distinct from positive exceptions. */}
      {closures.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 14,
          }}
        >
          {closures.map((rule) => (
            <div
              key={rule.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 8,
                background: 'var(--color-surface)',
              }}
            >
              <span
                style={{
                  fontSize: '.6rem',
                  fontWeight: 700,
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 999,
                  padding: '2px 8px',
                  whiteSpace: 'nowrap',
                }}
              >
                Closed
              </span>
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '.92rem',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                  }}
                >
                  {rule.specific_date ? formatDate(rule.specific_date) : '—'}
                </div>
                <div
                  style={{
                    fontSize: '.76rem',
                    color: 'var(--color-text-light)',
                    marginTop: 1,
                  }}
                >
                  {isWholeDay(rule)
                    ? 'All day'
                    : `${formatTime(rule.start_time)}–${formatTime(rule.end_time)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setConfirmDelete({ rule, isClosure: true })
                }}
                disabled={pending}
                aria-label="Re-open this date"
                style={{ ...iconButtonStyle, color: 'var(--color-alert)' }}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setEditing({ kind: 'create' })}
          disabled={pending}
          className="btn outline"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <Plus size={14} aria-hidden /> Add exception
        </button>
        <button
          type="button"
          onClick={() => setClosing((v) => !v)}
          disabled={pending}
          className="btn outline"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <CalendarOff size={14} aria-hidden /> Close a date
        </button>
      </div>

      {closing && (
        <div
          style={{
            marginTop: 12,
            padding: 14,
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 8,
            background: 'var(--color-surface)',
            display: 'grid',
            gap: 10,
            maxWidth: 460,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={fieldLabel}>
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={fieldInput}
              />
            </label>
            <label style={fieldLabel}>
              To <span style={{ color: 'var(--color-muted)' }}>(optional)</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={fieldInput}
              />
            </label>
          </div>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: '.82rem',
              color: 'var(--color-text)',
            }}
          >
            <input
              type="checkbox"
              checked={wholeDay}
              onChange={(e) => setWholeDay(e.target.checked)}
            />
            Whole day
          </label>
          {!wholeDay && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={fieldLabel}>
                Start
                <input
                  type="time"
                  step={900}
                  value={closeStart}
                  onChange={(e) => setCloseStart(e.target.value)}
                  style={fieldInput}
                />
              </label>
              <label style={fieldLabel}>
                End
                <input
                  type="time"
                  step={900}
                  value={closeEnd}
                  onChange={(e) => setCloseEnd(e.target.value)}
                  style={fieldInput}
                />
              </label>
            </div>
          )}
          {closeError && (
            <div role="alert" style={{ fontSize: '.78rem', color: 'var(--color-alert)' }}>
              {closeError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn outline"
              onClick={() => {
                setClosing(false)
                setCloseError(null)
              }}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={handleCloseDate}
              disabled={pending || !fromDate}
            >
              {pending ? 'Closing…' : 'Close date'}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <RuleForm
          mode="one_off"
          editing={editing.kind === 'edit' ? editing.rule : null}
          existingRules={rules}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={
            confirmDelete.isClosure ? 'Re-open this date?' : 'Delete exception?'
          }
          body={
            confirmDelete.isClosure ? (
              <>
                Re-open {formatDate(confirmDelete.rule.specific_date!)}? Bookings
                can be made on this date again.
              </>
            ) : (
              <>
                Delete the exception on{' '}
                {formatDate(confirmDelete.rule.specific_date!)} (
                {formatTime(confirmDelete.rule.start_time)}–
                {formatTime(confirmDelete.rule.end_time)})?
              </>
            )
          }
          confirmLabel={confirmDelete.isClosure ? 'Re-open' : 'Delete'}
          tone={confirmDelete.isClosure ? 'primary' : 'alert'}
          busy={pending}
          error={error}
          onCancel={() => {
            if (pending) return
            setConfirmDelete(null)
            setError(null)
          }}
          onConfirm={runDelete}
        />
      )}
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-light)',
  cursor: 'pointer',
  borderRadius: 6,
  display: 'grid',
  placeItems: 'center',
}

const fieldLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: '.64rem',
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
}

const fieldInput: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  background: 'var(--color-card)',
  fontFamily: 'var(--font-sans)',
  fontSize: '.9rem',
  color: 'var(--color-text)',
  outline: 'none',
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  createOneOffRuleAction,
  createWeeklyRuleAction,
  updateAvailabilityRuleAction,
  type AvailabilityRuleRow,
} from '../actions'
import { dayLong, formatTime, todayIso } from '../_lib/format'

/**
 * Shared form for creating or editing one availability rule.
 *
 * `mode` chooses between a weekly rule (day-of-week selector) and a one-off
 * (date picker). `editing` of `null` puts the form in create mode; an
 * `AvailabilityRuleRow` puts it in edit mode and disables the recurrence-
 * key field (day or date) — switching a rule's recurrence kind is a
 * delete-and-recreate, not an in-place reshape (keeps the audit trail honest).
 *
 * Overlap soft-warn (Q4): before submit, scan `existingRules` for a same-
 * recurrence rule on the same day/date whose time range overlaps. If found,
 * `confirm()` asks before saving. This is advisory — the DB allows overlap
 * (DISTINCT in the slot RPC dedupes the picker output).
 */
type Props = {
  mode: 'weekly' | 'one_off'
  editing: AvailabilityRuleRow | null
  defaultDayOfWeek?: number
  defaultSpecificDate?: string
  existingRules: AvailabilityRuleRow[]
  onSaved: () => void
  onCancel: () => void
}

export function RuleForm({
  mode,
  editing,
  defaultDayOfWeek,
  defaultSpecificDate,
  existingRules,
  onSaved,
  onCancel,
}: Props) {
  const isEdit = editing != null
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // "More options" disclosure — opens by default in edit mode if either
  // optional field is non-default, so the EP doesn't lose track of an
  // effective_to date or a note tucked behind a chevron.
  const [showMore, setShowMore] = useState(
    isEdit &&
      (editing!.effective_to != null || (editing!.notes ?? '').length > 0),
  )

  // Field state. Strip seconds from the DB's HH:MM:SS for the time input,
  // which speaks HH:MM only.
  const [dayOfWeek, setDayOfWeek] = useState<number>(
    editing?.day_of_week ?? defaultDayOfWeek ?? 0,
  )
  const [specificDate, setSpecificDate] = useState<string>(
    editing?.specific_date ?? defaultSpecificDate ?? todayIso(),
  )
  const [startTime, setStartTime] = useState(
    editing?.start_time?.slice(0, 5) ?? '08:00',
  )
  const [endTime, setEndTime] = useState(
    editing?.end_time?.slice(0, 5) ?? '17:00',
  )
  const [slotDuration, setSlotDuration] = useState<number>(
    editing?.slot_duration_minutes ?? 60,
  )
  const [effectiveFrom, setEffectiveFrom] = useState(
    editing?.effective_from ?? todayIso(),
  )
  const [effectiveTo, setEffectiveTo] = useState(editing?.effective_to ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')

  function findOverlap(): AvailabilityRuleRow | null {
    for (const r of existingRules) {
      if (r.id === editing?.id) continue
      if (r.recurrence !== mode) continue
      if (mode === 'weekly' && r.day_of_week !== dayOfWeek) continue
      if (mode === 'one_off' && r.specific_date !== specificDate) continue
      const rStart = r.start_time.slice(0, 5)
      const rEnd = r.end_time.slice(0, 5)
      // Standard half-open interval overlap test.
      if (startTime < rEnd && endTime > rStart) return r
    }
    return null
  }

  function handleSave() {
    const overlap = findOverlap()
    if (overlap) {
      const range = `${formatTime(overlap.start_time)}–${formatTime(overlap.end_time)}`
      const ok = window.confirm(
        `This overlaps with an existing rule (${range}). Save anyway?`,
      )
      if (!ok) return
    }
    submit()
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      const cleanedNotes =
        notes.trim().length > 0 ? notes.trim() : null
      const cleanedEffectiveTo =
        effectiveTo.length > 0 ? effectiveTo : null

      if (isEdit) {
        const r = await updateAvailabilityRuleAction({
          id: editing!.id,
          start_time: startTime,
          end_time: endTime,
          slot_duration_minutes: slotDuration,
          effective_from: effectiveFrom,
          effective_to: cleanedEffectiveTo,
          notes: cleanedNotes,
        })
        if (r.error) {
          setError(r.error)
          return
        }
      } else if (mode === 'weekly') {
        const r = await createWeeklyRuleAction({
          day_of_week: dayOfWeek,
          start_time: startTime,
          end_time: endTime,
          slot_duration_minutes: slotDuration,
          effective_from: effectiveFrom,
          effective_to: cleanedEffectiveTo,
          notes: cleanedNotes,
        })
        if (r.error) {
          setError(r.error)
          return
        }
      } else {
        const r = await createOneOffRuleAction({
          specific_date: specificDate,
          start_time: startTime,
          end_time: endTime,
          slot_duration_minutes: slotDuration,
          effective_from: effectiveFrom,
          effective_to: cleanedEffectiveTo,
          notes: cleanedNotes,
        })
        if (r.error) {
          setError(r.error)
          return
        }
      }
      router.refresh()
      onSaved()
    })
  }

  return (
    <div
      style={{
        padding: '18px 22px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 10,
        background: 'var(--color-surface)',
        marginTop: 14,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.96rem',
          marginBottom: 14,
        }}
      >
        {isEdit
          ? 'Edit hours'
          : mode === 'weekly'
            ? 'Add weekly hours'
            : 'Add exception'}
      </div>

      {mode === 'weekly' ? (
        <Field label="Day">
          <select
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
            disabled={isEdit}
            style={selectStyle}
            aria-label="Day of week"
          >
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <option key={i} value={i}>
                {dayLong(i)}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Date">
          <input
            type="date"
            value={specificDate}
            onChange={(e) => setSpecificDate(e.target.value)}
            disabled={isEdit}
            style={inputStyle}
            aria-label="Date"
          />
        </Field>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={inputStyle}
            aria-label="Start time"
          />
        </Field>
        <Field label="End">
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={inputStyle}
            aria-label="End time"
          />
        </Field>
      </div>

      <Field label="Slot length (min)">
        <input
          type="number"
          min={5}
          max={240}
          step={5}
          value={slotDuration}
          onChange={(e) => setSlotDuration(Number(e.target.value))}
          style={{ ...inputStyle, width: 120 }}
          aria-label="Slot length in minutes"
        />
      </Field>

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          background: 'transparent',
          border: 'none',
          color: 'var(--color-text-light)',
          fontFamily: 'var(--font-sans)',
          fontSize: '.82rem',
          cursor: 'pointer',
          padding: '8px 0',
          marginTop: 2,
        }}
      >
        {showMore ? (
          <ChevronDown size={14} aria-hidden />
        ) : (
          <ChevronRight size={14} aria-hidden />
        )}
        More options
      </button>
      {showMore && (
        <div style={{ paddingLeft: 4, paddingTop: 4 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}
          >
            <Field label="Effective from">
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                style={inputStyle}
                aria-label="Effective from date"
              />
            </Field>
            <Field label="Effective to (optional)">
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                style={inputStyle}
                aria-label="Effective to date"
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={500}
              style={{
                ...inputStyle,
                height: 'auto',
                padding: '8px 10px',
                fontFamily: 'var(--font-sans)',
                resize: 'vertical',
              }}
              aria-label="Notes"
            />
          </Field>
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            fontSize: '.78rem',
            color: 'var(--color-alert)',
            marginTop: 10,
            marginBottom: 4,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 10,
          marginTop: 14,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="btn outline"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="btn primary"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontSize: '.7rem',
          fontWeight: 700,
          color: 'var(--color-muted)',
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
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

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}

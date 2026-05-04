'use client'

import Link from 'next/link'
import { useActionState, useMemo, useState } from 'react'
import { createProgramAction } from '../actions'
import { initialNewProgramState, type NewProgramState } from '../types'

interface NewProgramFormProps {
  clientId: string
  clientName: string
  todayIso: string
}

const DAY_OF_WEEK_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

// Default split per session count. JS-convention dows (0=Sun..6=Sat).
function defaultSessionDows(count: number): number[] {
  if (count <= 1) return [1]
  if (count === 2) return [1, 4]
  if (count === 3) return [1, 3, 5]
  if (count === 4) return [1, 2, 4, 5]
  if (count === 5) return [1, 2, 3, 4, 5]
  if (count === 6) return [1, 2, 3, 4, 5, 6]
  return [1, 2, 3, 4, 5, 6, 0]
}

export function NewProgramForm({
  clientId,
  clientName,
  todayIso,
}: NewProgramFormProps) {
  const [state, formAction, pending] = useActionState<
    NewProgramState,
    FormData
  >(createProgramAction, initialNewProgramState)

  // Controlled state for the reactive Session schedule pickers — when the
  // EP changes "days per week", the pick row count resizes and pre-fills
  // any new rows from the default split. Existing picks are preserved.
  const [daysPerWeek, setDaysPerWeek] = useState<number>(3)
  const [sessionDows, setSessionDows] = useState<number[]>(
    defaultSessionDows(3),
  )

  function handleDaysPerWeekChange(next: number) {
    if (!Number.isFinite(next) || next < 1 || next > 7) {
      setDaysPerWeek(next)
      return
    }
    setDaysPerWeek(next)
    setSessionDows((prev) => {
      if (prev.length === next) return prev
      if (prev.length > next) return prev.slice(0, next)
      // Extend with defaults that don't collide with existing picks.
      const used = new Set(prev)
      const fallback = defaultSessionDows(next).filter((d) => !used.has(d))
      const extended = [...prev]
      while (extended.length < next) {
        extended.push(fallback.shift() ?? nextFreeDow(extended))
      }
      return extended
    })
  }

  function setSessionDow(index: number, value: number) {
    setSessionDows((prev) => {
      const copy = [...prev]
      copy[index] = value
      return copy
    })
  }

  const duplicates = useMemo(() => {
    const seen = new Set<number>()
    const dupes = new Set<number>()
    for (const d of sessionDows) {
      if (seen.has(d)) dupes.add(d)
      else seen.add(d)
    }
    return dupes
  }, [sessionDows])

  const hasDuplicates = duplicates.size > 0

  return (
    <form action={formAction} style={{ display: 'grid', gap: 18 }}>
      <input type="hidden" name="client_id" value={clientId} />
      {sessionDows.map((dow, i) => (
        <input
          key={`hidden-${i}`}
          type="hidden"
          name={`session_dow_${i}`}
          value={dow}
        />
      ))}

      {state.error && (
        <div
          role="alert"
          style={{
            padding: '10px 14px',
            background: 'rgba(214,64,69,.08)',
            border: '1px solid rgba(214,64,69,.25)',
            borderRadius: 8,
            color: 'var(--color-alert)',
            fontSize: '.86rem',
          }}
        >
          {state.error}
        </div>
      )}

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Basics"
          desc={`Name the training block and pick how long it runs for ${clientName}.`}
        />
        <div
          style={{
            padding: '20px 22px',
            display: 'grid',
            gap: 14,
          }}
        >
          <Field
            name="name"
            label="Name"
            required
            placeholder="Block 2 · Strength"
            error={state.fieldErrors.name}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 14,
            }}
          >
            <Field
              name="duration_weeks"
              label="Duration (weeks)"
              type="number"
              required
              defaultValue="4"
              placeholder="4"
              error={state.fieldErrors.duration_weeks}
            />
            <NumberField
              name="days_per_week"
              label="Days per week"
              required
              min={1}
              max={7}
              value={daysPerWeek}
              onChange={handleDaysPerWeekChange}
              error={state.fieldErrors.days_per_week}
            />
            <Field
              name="start_date"
              label="Start date"
              type="date"
              defaultValue={todayIso}
            />
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Session schedule"
          desc="Pick which day of the week each session lands on. Repeats every week of the block."
        />
        <div style={{ padding: '20px 22px', display: 'grid', gap: 10 }}>
          {sessionDows.map((dow, i) => {
            const isDuplicate = duplicates.has(dow)
            return (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr',
                  gap: 12,
                  alignItems: 'center',
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
                  Session {i + 1}
                </div>
                <select
                  value={dow}
                  onChange={(e) => setSessionDow(i, parseInt(e.target.value, 10))}
                  aria-invalid={isDuplicate ? true : undefined}
                  style={{
                    ...inputStyle,
                    borderColor: isDuplicate
                      ? 'var(--color-alert)'
                      : 'var(--color-border-subtle)',
                    cursor: 'pointer',
                  }}
                >
                  {DAY_OF_WEEK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
          {hasDuplicates && (
            <div
              style={{
                fontSize: '.74rem',
                color: 'var(--color-alert)',
              }}
            >
              Each session must be on a different day.
            </div>
          )}
          {state.fieldErrors.session_days && !hasDuplicates && (
            <div
              style={{
                fontSize: '.74rem',
                color: 'var(--color-alert)',
              }}
            >
              {state.fieldErrors.session_days}
            </div>
          )}
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Notes (optional)"
          desc="Context for this training block — goal, injury considerations, load strategy."
        />
        <div style={{ padding: '20px 22px' }}>
          <TextareaField
            name="notes"
            label=""
            placeholder="Strength base block. Push load on Day 1, RPE 8 cap elsewhere. Copenhagen plank progression."
            rows={3}
          />
        </div>
      </section>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          paddingTop: 4,
        }}
      >
        <Link href={`/clients/${clientId}/program`} className="btn outline">
          Cancel
        </Link>
        <button
          type="submit"
          className="btn primary"
          disabled={pending || hasDuplicates}
        >
          {pending ? 'Creating…' : 'Start training block'}
        </button>
      </div>
    </form>
  )
}

function nextFreeDow(taken: number[]): number {
  const taken_ = new Set(taken)
  for (let i = 1; i <= 7; i++) {
    const dow = i === 7 ? 0 : i
    if (!taken_.has(dow)) return dow
  }
  return 1
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div
      style={{
        padding: '16px 22px',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '1rem',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: '.78rem',
          color: 'var(--color-text-light)',
          marginTop: 2,
        }}
      >
        {desc}
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  )
}

function Field({
  name,
  label,
  type = 'text',
  placeholder,
  required,
  defaultValue,
  error,
}: {
  name: string
  label: string
  type?: string
  placeholder?: string
  required?: boolean
  defaultValue?: string
  error?: string
}) {
  return (
    <div>
      <FieldLabel>
        {label}
        {required && (
          <span
            aria-hidden
            style={{ color: 'var(--color-alert)', marginLeft: 4 }}
          >
            *
          </span>
        )}
      </FieldLabel>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        style={{
          ...inputStyle,
          borderColor: error
            ? 'var(--color-alert)'
            : 'var(--color-border-subtle)',
        }}
      />
      {error && (
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-alert)',
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function NumberField({
  name,
  label,
  required,
  min,
  max,
  value,
  onChange,
  error,
}: {
  name: string
  label: string
  required?: boolean
  min: number
  max: number
  value: number
  onChange: (next: number) => void
  error?: string
}) {
  return (
    <div>
      <FieldLabel>
        {label}
        {required && (
          <span
            aria-hidden
            style={{ color: 'var(--color-alert)', marginLeft: 4 }}
          >
            *
          </span>
        )}
      </FieldLabel>
      <input
        name={name}
        type="number"
        min={min}
        max={max}
        required={required}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const next = parseInt(e.target.value, 10)
          onChange(Number.isFinite(next) ? next : NaN)
        }}
        aria-invalid={error ? true : undefined}
        style={{
          ...inputStyle,
          borderColor: error
            ? 'var(--color-alert)'
            : 'var(--color-border-subtle)',
        }}
      />
      {error && (
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-alert)',
            marginTop: 4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  )
}

function TextareaField({
  name,
  label,
  placeholder,
  rows = 3,
}: {
  name: string
  label: string
  placeholder?: string
  rows?: number
}) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <textarea
        name={name}
        placeholder={placeholder}
        rows={rows}
        style={{
          ...inputStyle,
          height: 'auto',
          padding: '10px 12px',
          lineHeight: 1.5,
          resize: 'vertical',
        }}
      />
    </div>
  )
}

const inputStyle: React.CSSProperties = {
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
}

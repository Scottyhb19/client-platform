'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { createProgramAction } from '../actions'
import { initialNewProgramState, type NewProgramState } from '../types'

interface NewProgramFormProps {
  clientId: string
  clientName: string
  todayIso: string
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

  return (
    <form action={formAction} style={{ display: 'grid', gap: 18 }}>
      <input type="hidden" name="client_id" value={clientId} />

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
            <Field
              name="days_per_week"
              label="Days per week"
              type="number"
              required
              defaultValue="3"
              placeholder="3"
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
          title="Location"
          desc="Affects equipment defaults shown in the builder."
        />
        <div
          style={{
            padding: '20px 22px',
            display: 'flex',
            gap: 10,
          }}
        >
          <RadioCard
            name="program_type"
            value="in_clinic"
            label="In-clinic"
            desc="Full gym access · barbells, racks, plates."
            defaultChecked
          />
          <RadioCard
            name="program_type"
            value="home_gym"
            label="Home gym"
            desc="Limited kit — dumbbells, bands, bodyweight."
          />
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
            placeholder="Strength base block. Push load on Day A, RPE 8 cap elsewhere. Copenhagen plank progression."
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
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Creating…' : 'Start training block'}
        </button>
      </div>

      <p
        style={{
          fontSize: '.78rem',
          color: 'var(--color-muted)',
          marginTop: -4,
          textAlign: 'right',
        }}
      >
        Any existing active program for this client will be archived.
      </p>
    </form>
  )
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

function RadioCard({
  name,
  value,
  label,
  desc,
  defaultChecked,
}: {
  name: string
  value: string
  label: string
  desc: string
  defaultChecked?: boolean
}) {
  return (
    <label
      style={{
        flex: 1,
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        background: '#fff',
      }}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        style={{ marginTop: 3, accentColor: 'var(--color-primary)' }}
      />
      <span>
        <span
          style={{
            display: 'block',
            fontWeight: 600,
            fontSize: '.92rem',
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
          }}
        >
          {desc}
        </span>
      </span>
    </label>
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

'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import {
  initialExerciseFormState,
  type ExerciseFormState,
  type ExerciseFormValues,
  type MetricUnit,
  type Pattern,
  type Tag,
} from '../types'

type Mode = 'create' | 'edit'

interface ExerciseFormProps {
  mode: Mode
  patterns: Pattern[]
  tags: Tag[]
  metricUnits: MetricUnit[]
  initialValues?: ExerciseFormValues
  action: (
    prev: ExerciseFormState,
    formData: FormData,
  ) => Promise<ExerciseFormState>
}

export function ExerciseForm({
  mode,
  patterns,
  tags,
  metricUnits,
  initialValues,
  action,
}: ExerciseFormProps) {
  const [state, formAction, pending] = useActionState<
    ExerciseFormState,
    FormData
  >(action, initialExerciseFormState)

  const v = initialValues
  const selectedTagIds = new Set(v?.tag_ids ?? [])
  const submitLabel =
    mode === 'create'
      ? pending
        ? 'Creating…'
        : 'Create exercise'
      : pending
        ? 'Saving…'
        : 'Save changes'

  return (
    <form action={formAction} style={{ display: 'grid', gap: 18 }}>
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
          desc="Name, movement pattern, and a one-line description."
        />
        <div style={{ padding: '20px 22px', display: 'grid', gap: 14 }}>
          <Field
            name="name"
            label="Name"
            required
            placeholder="Barbell Back Squat"
            defaultValue={v?.name ?? ''}
            error={state.fieldErrors.name}
          />
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}
          >
            <div>
              <FieldLabel>Movement pattern</FieldLabel>
              <select
                name="movement_pattern_id"
                defaultValue={v?.movement_pattern_id ?? ''}
                style={inputStyle}
              >
                <option value="">—</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <Field
              name="video_url"
              label="YouTube URL"
              placeholder="https://youtube.com/…"
              defaultValue={v?.video_url ?? ''}
            />
          </div>
          <TextareaField
            name="description"
            label="Short description"
            placeholder="One-line description that appears on the card."
            defaultValue={v?.description ?? ''}
            rows={2}
          />
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Default prescription"
          desc="Programmed-in defaults. Every use can override these."
        />
        <div
          style={{
            padding: '20px 22px',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 14,
          }}
        >
          <Field
            name="default_sets"
            label="Sets"
            type="number"
            placeholder="4"
            defaultValue={v?.default_sets?.toString() ?? ''}
          />
          <Field
            name="default_reps"
            label="Reps"
            placeholder="8 e/s"
            defaultValue={v?.default_reps ?? ''}
          />
          <div>
            <FieldLabel>Unit</FieldLabel>
            <select
              name="default_metric"
              defaultValue={v?.default_metric ?? ''}
              style={inputStyle}
            >
              <option value="">—</option>
              {metricUnits.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.display_label}
                </option>
              ))}
            </select>
          </div>
          <Field
            name="default_metric_value"
            label="Load"
            placeholder="e.g. 60"
            defaultValue={v?.default_metric_value ?? ''}
          />
          <Field
            name="default_rpe"
            label="RPE"
            type="number"
            placeholder="7"
            defaultValue={v?.default_rpe?.toString() ?? ''}
          />
          <Field
            name="default_rest_seconds"
            label="Rest (sec)"
            type="number"
            placeholder="90"
            defaultValue={v?.default_rest_seconds?.toString() ?? ''}
          />
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Coaching cues"
          desc="Short notes the client sees when performing the exercise."
        />
        <div style={{ padding: '20px 22px' }}>
          <TextareaField
            name="instructions"
            label="Cues / instructions"
            placeholder="Hip-width stance. Brace before descent. Chest up, knees tracking over toes."
            defaultValue={v?.instructions ?? ''}
            rows={4}
          />
        </div>
      </section>

      {tags.length > 0 && (
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <SectionHeader
            title="Tags"
            desc="Optional — used for filtering the library."
          />
          <div
            style={{
              padding: '20px 22px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {tags.map((t) => (
              <label
                key={t.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border-subtle)',
                  background: '#fff',
                  cursor: 'pointer',
                  fontSize: '.82rem',
                  fontWeight: 500,
                  color: 'var(--color-text-light)',
                }}
              >
                <input
                  type="checkbox"
                  name="tag_ids"
                  value={t.id}
                  defaultChecked={selectedTagIds.has(t.id)}
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                #{t.name}
              </label>
            ))}
          </div>
        </section>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          paddingTop: 4,
        }}
      >
        <Link href="/library" className="btn outline">
          Cancel
        </Link>
        <button type="submit" className="btn primary" disabled={pending}>
          {submitLabel}
        </button>
      </div>
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
  error,
  defaultValue,
}: {
  name: string
  label: string
  type?: string
  placeholder?: string
  required?: boolean
  error?: string
  defaultValue?: string
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
  defaultValue,
}: {
  name: string
  label: string
  placeholder?: string
  rows?: number
  defaultValue?: string
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <textarea
        name={name}
        placeholder={placeholder}
        rows={rows}
        defaultValue={defaultValue}
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
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-base)',
  outline: 'none',
  color: 'var(--color-text)',
}

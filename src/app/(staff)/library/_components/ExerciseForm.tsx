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
import {
  VOLUME_UNIT_OPTIONS,
  volumeUnitLabel,
} from '@/lib/prescription/volume-units'

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
  /** Internal path to return to after save/Cancel — already validated by
   *  the page (safeInternalPath); the action re-validates the submitted
   *  copy. Set when the form is launched from the session builder. */
  returnTo?: string
}

export function ExerciseForm({
  mode,
  patterns,
  tags,
  metricUnits,
  initialValues,
  action,
  returnTo,
}: ExerciseFormProps) {
  const [state, formAction, pending] = useActionState<
    ExerciseFormState,
    FormData
  >(action, initialExerciseFormState)

  const v = initialValues
  // Display values: prefer the echo from an errored submit (React 19 resets
  // uncontrolled fields after a server action — the echo restores what the
  // EP typed) over the persisted initial values.
  const echo = state.values
  const d = {
    name: echo?.name ?? v?.name ?? '',
    movement_pattern_id: echo
      ? echo.movement_pattern_id
      : (v?.movement_pattern_id ?? ''),
    video_url: echo?.video_url ?? v?.video_url ?? '',
    description: echo?.description ?? v?.description ?? '',
    instructions: echo?.instructions ?? v?.instructions ?? '',
    default_sets: echo?.default_sets ?? v?.default_sets?.toString() ?? '',
    default_reps: echo?.default_reps ?? v?.default_reps ?? '',
    default_rep_metric: echo
      ? echo.default_rep_metric
      : (v?.default_rep_metric ?? ''),
    default_metric: echo ? echo.default_metric : (v?.default_metric ?? ''),
    default_metric_value:
      echo?.default_metric_value ?? v?.default_metric_value ?? '',
    default_rest_seconds:
      echo?.default_rest_seconds ?? v?.default_rest_seconds?.toString() ?? '',
  }
  const selectedTagIds = new Set(echo ? echo.tag_ids : (v?.tag_ids ?? []))
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
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
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
            defaultValue={d.name}
            error={state.fieldErrors.name}
          />
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}
          >
            <div>
              <FieldLabel>Movement pattern</FieldLabel>
              <select
                name="movement_pattern_id"
                defaultValue={d.movement_pattern_id}
                style={inputStyle}
              >
                <option value="">—</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {/* The exercise's saved pattern can be absent from the
                    active list (soft-deleted in Settings). Without this
                    synthetic option the browser falls back to "—" and the
                    next save silently clears the pattern — keeping the
                    saved id selectable preserves it until the EP changes
                    it deliberately. */}
                {d.movement_pattern_id &&
                  !patterns.some((p) => p.id === d.movement_pattern_id) && (
                    <option value={d.movement_pattern_id}>
                      Current pattern (removed from settings)
                    </option>
                  )}
              </select>
            </div>
            <Field
              name="video_url"
              label="YouTube URL"
              placeholder="https://youtube.com/…"
              defaultValue={d.video_url}
              error={state.fieldErrors.video_url}
            />
          </div>
          <TextareaField
            name="description"
            label="Short description"
            placeholder="One-line description that appears on the card."
            defaultValue={d.description}
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
            defaultValue={d.default_sets}
          />
          <Field
            name="default_reps"
            label="Reps"
            placeholder="8-12"
            defaultValue={d.default_reps}
          />
          <div>
            <FieldLabel>Measure</FieldLabel>
            <select
              name="default_rep_metric"
              defaultValue={d.default_rep_metric}
              style={inputStyle}
            >
              {VOLUME_UNIT_OPTIONS.map((u) => (
                <option key={u.value || 'reps'} value={u.value}>
                  {u.label}
                </option>
              ))}
              {/* Preserve a saved unit not surfaced in the dropdown (e.g.
                  km/miles) so an untouched save doesn't reset it to reps. */}
              {d.default_rep_metric &&
                !VOLUME_UNIT_OPTIONS.some(
                  (u) => u.value === d.default_rep_metric,
                ) && (
                  <option value={d.default_rep_metric}>
                    {volumeUnitLabel(d.default_rep_metric)}
                  </option>
                )}
            </select>
          </div>
          <Field
            name="default_rest_seconds"
            label="Rest (sec)"
            type="number"
            placeholder="90"
            defaultValue={d.default_rest_seconds}
          />
          <div>
            <FieldLabel>Unit</FieldLabel>
            <select
              name="default_metric"
              defaultValue={d.default_metric}
              aria-invalid={state.fieldErrors.default_metric ? true : undefined}
              style={{
                ...inputStyle,
                borderColor: state.fieldErrors.default_metric
                  ? 'var(--color-alert)'
                  : 'var(--color-border-subtle)',
              }}
            >
              <option value="">—</option>
              {metricUnits.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.display_label}
                </option>
              ))}
            </select>
            {state.fieldErrors.default_metric && (
              <div
                style={{
                  fontSize: '.74rem',
                  color: 'var(--color-alert)',
                  marginTop: 4,
                }}
              >
                {state.fieldErrors.default_metric}
              </div>
            )}
          </div>
          <Field
            name="default_metric_value"
            label="Load"
            placeholder="e.g. 60"
            defaultValue={d.default_metric_value}
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
            defaultValue={d.instructions}
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
                  background: 'var(--color-card)',
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
        <Link href={returnTo ?? '/library'} className="btn outline">
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

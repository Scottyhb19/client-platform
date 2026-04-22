'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { CONTACT_GROUPS } from '../../_lib/groups'
import { createContactAction } from '../actions'
import { initialNewContactState, type NewContactState } from '../types'

interface NewContactFormProps {
  defaultGroup?: string
}

export function NewContactForm({ defaultGroup }: NewContactFormProps) {
  const [state, formAction, pending] = useActionState<
    NewContactState,
    FormData
  >(createContactAction, initialNewContactState)

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
          desc="Who they are and how they fit into your referral network."
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
            placeholder="Dr. Alison Harding"
            error={state.fieldErrors.name}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 14,
            }}
          >
            <div>
              <FieldLabel required>Discipline</FieldLabel>
              <select
                name="contact_group"
                defaultValue={defaultGroup ?? ''}
                required
                style={{
                  ...inputStyle,
                  borderColor: state.fieldErrors.contact_group
                    ? 'var(--color-alert)'
                    : 'var(--color-border-subtle)',
                }}
              >
                <option value="" disabled>
                  —
                </option>
                {CONTACT_GROUPS.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
              {state.fieldErrors.contact_group && (
                <div
                  style={{
                    fontSize: '.74rem',
                    color: 'var(--color-alert)',
                    marginTop: 4,
                  }}
                >
                  {state.fieldErrors.contact_group}
                </div>
              )}
            </div>
            <Field
              name="practice"
              label="Practice"
              placeholder="Collins St Medical"
            />
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Contact details"
          desc="At least one is useful; both is better."
        />
        <div
          style={{
            padding: '20px 22px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
          }}
        >
          <Field
            name="phone"
            label="Phone"
            type="tel"
            placeholder="9654 2188"
          />
          <Field
            name="email"
            label="Email"
            type="email"
            placeholder="a.harding@practice.com.au"
          />
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Notes + tags (optional)"
          desc="Tags filter the list. Use short labels separated by commas."
        />
        <div style={{ padding: '20px 22px', display: 'grid', gap: 14 }}>
          <Field
            name="tags"
            label="Tags (comma-separated)"
            placeholder="Primary referrer, Knee, ACL"
          />
          <TextareaField
            name="notes"
            label="Notes"
            placeholder="How they work, their preferences, anything you'd want on hand."
            rows={4}
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
        <Link href="/contacts" className="btn outline">
          Cancel
        </Link>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save contact'}
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

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode
  required?: boolean
}) {
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
      {required && (
        <span
          aria-hidden
          style={{ color: 'var(--color-alert)', marginLeft: 4 }}
        >
          *
        </span>
      )}
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
}: {
  name: string
  label: string
  type?: string
  placeholder?: string
  required?: boolean
  error?: string
}) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
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
      <FieldLabel>{label}</FieldLabel>
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

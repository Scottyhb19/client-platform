'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { inviteClientAction } from '../actions'
import {
  initialInviteClientState,
  type InviteClientState,
} from '../types'

type Category = { id: string; name: string }

interface InviteClientFormProps {
  categories: Category[]
}

export function InviteClientForm({ categories }: InviteClientFormProps) {
  const [state, formAction, pending] = useActionState<
    InviteClientState,
    FormData
  >(inviteClientAction, initialInviteClientState)

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
          title="Personal details"
          desc="Basics the client needs to be reachable."
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
            name="first_name"
            label="First name"
            required
            error={state.fieldErrors.first_name}
          />
          <Field
            name="last_name"
            label="Last name"
            required
            error={state.fieldErrors.last_name}
          />
          <Field
            name="email"
            label="Email"
            type="email"
            placeholder="client@email.com"
            required
            span={2}
            error={state.fieldErrors.email}
          />
          <Field
            name="phone"
            label="Phone"
            type="tel"
            placeholder="04… (optional)"
          />
          <Field name="dob" label="Date of birth" type="date" />
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <SectionHeader
          title="Practice context"
          desc="How this client fits into your caseload."
        />
        <div
          style={{
            padding: '20px 22px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
          }}
        >
          <div>
            <FieldLabel>Category</FieldLabel>
            <select name="category_id" defaultValue="" style={inputStyle}>
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Field
            name="referral_source"
            label="Referral source"
            placeholder="GP, self, ACL clinic…"
          />
        </div>
      </section>

      <section className="card" style={{ padding: '18px 22px' }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            name="send_invite"
            defaultChecked
            style={{ marginTop: 4, accentColor: 'var(--color-accent)' }}
          />
          <span>
            <span
              style={{
                fontWeight: 600,
                fontSize: '.92rem',
                display: 'block',
              }}
            >
              Mark as ready to invite
            </span>
            <span
              style={{
                fontSize: '.82rem',
                color: 'var(--color-text-light)',
                display: 'block',
                marginTop: 2,
              }}
            >
              Records an invite date on the client so they show as “New” in the
              list. Portal emails go out once the client portal launches — uncheck
              to just add the record without flagging for invite yet.
            </span>
          </span>
        </label>
      </section>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
          paddingTop: 4,
        }}
      >
        <Link href="/clients" className="btn outline">
          Cancel
        </Link>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Creating…' : 'Invite client'}
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
  span,
  error,
}: {
  name: string
  label: string
  type?: string
  placeholder?: string
  required?: boolean
  span?: number
  error?: string
}) {
  return (
    <div style={{ gridColumn: span === 2 ? '1 / -1' : undefined }}>
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

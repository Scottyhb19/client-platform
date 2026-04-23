'use client'

import { useActionState } from 'react'
import { updatePracticeInfoAction } from '../actions'
import { initialSettingsState, type SettingsState } from '../_state'

export type PracticeInfo = {
  name: string
  email: string | null
  phone: string | null
  address: string | null
  abn: string | null
  provider_number: string | null
  timezone: string
}

const TIMEZONES = [
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Perth',
  'Australia/Hobart',
  'Australia/Darwin',
  'UTC',
]

export function PracticeInfoForm({ info }: { info: PracticeInfo }) {
  const [state, formAction, pending] = useActionState<
    SettingsState,
    FormData
  >(updatePracticeInfoAction, initialSettingsState)

  return (
    <form
      action={formAction}
      style={{ padding: '20px 22px', display: 'grid', gap: 14 }}
    >
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">Saved.</Banner>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <Field
          name="name"
          label="Practice name"
          required
          defaultValue={info.name}
        />
        <Field
          name="email"
          label="Email"
          type="email"
          defaultValue={info.email ?? ''}
        />
        <Field
          name="phone"
          label="Phone"
          type="tel"
          defaultValue={info.phone ?? ''}
        />
        <div>
          <FieldLabel>Timezone</FieldLabel>
          <select
            name="timezone"
            defaultValue={info.timezone}
            style={inputStyle}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <Field
          name="address"
          label="Address"
          span={2}
          defaultValue={info.address ?? ''}
        />
        <Field name="abn" label="ABN" defaultValue={info.abn ?? ''} />
        <Field
          name="provider_number"
          label="Provider number"
          defaultValue={info.provider_number ?? ''}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save practice info'}
        </button>
      </div>
    </form>
  )
}

export function NotificationsFormFallback() {
  return null
}

/* Helpers + shared styles */

function Banner({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'error' | 'success'
}) {
  const bg =
    tone === 'error'
      ? 'rgba(214,64,69,.08)'
      : 'rgba(45,178,76,.08)'
  const border =
    tone === 'error'
      ? 'rgba(214,64,69,.25)'
      : 'rgba(45,178,76,.25)'
  const color =
    tone === 'error' ? 'var(--color-alert)' : 'var(--color-accent)'
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        padding: '10px 14px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        color,
        fontSize: '.86rem',
      }}
    >
      {children}
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
  defaultValue,
  required,
  span,
}: {
  name: string
  label: string
  type?: string
  defaultValue?: string
  required?: boolean
  span?: number
}) {
  return (
    <div style={{ gridColumn: span === 2 ? '1 / -1' : undefined }}>
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        style={inputStyle}
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

export { Banner, inputStyle, FieldLabel }

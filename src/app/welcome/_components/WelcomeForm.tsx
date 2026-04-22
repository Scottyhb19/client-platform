'use client'

import { useActionState } from 'react'
import { setPasswordAndAcceptAction } from '../actions'
import { initialWelcomeState, type WelcomeState } from '../types'

export function WelcomeForm({ clientId }: { clientId: string }) {
  const [state, formAction, pending] = useActionState<
    WelcomeState,
    FormData
  >(setPasswordAndAcceptAction, initialWelcomeState)

  return (
    <form
      action={formAction}
      style={{ display: 'grid', gap: 14, marginTop: 22 }}
    >
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

      <Field
        name="password"
        label="Set a password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors.password}
      />
      <Field
        name="confirm"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors.confirm}
      />

      <button
        type="submit"
        className="btn primary"
        disabled={pending}
        style={{ justifyContent: 'center', marginTop: 6 }}
      >
        {pending ? 'Setting up…' : 'Continue to portal'}
      </button>
    </form>
  )
}

function Field({
  name,
  label,
  type = 'text',
  autoComplete,
  required,
  error,
}: {
  name: string
  label: string
  type?: string
  autoComplete?: string
  required?: boolean
  error?: string
}) {
  return (
    <div>
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
        {label}
        {required && (
          <span
            aria-hidden
            style={{ color: 'var(--color-alert)', marginLeft: 4 }}
          >
            *
          </span>
        )}
      </div>
      <input
        name={name}
        type={type}
        required={required}
        autoComplete={autoComplete}
        style={{
          width: '100%',
          height: 40,
          padding: '0 12px',
          border: `1px solid ${
            error ? 'var(--color-alert)' : 'var(--color-border-subtle)'
          }`,
          borderRadius: 7,
          background: 'var(--color-surface)',
          fontFamily: 'var(--font-sans)',
          fontSize: '.95rem',
          outline: 'none',
          color: 'var(--color-text)',
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

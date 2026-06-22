'use client'

import { useActionState } from 'react'
import { updateNotificationsAction } from '../actions'
import { initialSettingsState, type SettingsState } from '../_state'
import { Banner, FieldLabel, inputStyle } from './PracticeInfoForm'

export type NotificationSettings = {
  email_notifications_enabled: boolean
  sms_notifications_enabled: boolean
  reminder_lead_hours: number
}

const LEAD_OPTIONS = [
  { value: 2, label: '2 hours before' },
  { value: 12, label: '12 hours before' },
  { value: 24, label: '24 hours before' },
  { value: 48, label: '48 hours before' },
  { value: 72, label: '3 days before' },
  { value: 168, label: '1 week before' },
]

export function NotificationsForm({
  settings,
}: {
  settings: NotificationSettings
}) {
  const [state, formAction, pending] = useActionState<
    SettingsState,
    FormData
  >(updateNotificationsAction, initialSettingsState)

  return (
    <form
      action={formAction}
      style={{ padding: '20px 22px', display: 'grid', gap: 14 }}
    >
      {state.error && <Banner tone="error">{state.error}</Banner>}
      {state.success && <Banner tone="success">Saved.</Banner>}

      <Toggle
        name="email_notifications_enabled"
        label="Email notifications"
        desc="Appointment confirmations and reminders"
        defaultChecked={settings.email_notifications_enabled}
      />
      {/* SMS is stubbed for the beta (CLAUDE.md §12) — honest disabled control
          rather than a toggle that persists but never sends. P2-4. */}
      <Toggle
        name="sms_notifications_enabled"
        label="SMS notifications"
        desc="Coming soon — SMS reminders aren't active in the beta"
        defaultChecked={false}
        disabled
      />

      <div>
        <FieldLabel>Reminder lead time</FieldLabel>
        <select
          name="reminder_lead_hours"
          defaultValue={String(settings.reminder_lead_hours)}
          style={{ ...inputStyle, width: 220 }}
        >
          {LEAD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button type="submit" className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save notification prefs'}
        </button>
      </div>
    </form>
  )
}

function Toggle({
  name,
  label,
  desc,
  defaultChecked,
  disabled,
}: {
  name: string
  label: string
  desc: string
  defaultChecked?: boolean
  disabled?: boolean
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 0',
        borderBottom: '1px solid var(--color-grid-line)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span>
        <span
          style={{
            display: 'block',
            fontWeight: 600,
            fontSize: '.88rem',
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: '.76rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
          }}
        >
          {desc}
        </span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        style={{
          width: 18,
          height: 18,
          accentColor: 'var(--color-accent)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      />
    </label>
  )
}

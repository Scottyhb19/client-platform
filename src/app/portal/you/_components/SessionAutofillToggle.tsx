'use client'

import { useState } from 'react'
import { setAutofillEnabled } from '../../_lib/session-autofill'

/**
 * Per-device "autofill" preference for the in-session logging form
 * (section 7 / P1-2 follow-up). On: each set's boxes pre-fill from your
 * last entry and the prescription, and your numbers carry forward as you
 * log. Off: blank boxes. Stored in a cookie (read server-side by the
 * session page so the first paint is correct); the initial state is passed
 * in from the server to avoid a flash.
 */
export function SessionAutofillToggle({ initialOn }: { initialOn: boolean }) {
  const [on, setOn] = useState(initialOn)

  function choose(next: boolean) {
    setOn(next)
    setAutofillEnabled(next)
  }

  const options: Array<{ label: string; value: boolean }> = [
    { label: 'On', value: true },
    { label: 'Off', value: false },
  ]

  return (
    <div
      className="portal-card is-compact"
      style={{ padding: '14px 16px', marginBottom: 8 }}
    >
      <div
        className="portal-eyebrow"
        style={{
          fontSize: '.7rem',
          color: 'var(--color-primary)',
          marginBottom: 8,
        }}
      >
        Autofill sets
      </div>
      <div
        role="group"
        aria-label="Autofill sets"
        style={{ display: 'flex', gap: 8 }}
      >
        {options.map((opt) => {
          const active = on === opt.value
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => choose(opt.value)}
              aria-pressed={active}
              className={active ? 'portal-tab is-active' : 'portal-tab'}
              style={{ cursor: 'pointer' }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      <div
        style={{
          fontSize: '.74rem',
          color: 'var(--color-text-light)',
          marginTop: 8,
          lineHeight: 1.4,
        }}
      >
        Pre-fills each set from your last entry and the plan, so you only
        change what&rsquo;s different. Off starts every box blank.
      </div>
    </div>
  )
}

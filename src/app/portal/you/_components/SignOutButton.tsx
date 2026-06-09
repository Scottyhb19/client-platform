'use client'

import { useState } from 'react'
import { logout } from '../../../login/actions'

/**
 * Sign-out trigger + soft confirmation.
 *
 * The trigger is the unchanged lower-key sign-out control from the You page;
 * tapping it no longer ends the session immediately — it opens a centred
 * confirm dialog (operator request: a stray tap on a shared/family device
 * shouldn't sign the client out). The dialog mirrors the portal's existing
 * ConfirmOverlay (see DayScreen.tsx): a .portal-card on a plain dimmed
 * backdrop — no blur, per the design system — with two stacked CTAs.
 *
 * The confirm CTA is destructive-red via .portal-btn-danger (→ var(--color-
 * alert), the same token the booking-cancel control uses). logout() stays a
 * server action submitted by a <form>, so sign-out still works without JS and
 * runs the identical path staff use. "No" is type="button", so it dismisses
 * without submitting; a backdrop tap dismisses too.
 */
export function SignOutButton() {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="portal-btn-secondary"
        // Unchanged from the original inline control: a smaller sans-font,
        // lower-key action, not the full-display-font CTA the class assumes.
        style={{
          marginTop: 18,
          padding: 14,
          fontFamily: 'var(--font-sans)',
          fontWeight: 600,
          fontSize: '.9rem',
          borderRadius: 'var(--radius-chip)',
          color: 'var(--color-text)',
        }}
      >
        Sign out
      </button>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm sign out"
          onClick={() => setConfirming(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            zIndex: 50,
          }}
        >
          <div
            className="portal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 380, padding: 20 }}
          >
            <p
              style={{
                fontSize: '.95rem',
                lineHeight: 1.5,
                color: 'var(--color-charcoal)',
                margin: '0 0 18px',
              }}
            >
              Are you sure you want to sign out?
            </p>
            <form
              action={logout}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <button type="submit" className="portal-btn-danger">
                Yes, sign out
              </button>
              <button
                type="button"
                className="portal-btn-secondary"
                onClick={() => setConfirming(false)}
              >
                No
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}

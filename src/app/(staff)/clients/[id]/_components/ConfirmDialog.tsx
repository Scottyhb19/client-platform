'use client'

/**
 * CN-13 — small on-system confirm dialog for clinical flows, replacing
 * browser-native confirm()/alert(). Shape and restraint mirror the
 * ArchiveConfirm precedent in ClientProfile.tsx: dark scrim, 440px card,
 * display-font heading, factual body copy, persistent error block, and a
 * Cancel + tonal confirm pair. No motion beyond the standard transitions —
 * dialogs appear still, per the design system.
 *
 * `tone` picks the confirm button: 'alert' for destructive verbs
 * (archive), 'primary' for content-replacing but recoverable verbs
 * (replace draft with copied note).
 *
 * When `error` is set the dialog stays open and shows it — the caller
 * decides whether to retry or cancel. `busy` dims and locks both buttons.
 */

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'alert',
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  tone?: 'alert' | 'primary'
  busy?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-heading"
      onClick={() => {
        if (!busy) onCancel()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 110,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="confirm-dialog-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 8px',
            color: 'var(--color-charcoal)',
          }}
        >
          {title}
        </h2>
        <div
          style={{
            fontSize: '.9rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.55,
            margin: '0 0 18px',
          }}
        >
          {body}
        </div>
        {error && (
          <div
            role="alert"
            style={{
              padding: '10px 12px',
              background: 'rgba(214,64,69,.08)',
              border: '1px solid rgba(214,64,69,.25)',
              borderRadius: 8,
              color: 'var(--color-alert)',
              fontSize: '.84rem',
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            className="btn outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          {tone === 'primary' ? (
            <button
              type="button"
              className="btn primary"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          ) : (
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: '.84rem',
                padding: '8px 16px',
                borderRadius: 7,
                border: '1px solid var(--color-alert)',
                background: 'var(--color-alert)',
                color: '#fff',
                cursor: busy ? 'not-allowed' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

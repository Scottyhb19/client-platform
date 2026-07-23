import { logout } from '@/app/login/actions'

/**
 * P2-3 — the archived client's designed end-state (CN-7 residual, closed
 * 2026-07-23). An archived client can still authenticate (their auth user
 * survives archive by design — the record is retained), but every
 * clients-dependent portal read is RLS-empty. Before this screen existed the
 * layout redirected them into /welcome — the onboarding funnel — which read
 * as a broken app. This is the closed door instead: quiet, factual, one
 * action (sign out — the same logout server action the You page uses, via a
 * plain <form> so it works without JS).
 *
 * Deliberately renders WITHOUT the portal nav shell — there is nothing to
 * navigate to.
 */
export function AccessEnded({ practiceName }: { practiceName: string | null }) {
  return (
    <div className="portal-shell">
      <div
        className="portal-shell__column"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 360, width: '100%' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '1.7rem',
              lineHeight: 1.2,
              margin: '0 0 12px',
              color: 'var(--color-text)',
            }}
          >
            Your portal access has ended
          </h1>
          <p
            style={{
              fontSize: '.9rem',
              lineHeight: 1.55,
              margin: '0 0 8px',
              color: 'var(--color-text-light)',
            }}
          >
            {practiceName ?? 'Your practice'} has closed this portal account.
            Your records are retained by the practice.
          </p>
          <p
            style={{
              fontSize: '.9rem',
              lineHeight: 1.55,
              margin: '0 0 24px',
              color: 'var(--color-text-light)',
            }}
          >
            If you think this is a mistake, or you need a copy of your
            records, contact your practitioner directly.
          </p>
          <form action={logout}>
            <button
              type="submit"
              className="portal-btn-secondary"
              style={{
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
          </form>
        </div>
      </div>
    </div>
  )
}

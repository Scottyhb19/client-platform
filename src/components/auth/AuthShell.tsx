/**
 * Shared two-column auth shell — the charcoal brand panel on the left,
 * page-specific form on the right. Used by /login, /signup, /welcome, and
 * /welcome/install so the auth journey reads as one continuous experience
 * rather than four disconnected screens.
 *
 * Design source: Odyssey Practice Platform Deck slide 02 ("Sign in &
 * onboarding"). The brand panel collapses on small screens (lg breakpoint)
 * — mobile clients arriving from the install email never see it.
 */

import Link from 'next/link'

interface AuthShellProps {
  children: React.ReactNode
  /**
   * Optional override for the right-column container width. Defaults to
   * 420px which matches the deck's LoginForm width. Wider forms (e.g.
   * onboarding pickers) can pass a larger value.
   */
  formMaxWidth?: number
}

export function AuthShell({ children, formMaxWidth = 420 }: AuthShellProps) {
  return (
    <main className="flex flex-1 min-h-[920px] bg-surface">
      <div className="grid grid-cols-1 lg:grid-cols-2 w-full">
        <BrandPanel />
        <section className="flex items-center justify-center px-6 py-16 lg:px-20 lg:py-[60px]">
          <div className="w-full" style={{ maxWidth: formMaxWidth }}>
            <MobileBrand />
            {children}
          </div>
        </section>
      </div>
    </main>
  )
}

/**
 * Left-side brand panel. Hidden on mobile — the form takes the full width
 * with just a small logo above it (see MobileBrand below).
 */
function BrandPanel() {
  return (
    <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-charcoal text-white px-16 py-[60px]">
      <div>
        <Link
          href="/"
          className="font-display font-extrabold leading-none text-white/95 inline-block"
          style={{ fontSize: '110.4px', textDecoration: 'none' }}
        >
          Odyssey<span className="text-accent">.</span>
        </Link>
      </div>

      <div className="relative z-10">
        <div className="font-display font-bold uppercase tracking-[0.08em] text-white/40 mb-5 text-[0.7rem]">
          For Exercise Physiologists
        </div>
        <h1 className="font-display font-extrabold text-white m-0 leading-[1.05] tracking-[-0.015em] text-[3.2rem]">
          One platform.
          <br />
          <span className="text-white/50">Your clinical practice.</span>
          <br />
          <span className="text-white/50">Your programming.</span>
        </h1>
        <p className="text-white/60 text-[0.95rem] leading-[1.6] mt-6 max-w-[380px]">
          One platform for clinical practice and programming. Built for solo
          practitioners who care about both the clinic note and the rep
          range.
        </p>
      </div>

      {/* Decorative accent glow — same offsets as deck. */}
      <div
        aria-hidden
        className="absolute pointer-events-none rounded-full"
        style={{
          right: -120,
          top: 200,
          width: 360,
          height: 360,
          background:
            'radial-gradient(circle, rgba(45,178,76,.18), transparent 70%)',
        }}
      />
    </aside>
  )
}

function MobileBrand() {
  return (
    <div className="lg:hidden mb-10">
      <div className="font-display font-extrabold text-charcoal text-4xl leading-none">
        Odyssey<span className="text-accent">.</span>
      </div>
    </div>
  )
}

/**
 * Standard form-area atoms reused by every auth page so eyebrow / heading /
 * subtitle treatments stay identical across /login, /signup, /welcome, and
 * /welcome/install.
 */
export function AuthEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display font-bold uppercase tracking-[0.06em] text-muted text-[0.72rem] mb-2">
      {children}
    </div>
  )
}

export function AuthHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display font-extrabold text-charcoal text-[1.9rem] m-0 mb-2 leading-tight">
      {children}
    </h2>
  )
}

export function AuthSubtitle({ children }: { children: React.ReactNode }) {
  return <p className="text-text-light text-[0.9rem] mb-7">{children}</p>
}

export function AuthAlert({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info'
  children: React.ReactNode
}) {
  const cls =
    kind === 'error'
      ? 'border-alert/30 bg-alert/5 text-alert'
      : 'border-primary/30 bg-primary/5 text-primary'
  return (
    <div
      role="alert"
      className={`mb-5 rounded-[8px] border ${cls} px-4 py-3 text-sm`}
    >
      {children}
    </div>
  )
}

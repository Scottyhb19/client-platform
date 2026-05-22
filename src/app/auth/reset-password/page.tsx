import { redirect } from 'next/navigation'
import {
  AuthAlert,
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { setNewPassword } from './actions'

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  // Tier-one session-PRESENCE guard only. It confirms that some authenticated
  // session exists before rendering the set-new-password form; it does NOT
  // distinguish a Supabase recovery session from an ordinary authenticated one.
  // The codebase exposes no recovery/aal/amr discriminator today (confirmed by
  // inspection), so a logged-in non-recovery user reaching this page is a known
  // open risk deferred to a dedicated follow-up — it is NOT closed here.
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/forgot-password')
  }

  return (
    <AuthShell>
      <AuthEyebrow>Reset password</AuthEyebrow>
      <AuthHeading>Set a new password.</AuthHeading>
      <AuthSubtitle>Choose a new password for your account.</AuthSubtitle>

      {params.error && <AuthAlert>{params.error}</AuthAlert>}

      <form action={setNewPassword} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
          >
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
          />
          <span className="text-[0.74rem] text-text-light">
            At least 12 characters.
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="confirmPassword"
            className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
          >
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
          />
        </div>

        <button
          type="submit"
          className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark"
        >
          Set new password
        </button>
      </form>
    </AuthShell>
  )
}

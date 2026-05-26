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
  searchParams: Promise<{ error?: string; ticket?: string }>
}) {
  const params = await searchParams

  // Two presence gates — both must hold before the form is rendered.
  // Neither is the security gate; the security gate lives in actions.ts,
  // which calls consume_recovery_ticket(p_ticket_id) atomically before
  // updateUser (Gate 2 of the recovery-session conflation fix; the
  // table + RPC landed in Gate 1, commit 1152df8). consume_recovery_
  // ticket's WHERE-clause binds the ticket's email to auth.uid()'s
  // auth.users row inside one UPDATE, so a hostile session with no
  // matching ticket-email pair gets a NULL consume and the password
  // write is refused at the action.
  //
  // The page-level checks here are UX, not security: don't render a
  // form that cannot possibly submit successfully — bounce to
  // /forgot-password instead.
  //
  // Critically, this page MUST NOT call consume_recovery_ticket itself.
  // Consuming on render would either (a) burn the single-use ticket
  // before the user submits, or (b) split validation from consumption
  // across two requests and reintroduce a time-of-check-to-time-of-
  // use gap. Consumption belongs in the action, immediately before
  // the password write.
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/forgot-password')
  }
  if (!params.ticket) {
    redirect('/forgot-password')
  }

  return (
    <AuthShell>
      <AuthEyebrow>Reset password</AuthEyebrow>
      <AuthHeading>Set a new password.</AuthHeading>
      <AuthSubtitle>Choose a new password for your account.</AuthSubtitle>

      {params.error && <AuthAlert>{params.error}</AuthAlert>}

      <form action={setNewPassword} className="flex flex-col gap-4">
        <input type="hidden" name="ticket" value={params.ticket} />
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

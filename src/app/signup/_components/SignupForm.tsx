'use client'

import { useActionState } from 'react'
import { AuthAlert, AuthSubtitle } from '@/components/auth/AuthShell'
import { ResendConfirmationButton } from '@/components/auth/ResendConfirmationButton'
import { signup } from '../actions'
import { initialSignupState } from '../types'

export function SignupForm({ urlError }: { urlError?: string }) {
  const [state, formAction, pending] = useActionState(
    signup,
    initialSignupState,
  )

  if (state.status === 'check-email') {
    return (
      <>
        <AuthSubtitle>One more step.</AuthSubtitle>
        <AuthAlert kind="info">
          Check your email. We sent a confirmation link — click it to
          finish creating your account.
        </AuthAlert>
        <ResendConfirmationButton email={state.email} />
      </>
    )
  }

  const shownError = state.error ?? urlError ?? null

  return (
    <>
      <AuthSubtitle>
        Create an account. You&rsquo;ll name your practice on the next
        screen.
      </AuthSubtitle>

      {shownError && <AuthAlert>{shownError}</AuthAlert>}

      <form action={formAction} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="email"
            className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={state.email}
            className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="password"
            className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
          >
            Password
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

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </>
  )
}

'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { AuthAlert } from '@/components/auth/AuthShell'
import { login } from '../actions'
import { initialLoginState } from '../types'

export function LoginForm({
  urlError,
  next,
}: {
  urlError?: string
  next: string
}) {
  const [state, formAction, pending] = useActionState(login, initialLoginState)

  const shownError = state.error ?? urlError ?? null

  return (
    <>
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
          <div className="flex items-center justify-between">
            <label
              htmlFor="password"
              className="font-medium uppercase tracking-[0.04em] text-muted text-[0.7rem]"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-[0.7rem] font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full bg-surface border border-border-subtle rounded-[7px] px-3 py-[9px] text-[0.85rem] text-text outline-none transition-colors focus:border-primary focus:bg-card"
          />
        </div>

        <p className="mt-1 text-[0.82rem] text-text-light">
          You&rsquo;ll stay signed in for 30 days.
        </p>

        <input type="hidden" name="next" value={next} />

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark disabled:opacity-60"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="mt-4 text-center text-[0.84rem] text-text-light">
          New to Odyssey?{' '}
          <Link
            href="/signup"
            className="font-semibold text-primary hover:underline"
          >
            Set up your practice
          </Link>
        </div>
      </form>
    </>
  )
}

'use client'

import { useFormStatus } from 'react-dom'

/**
 * The button that closes the click-through gate.
 *
 * C-11: the tap submits a form to continueInviteAction (bound to the
 * token id by the page), which atomically burns invite_tokens.consumed_at
 * and redirects to the Supabase action_link server-side. The action_link
 * is NOT in this component's props, the page HTML, or the JS bundle —
 * a body-parsing scanner that GETs the gate finds nothing to follow, and
 * scanners do not execute form POSTs. This supersedes the original
 * window.location.assign(actionLink) design, whose embedded link was the
 * C-14 deferred design weakness.
 *
 * A plain form + submit button also works without JavaScript — the
 * original onClick-only button did not.
 */
export function ContinueGate({
  continueAction,
}: {
  continueAction: () => Promise<void>
}) {
  return (
    <form action={continueAction}>
      <GateButton />
    </form>
  )
}

function GateButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark disabled:opacity-70"
    >
      {pending ? 'Opening your portal…' : 'Continue to your portal'}
    </button>
  )
}

'use client'

import { useState } from 'react'

/**
 * The button that closes the click-through gate.
 *
 * Critical: navigation happens via window.location.assign on a real onClick,
 * NOT a server-rendered <a href> or a router push. Why: Gmail (and other
 * scanners) pre-fetch every URL they find in HTML to scan for malware. An
 * <a href={actionLink}> would be visible to a scanner that follows links
 * inside the gate page; window.location.assign in a click handler is not
 * crawlable. The action_link is still in the page bundle, but only the
 * tap actually navigates to it — and a tap is what we want anyway.
 */
export function ContinueGate({ actionLink }: { actionLink: string }) {
  const [going, setGoing] = useState(false)

  function handleClick() {
    if (going) return
    setGoing(true)
    window.location.assign(actionLink)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={going}
      className="mt-1 w-full rounded-[7px] bg-primary text-white font-semibold text-[0.92rem] px-[22px] py-3 transition-colors hover:bg-primary-dark disabled:opacity-70"
    >
      {going ? 'Opening your portal…' : 'Continue to your portal'}
    </button>
  )
}

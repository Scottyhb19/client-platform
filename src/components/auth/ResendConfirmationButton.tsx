'use client'

import { useState, useTransition } from 'react'
import {
  resendConfirmation,
  type ResendResult,
} from '@/lib/auth/resend-confirmation'

export function ResendConfirmationButton({ email }: { email: string }) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<ResendResult | null>(null)

  function handleResend() {
    startTransition(async () => {
      setResult(await resendConfirmation(email))
    })
  }

  if (result?.status === 'sent') {
    return (
      <p className="mt-4 text-center text-[0.84rem] text-text-light">
        Confirmation email sent. Check your inbox.
      </p>
    )
  }

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        onClick={handleResend}
        disabled={isPending}
        className="text-[0.84rem] font-medium text-primary hover:underline disabled:opacity-60"
      >
        {isPending ? 'Sending…' : 'Didn’t get the email? Send it again'}
      </button>
      {result?.status === 'error' && (
        <p className="mt-2 text-[0.82rem] text-text-light">{result.error}</p>
      )}
    </div>
  )
}

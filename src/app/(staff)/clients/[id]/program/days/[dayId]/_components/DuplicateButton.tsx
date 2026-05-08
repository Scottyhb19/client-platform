'use client'

import { Copy } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { duplicateProgramDayAction } from '../../../day-actions'
import { SingleDatePicker } from '../../../_components/SingleDatePicker'

/*
 * Phase I §2.13 — the Duplicate button on the session-builder page header.
 *
 * Click → SingleDatePicker modal → on confirm, fires
 * duplicateProgramDayAction. Behaviour matches the gap doc:
 *   - The cloned day lands as a draft on the chosen date.
 *   - Source day stays untouched.
 *   - On success the user is navigated to the new day's session builder.
 *   - Conflict / no-program responses surface a non-blocking error
 *     message inside the picker; the picker stays open so the EP can
 *     pick a different date without re-opening it.
 *
 * Refuse-on-conflict (Q1 sign-off 2026-05-08): there is no overwrite
 * dialog. The error states the constraint and the EP picks again.
 */

interface DuplicateButtonProps {
  clientId: string
  sourceDayId: string
  /** ISO 'YYYY-MM-DD' — the source day's scheduled_date. Used to anchor the picker. */
  sourceDate: string | null
  /** Disabled when the day has nothing to duplicate. */
  disabled?: boolean
}

export function DuplicateButton({
  clientId,
  sourceDayId,
  sourceDate,
  disabled = false,
}: DuplicateButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function close() {
    if (pending) return
    setOpen(false)
    setError(null)
  }

  function handleConfirm(targetDate: string) {
    setError(null)
    startTransition(async () => {
      const result = await duplicateProgramDayAction(
        clientId,
        sourceDayId,
        targetDate,
      )
      if ('error' in result) {
        setError(result.error)
        return
      }
      if (result.status === 'conflict') {
        setError('A session is already scheduled for that date. Pick a different one.')
        return
      }
      if (result.status === 'no_program') {
        setError(
          'No active training block covers that date. Create or extend a block first.',
        )
        return
      }
      // Success — navigate to the new day's session builder. revalidatePath
      // already ran inside the action so the calendar will be fresh too.
      router.push(`/clients/${clientId}/program/days/${result.newDayId}`)
    })
  }

  return (
    <>
      <button
        type="button"
        className="btn outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Copy size={14} aria-hidden />
        Duplicate
      </button>

      {open && (
        <SingleDatePicker
          anchorDate={sourceDate ?? undefined}
          title="Duplicate this session"
          description={
            error
              ? error
              : 'The chosen date inherits this session’s exercises as a draft.'
          }
          confirmLabel="Duplicate"
          busy={pending}
          onCancel={close}
          onConfirm={handleConfirm}
        />
      )}
    </>
  )
}

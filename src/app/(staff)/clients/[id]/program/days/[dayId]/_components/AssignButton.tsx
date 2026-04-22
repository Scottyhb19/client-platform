'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Send } from 'lucide-react'
import {
  publishProgramDayAction,
  unpublishProgramDayAction,
} from '../actions'

interface AssignButtonProps {
  clientId: string
  dayId: string
  clientFirstName: string
  publishedAt: string | null
  exerciseCount: number
}

export function AssignButton({
  clientId,
  dayId,
  clientFirstName,
  publishedAt,
  exerciseCount,
}: AssignButtonProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const published = publishedAt !== null

  function handlePublish() {
    startTransition(async () => {
      const res = await publishProgramDayAction(clientId, dayId)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleUnpublish() {
    if (
      !confirm(
        `Unpublish this session? ${clientFirstName} will stop seeing it in the portal.`,
      )
    )
      return
    startTransition(async () => {
      const res = await unpublishProgramDayAction(clientId, dayId)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  if (published) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '6px 10px',
            background: 'rgba(45,178,76,.12)',
            borderRadius: 8,
            fontSize: '.76rem',
            fontWeight: 600,
            color: 'var(--color-primary)',
          }}
        >
          <Check size={12} aria-hidden />
          Assigned · {formatAssignedTime(publishedAt)}
        </span>
        <button
          type="button"
          onClick={handleUnpublish}
          disabled={pending}
          className="btn outline"
          style={{ fontSize: '.82rem' }}
        >
          Unassign
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handlePublish}
      disabled={pending || exerciseCount === 0}
      className="btn primary"
      title={
        exerciseCount === 0
          ? 'Add at least one exercise before assigning.'
          : undefined
      }
    >
      <Send size={14} aria-hidden />
      {pending
        ? 'Assigning…'
        : `Assign to ${clientFirstName}`}
    </button>
  )
}

function formatAssignedTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

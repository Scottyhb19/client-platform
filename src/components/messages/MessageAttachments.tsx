'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import type { AttachmentView } from '@/lib/messages/types'

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

/**
 * Renders a message's attachments inside a bubble — shared by the staff
 * ThreadPane and the portal ClientThread so image/file treatment can never
 * drift between surfaces.
 *
 * Images render inline from the pre-minted signed URL (opens full-size in a
 * new tab on tap). Files render as a quiet chip; the download URL is minted
 * on click via the role-specific action the parent injects, so the link can
 * carry the original filename. If an image URL is missing/expired, it falls
 * back to the file-chip treatment rather than a broken <img>.
 */
export function MessageAttachments({
  attachments,
  onDownload,
}: {
  attachments: AttachmentView[]
  onDownload: (attachmentId: string) => Promise<{ url: string | null; error: string | null }>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (attachments.length === 0) return null

  async function openDownload(id: string) {
    if (busyId) return
    setBusyId(id)
    setError(null)
    const res = await onDownload(id)
    setBusyId(null)
    if (!res.url) {
      setError(res.error ?? 'Could not open attachment.')
      return
    }
    window.open(res.url, '_blank', 'noopener')
  }

  return (
    <div className="msg-attachments">
      {attachments.map((a) =>
        a.kind === 'image' && a.url ? (
          <a
            key={a.id}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            className="msg-attach-img-link"
          >
            {/* Signed URLs point at Supabase storage, not a Next-optimisable
                source; a plain img is deliberate here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.fileName} className="msg-attach-img" />
          </a>
        ) : (
          <button
            key={a.id}
            type="button"
            className="msg-attach-file"
            onClick={() => void openDownload(a.id)}
            disabled={busyId === a.id}
          >
            <FileText size={14} aria-hidden />
            <span className="msg-attach-file__name">{a.fileName}</span>
            <span className="msg-attach-file__size">
              {busyId === a.id ? 'Opening…' : formatBytes(a.byteSize)}
            </span>
          </button>
        ),
      )}
      {error && <div className="msg-attach-error">{error}</div>}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { FileText, X } from 'lucide-react'
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
 * SECURITY (reviewer finding (a), 2026-07-13): `storage.objects` mimetype is
 * caller-controlled — a probe proved a client can store SVG/HTML bytes under
 * a declared `image/png` Content-Type, and the blob serves back as image/png
 * with no `X-Content-Type-Options: nosniff`. So we do NOT trust the stored
 * type for safety. Images render ONLY through <img>, which the browser loads
 * in "secure static mode": SVG scripts never execute, external subresources
 * never load, and raster-typed bytes that aren't valid images just fail to
 * decode (a broken image, never code). Crucially there is NO anchor/new-tab
 * navigation to the raw signed URL — that top-level-navigation path was the
 * one place a no-nosniff response could be content-sniffed and executed.
 * "View larger" is an in-DOM lightbox (same <img>, no navigation). Files
 * always download (never render inline); the RPC classifies SVG as kind=file.
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
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null)

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
    // File downloads carry a Content-Disposition: attachment disposition
    // (minted server-side), so this saves the file rather than rendering it.
    window.location.assign(res.url)
  }

  return (
    <div className="msg-attachments">
      {attachments.map((a) =>
        a.kind === 'image' && a.url ? (
          <button
            key={a.id}
            type="button"
            className="msg-attach-img-btn"
            onClick={() => setLightbox({ url: a.url!, alt: a.fileName })}
            aria-label={`View ${a.fileName}`}
          >
            {/* Signed URL → Supabase storage (cross-origin from the app).
                <img> renders in secure static mode; see the file header. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={a.url} alt={a.fileName} className="msg-attach-img" />
          </button>
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
      {lightbox && (
        <Lightbox
          url={lightbox.url}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

/**
 * Full-screen image overlay. Pure in-DOM — same <img>, no navigation, no raw
 * URL exposed to a top-level context. Esc / tap-outside closes.
 */
function Lightbox({
  url,
  alt,
  onClose,
}: {
  url: string
  alt: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="msg-lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <button type="button" className="msg-lightbox__close" aria-label="Close" onClick={onClose}>
        <X size={20} aria-hidden />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="msg-lightbox__img"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

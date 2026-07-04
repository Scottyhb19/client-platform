import type { CSSProperties } from 'react'
import { isRichHtml } from '@/lib/rich-text'

/**
 * Read-side twin of RichTextEditor — renders a stored note value in
 * whichever shape it is: editor-emitted HTML gets injected (safe because
 * every write passed the server-side allowlist sanitiser in
 * src/lib/rich-text-server.ts — that invariant is what makes this
 * dangerouslySetInnerHTML acceptable), legacy plain text renders exactly
 * as before with preserved line breaks. No hooks, so it works in server
 * components (the print page) and client components alike.
 */
export function RichText({
  value,
  style,
}: {
  value: string
  style?: CSSProperties
}) {
  if (!isRichHtml(value)) {
    return <div style={{ whiteSpace: 'pre-wrap', ...style }}>{value}</div>
  }
  return (
    <div
      className="rich-text"
      style={style}
      dangerouslySetInnerHTML={{ __html: value }}
    />
  )
}

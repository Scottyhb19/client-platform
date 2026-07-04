/**
 * Clinical-note rich-text helpers, shared by the editor, the readers and
 * the server-side sanitiser. Notes historically stored plain text; the
 * note editors (2026-07-04) store a small HTML subset instead. Both shapes
 * coexist inside clinical_notes.content_json and
 * note_template_fields.default_value — these helpers are the single place
 * that tells them apart, so the discriminator never drifts between the
 * write path and the render path.
 */

/**
 * True when a stored value is editor-emitted HTML rather than legacy plain
 * text. The editor always opens with a block tag, so matching only
 * `<p|ul|ol` means legacy text that happens to start with "<" (e.g.
 * "<5/10 pain on squat") is never mistaken for markup.
 */
export function isRichHtml(value: string): boolean {
  return /^\s*<(p|ul|ol)[\s>]/i.test(value)
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ENTITIES[ch])
}

/**
 * Legacy plain text → HTML the editor can open, used when an old note is
 * edited with the rich editor. Newlines become soft line breaks so the
 * note reads exactly as it did in the textarea.
 */
export function plainTextToRichHtml(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return `<p>${escapeHtml(trimmed).replace(/\r?\n/g, '<br>')}</p>`
}

/**
 * Strip markup for emptiness checks and plain-text previews. Good enough
 * for the allowlisted tag set — not a general-purpose HTML parser.
 */
export function richHtmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

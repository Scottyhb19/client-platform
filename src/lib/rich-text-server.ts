import sanitizeHtml from 'sanitize-html'
import { isRichHtml, richHtmlToPlainText } from './rich-text'

/**
 * Server-side write gate for note rich text — this is the XSS boundary.
 * Every value the note editors save (clinical_notes.content_json field
 * values and note_template_fields.default_value) passes through here
 * before it reaches the database, so rendered note HTML is trusted-clean
 * by construction and the readers can inject it directly.
 *
 * The allowlist is exactly what the editor can produce: paragraph
 * structure, line breaks, inline emphasis and the two list kinds. No
 * attributes survive (no href, no style, no class, no event handlers) and
 * disallowed tags are discarded with their content escaped-out by
 * sanitize-html's default text handling.
 *
 * Server-only: keeps sanitize-html out of the client bundle. Import from
 * server actions, never from 'use client' modules.
 */
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li']

export function sanitizeRichTextValue(value: string): string {
  // Legacy plain text passes through untouched — React escapes it at
  // render, exactly as before the rich editor existed.
  if (!isRichHtml(value)) return value.trim()

  const clean = sanitizeHtml(value, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    // Pasted content sometimes carries <b>/<i>; fold them into the
    // editor's own emphasis tags rather than dropping them.
    transformTags: { b: 'strong', i: 'em' },
    disallowedTagsMode: 'discard',
  })

  // A value with markup but no visible text (e.g. "<p></p>") collapses to
  // '' so every existing "is this field empty?" check keeps working.
  return richHtmlToPlainText(clean).length === 0 ? '' : clean
}

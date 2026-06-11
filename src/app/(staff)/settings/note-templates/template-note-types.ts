import type { Database } from '@/types/database'

export type NoteType = Database['public']['Enums']['note_type']

/**
 * CN-3: the note types a template may stamp onto notes written from it.
 * Flag types are excluded (DB CHECK note_templates_type_not_flag agrees) —
 * flags are created via the dedicated flag control, never via templates.
 * Only the types the settings UI offers; widen here AND in the editor's
 * select when a new one is needed.
 *
 * Lives outside actions.ts because a 'use server' file may only export
 * async functions — runtime consts are rejected at build time.
 */
export const TEMPLATE_NOTE_TYPES = [
  'progress_note',
  'initial_assessment',
] as const satisfies readonly NoteType[]

export type TemplateNoteType = (typeof TEMPLATE_NOTE_TYPES)[number]

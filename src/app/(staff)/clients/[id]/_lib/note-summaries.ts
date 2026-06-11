import type { Database } from '@/types/database'
import type {
  ClinicalNoteField,
  ClinicalNoteSummary,
} from '../_components/NotesPanel'

/**
 * Shared loader plumbing for the read-only NotesPanel surfaces (program
 * calendar side panel + session builder right rail). Both loaders select
 * the same columns, run the same active-flags companion query, and map
 * rows the same way — this module is the single copy (CN-1; previously
 * duplicated inline in both page loaders).
 */

type NoteType = Database['public']['Enums']['note_type']

export const NOTE_SUMMARY_COLUMNS = `id, note_date, note_type, is_pinned,
 flag_body_region, flag_severity, flag_resolved_at, template_id,
 body_rich, subjective, content_json`

export type NoteSummaryRow = {
  id: string
  note_date: string
  note_type: NoteType
  is_pinned: boolean
  flag_body_region: string | null
  flag_severity: number | null
  flag_resolved_at: string | null
  template_id: string | null
  body_rich: string | null
  subjective: string | null
  content_json: unknown
}

export function isFlagNoteType(t: NoteType): boolean {
  return t === 'injury_flag' || t === 'contraindication'
}

/**
 * The recent-notes query is capped (30) for panel cheapness, which means
 * an old-but-still-active flag could fall outside the window — exactly
 * the "active flag invisible while programming" failure CN-1 closes. The
 * loaders therefore run a second, naturally-bounded query for active
 * flags and merge here. Recent ordering is preserved; flags the window
 * already contains are not duplicated.
 */
export function mergeNoteRows(
  recent: NoteSummaryRow[],
  activeFlags: NoteSummaryRow[],
): NoteSummaryRow[] {
  const seen = new Set(recent.map((n) => n.id))
  return [...recent, ...activeFlags.filter((n) => !seen.has(n.id))]
}

type ContentJsonShape = {
  fields?: Array<{ label?: unknown; value?: unknown }>
}

/**
 * Denormalise rows to ClinicalNoteSummary. Modern notes carry content in
 * content_json.fields[] (migration 20260427100000); pre-template notes
 * flow through the legacy body_rich/subjective fallback. A note with no
 * fields AND no legacy text is dropped (it would render as an empty
 * card) — EXCEPT flag notes, whose banner renders from the structured
 * flag columns and which may legitimately carry no note text.
 */
export function toClinicalNoteSummaries(
  rows: NoteSummaryRow[],
  templateNameById: Map<string, string>,
): ClinicalNoteSummary[] {
  return rows
    .map((n) => {
      const cj = n.content_json as ContentJsonShape | null
      const fields: ClinicalNoteField[] = (cj?.fields ?? [])
        .map((f) => ({
          label: typeof f.label === 'string' ? f.label : '',
          value: typeof f.value === 'string' ? f.value : '',
        }))
        .filter((f) => f.label.length > 0)
      const legacyBody = (n.body_rich ?? n.subjective ?? '').trim()
      return {
        id: n.id,
        note_date: n.note_date,
        note_type: n.note_type,
        is_pinned: n.is_pinned,
        flag_body_region: n.flag_body_region,
        flag_severity: n.flag_severity,
        flag_resolved_at: n.flag_resolved_at,
        template_name: n.template_id
          ? templateNameById.get(n.template_id) ?? null
          : null,
        fields,
        legacy_body: legacyBody,
      }
    })
    .filter(
      (n) =>
        isFlagNoteType(n.note_type) ||
        n.fields.some((f) => f.value.trim().length > 0) ||
        n.legacy_body.length > 0,
    )
}

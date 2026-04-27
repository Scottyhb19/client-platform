import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'
import type { Database } from '@/types/database'
import { PrintTrigger } from './PrintTrigger'

export const dynamic = 'force-dynamic'

type FieldType = Database['public']['Enums']['note_template_field_type']
type NoteContent = {
  fields?: Array<{ label: string; type: FieldType; value: string }>
}

/**
 * Print-optimised single-note view. The PDF export button on the side
 * rail opens this URL in a new tab; the embedded PrintTrigger fires
 * `window.print()` on first paint so the browser's native "Save as PDF"
 * dialog appears immediately.
 *
 * No app chrome — just the clinic name, client name, session date, and
 * the field stack. Reuses the print colours/typography of `Isaac_Fong_report.html`
 * via `@page` rules so margins and page breaks render predictably.
 */
export default async function PrintNotePage({
  params,
}: {
  params: Promise<{ id: string; noteId: string }>
}) {
  const { id: clientId, noteId } = await params
  await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const { data: note } = await supabase
    .from('clinical_notes')
    .select(
      `id, note_date, content_json, body_rich, subjective, objective,
       assessment, plan, template_id, appointment_id, created_at, version,
       client:clients(first_name, last_name),
       template:note_templates(name),
       appointment:appointments(start_at, appointment_type),
       organization:organizations(name)`,
    )
    .eq('id', noteId)
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!note) notFound()

  const content = (note.content_json as NoteContent | null) ?? null
  const fields =
    content?.fields?.filter((f) => f.value && f.value.trim().length > 0) ?? []
  const legacyBody =
    fields.length === 0
      ? (note.body_rich?.trim() ||
          [note.subjective, note.objective, note.assessment, note.plan]
            .filter((s) => s && s.trim().length > 0)
            .join('\n\n'))
      : ''

  const sessionDate = note.appointment?.start_at
    ? formatLong(note.appointment.start_at)
    : formatDate(note.note_date)

  const clientName =
    `${note.client?.first_name ?? ''} ${note.client?.last_name ?? ''}`.trim()

  return (
    <>
      <style>{`
        @page { size: A4; margin: 18mm 16mm; }
        html, body { background: #fff; color: #1c1917; }
        body { font-family: var(--font-barlow), system-ui, sans-serif; }
        .print-page {
          max-width: 720px;
          margin: 0 auto;
          padding: 24px 0;
          color: #1c1917;
        }
        .print-head {
          border-bottom: 1px solid #cfc7bd;
          padding-bottom: 14px;
          margin-bottom: 24px;
        }
        .print-eyebrow {
          font-family: var(--font-barlow-condensed), system-ui, sans-serif;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: .1em;
          text-transform: uppercase;
          color: #5e5852;
          margin-bottom: 4px;
        }
        .print-title {
          font-family: var(--font-barlow-condensed), system-ui, sans-serif;
          font-weight: 800;
          font-size: 22px;
          margin: 0 0 4px;
          color: #1e1a18;
        }
        .print-meta {
          font-size: 13px;
          color: #5e5852;
          line-height: 1.5;
        }
        .print-field { margin-bottom: 16px; page-break-inside: avoid; }
        .print-field-label {
          font-family: var(--font-barlow-condensed), system-ui, sans-serif;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: #5e5852;
          margin-bottom: 4px;
        }
        .print-field-value {
          font-size: 14px;
          line-height: 1.6;
          color: #1c1917;
          white-space: pre-wrap;
        }
        .print-controls {
          padding: 14px 16px;
          background: #f7f4f0;
          border: 1px solid #cfc7bd;
          border-radius: 9px;
          font-size: 13px;
          color: #5e5852;
          margin-bottom: 22px;
          display: flex;
          gap: 12px;
          align-items: center;
          justify-content: space-between;
        }
        .print-controls button {
          background: #1e1a18;
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 7px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
        }
        @media print {
          .print-controls { display: none; }
          body { background: #fff; }
        }
      `}</style>
      <div className="print-page">
        <div className="print-controls">
          <span>
            Use your browser&rsquo;s print dialog to save as PDF or send to
            paper. We&rsquo;ve opened it for you.
          </span>
          <PrintTrigger />
        </div>

        <div className="print-head">
          <div className="print-eyebrow">
            {note.organization?.name ?? 'Clinical note'}
          </div>
          <h1 className="print-title">{clientName || 'Client'}</h1>
          <div className="print-meta">
            <div>{sessionDate}</div>
            {note.appointment?.appointment_type && (
              <div>{note.appointment.appointment_type}</div>
            )}
            {note.template?.name && <div>Template: {note.template.name}</div>}
          </div>
        </div>

        {fields.length > 0 ? (
          fields.map((f, idx) => (
            <div key={idx} className="print-field">
              <div className="print-field-label">{f.label}</div>
              <div className="print-field-value">{f.value}</div>
            </div>
          ))
        ) : (
          <div className="print-field">
            <div className="print-field-value">
              {legacyBody || '(empty note)'}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function formatDate(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(dateIso))
  } catch {
    return dateIso
  }
}

function formatLong(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

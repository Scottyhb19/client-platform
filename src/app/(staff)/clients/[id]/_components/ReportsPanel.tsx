/**
 * Recent test sessions / reports panel.
 *
 * Extracted from SessionBuilder.tsx in Phase E so the program calendar can
 * mount the same component in its toggle-able side panel. Read-only list;
 * loaders cap the result at 20 most-recent.
 */

const INK = '#1E1A18'
const MUTED = '#78746F'
const BORDER = '#E2DDD7'

export type SessionReport = {
  id: string
  title: string
  report_type: string
  test_date: string
  is_published: boolean
}

export function ReportsPanel({ reports }: { reports: SessionReport[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Client reports
      </div>
      {reports.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No reports filed for this client yet. Force-plate profiles,
          ForceFrame results, and movement reassessments will land here once
          the VALD integration is wired.
        </div>
      ) : (
        reports.map((r) => (
          <div
            key={r.id}
            style={{
              padding: '10px 0',
              borderBottom: `1px solid ${BORDER}`,
              fontSize: '.82rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span style={{ fontWeight: 600, color: INK }}>{r.title}</span>
              {!r.is_published && (
                <span
                  style={{
                    fontSize: '.6rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '.04em',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(232,163,23,.1)',
                    color: '#9A7A0E',
                  }}
                >
                  Draft
                </span>
              )}
            </div>
            <div
              style={{
                fontSize: '.72rem',
                color: MUTED,
                display: 'flex',
                gap: 8,
              }}
            >
              <span>{formatDateShort(r.test_date)}</span>
              <span>·</span>
              <span>{r.report_type}</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function formatDateShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

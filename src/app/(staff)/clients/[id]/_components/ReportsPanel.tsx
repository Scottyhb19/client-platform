/**
 * Published test reports panel — shared between the program calendar and
 * the session builder right rail.
 *
 * Sources from `client_publications` (the testing-module publish gate),
 * not the legacy `reports` table. Each row is one live publication = one
 * (test_session, test) pair the clinician has made visible to the client.
 * The loader joins on test_sessions for `conducted_at` and resolves the
 * test name via the catalog; this component just renders the list.
 *
 * Read-only. The publish/unpublish surface lives on the client profile's
 * Reports tab.
 */

const INK = '#1E1A18'
const MUTED = '#78746F'
const FAINT = '#9C9690'
const BORDER = '#E2DDD7'

export type SessionReport = {
  /** client_publications.id */
  id: string
  /** Catalog test_id (resolved to test_name when possible). */
  test_id: string
  /** Friendly test name from the catalog; falls back to test_id on miss. */
  test_name: string
  /** test_sessions.conducted_at — when the test was actually performed. */
  conducted_at: string
  /** Optional clinician framing, max 280 chars. */
  framing_text: string | null
}

export function ReportsPanel({ reports }: { reports: SessionReport[] }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="eyebrow" style={{ fontSize: '.66rem', marginBottom: 10 }}>
        Published reports
      </div>
      {reports.length === 0 ? (
        <div style={{ fontSize: '.82rem', color: MUTED, lineHeight: 1.5 }}>
          No published reports for this client yet. Publish a test from
          the Reports tab on the client profile and it will appear here.
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
                alignItems: 'baseline',
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span style={{ fontWeight: 600, color: INK }}>{r.test_name}</span>
              <span style={{ fontSize: '.72rem', color: FAINT }}>
                {formatDateShort(r.conducted_at)}
              </span>
            </div>
            {r.framing_text && (
              <div
                style={{
                  fontSize: '.74rem',
                  color: MUTED,
                  lineHeight: 1.4,
                  marginTop: 2,
                }}
              >
                {r.framing_text}
              </div>
            )}
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

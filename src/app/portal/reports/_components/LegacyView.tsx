import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

export interface LegacyReport {
  id: string
  title: string
  report_type: string
  test_date: string
  published_at: string | null
}

interface Props {
  reports: LegacyReport[]
}

/**
 * The Cowork-skill rendered-HTML report flow continues in parallel
 * with the structured testing module (per brief §9). Tapping a row
 * opens the file in a new tab via the /portal/reports/file/[id]
 * route handler, which resolves storage_path to a short-lived
 * signed URL.
 */
export function LegacyView({ reports }: Props) {
  return (
    <div style={{ padding: '0 16px 16px' }}>
      {reports.map((r) => (
        <Link
          key={r.id}
          href={`/portal/reports/file/${r.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="portal-card is-compact"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            marginBottom: 8,
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: '.88rem' }}>{r.title}</div>
            <div
              style={{
                fontSize: '.74rem',
                color: 'var(--color-muted)',
                marginTop: 2,
              }}
            >
              {formatShort(r.test_date)} · {r.report_type}
            </div>
          </div>
          <ExternalLink
            size={16}
            aria-hidden
            style={{ color: 'var(--color-muted)' }}
          />
        </Link>
      ))}
    </div>
  )
}

function formatShort(iso: string): string {
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

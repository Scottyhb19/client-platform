import { ChevronRight } from 'lucide-react'

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
 * with the structured testing module (per brief §9). This view lifts
 * the original portal/reports list verbatim — no behaviour change.
 */
export function LegacyView({ reports }: Props) {
  return (
    <div style={{ padding: '0 16px 16px' }}>
      {reports.map((r) => (
        <div
          key={r.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#fff',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 10,
            marginBottom: 8,
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
          <ChevronRight
            size={16}
            aria-hidden
            style={{ color: 'var(--color-muted)' }}
          />
        </div>
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

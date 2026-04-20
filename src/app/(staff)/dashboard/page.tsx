import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/require-role'

/**
 * Dashboard placeholder. The real layout (stat cards, needs-attention,
 * today's sessions, client list) will be built next against
 * .design-ref/project/components/Dashboard.jsx.
 */
export default async function DashboardPage() {
  // Layout already guarded — this just fetches org context.
  const { organizationId, email, role } = await requireRole(['owner', 'staff'])

  const supabase = await createSupabaseServerClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('name, timezone')
    .eq('id', organizationId)
    .maybeSingle()

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">01 Dashboard</div>
          <h1>{org?.name ?? 'Your practice'}</h1>
          <div className="sub">
            {email} · {role} · {org?.timezone ?? '—'}
          </div>
        </div>
      </div>

      <section className="card" style={{ padding: '24px 28px', maxWidth: 640 }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1.4rem',
            margin: 0,
            color: 'var(--color-charcoal)',
          }}
        >
          Backend is live
        </h2>
        <p
          style={{
            fontSize: '0.9rem',
            lineHeight: 1.6,
            color: 'var(--color-text-light)',
            marginTop: 10,
          }}
        >
          Gate 1–4 stack is working end to end: schema, RLS, audit triggers,
          signup bootstrap, and the staff shell. The dashboard content (stat
          cards, needs-attention panel, today&rsquo;s sessions, client list)
          comes next.
        </p>
      </section>
    </div>
  )
}

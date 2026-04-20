import { logout } from '../../login/actions'
import { requireRole } from '@/lib/auth/require-role'

export default async function SettingsPage() {
  const { email, role } = await requireRole(['owner', 'staff'])

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">07 Settings</div>
          <h1>Settings</h1>
          <div className="sub">
            Practice, staff, billing, integrations.
          </div>
        </div>
      </div>

      <section className="card" style={{ padding: '24px 28px', maxWidth: 640 }}>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '1.2rem',
            margin: 0,
            color: 'var(--color-charcoal)',
          }}
        >
          Account
        </h2>
        <p
          style={{
            fontSize: '0.9rem',
            lineHeight: 1.6,
            color: 'var(--color-text-light)',
            marginTop: 8,
          }}
        >
          Signed in as <strong style={{ color: 'var(--color-text)' }}>{email}</strong>{' '}
          · role <strong style={{ color: 'var(--color-text)' }}>{role}</strong>.
        </p>

        <form action={logout} style={{ marginTop: 20 }}>
          <button type="submit" className="btn outline">
            Sign out
          </button>
        </form>
      </section>
    </div>
  )
}

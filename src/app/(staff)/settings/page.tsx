import { logout } from '../../login/actions'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  PracticeInfoForm,
  type PracticeInfo,
} from './_components/PracticeInfoForm'
import {
  NotificationsForm,
  type NotificationSettings,
} from './_components/NotificationsForm'
import {
  LookupManager,
  type LookupRow,
} from './_components/LookupManager'
import { SessionTypesEditor } from './session-types/_components/SessionTypesEditor'
import type { SessionTypeRow } from './session-types/actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { email, role, organizationId } = await requireRole([
    'owner',
    'staff',
  ])
  const supabase = await createSupabaseServerClient()

  const [
    { data: org },
    { data: tags },
    { data: categories },
    { data: sessionTypes },
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select(
        `id, name, email, phone, address, timezone, abn, provider_number,
         email_notifications_enabled, sms_notifications_enabled,
         reminder_lead_hours`,
      )
      .eq('id', organizationId)
      .maybeSingle(),
    supabase
      .from('exercise_tags')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order')
      .order('name'),
    supabase
      .from('client_categories')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order')
      .order('name'),
    supabase
      .from('session_types')
      .select('id, name, color, sort_order')
      .is('deleted_at', null)
      .order('sort_order'),
  ])

  const practiceInfo: PracticeInfo = {
    name: org?.name ?? 'Your practice',
    email: org?.email ?? null,
    phone: org?.phone ?? null,
    address: org?.address ?? null,
    abn: org?.abn ?? null,
    provider_number: org?.provider_number ?? null,
    timezone: org?.timezone ?? 'Australia/Sydney',
  }

  const notifications: NotificationSettings = {
    email_notifications_enabled: org?.email_notifications_enabled ?? true,
    sms_notifications_enabled: org?.sms_notifications_enabled ?? false,
    reminder_lead_hours: org?.reminder_lead_hours ?? 24,
  }

  const tagRows: LookupRow[] = (tags ?? []).map((t) => ({
    id: t.id,
    name: t.name,
  }))
  const categoryRows: LookupRow[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
  }))
  const sessionTypeRows: SessionTypeRow[] = (sessionTypes ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    sort_order: s.sort_order,
  }))

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Practice configuration</div>
          <h1>Settings</h1>
          <div className="sub">
            Practice info, notifications, tags and categories.
          </div>
        </div>
      </div>

      <Section
        title="Practice information"
        desc="Business details shown on communications and invoices."
      >
        <PracticeInfoForm info={practiceInfo} />
      </Section>

      <Section
        title="Notifications"
        desc="How and when the practice reaches out. Per-client overrides land with the portal."
      >
        <NotificationsForm settings={notifications} />
      </Section>

      <Section
        title="Exercise tags"
        desc="Tenant-wide tags applied to exercises in the library."
      >
        <LookupManager kind="tags" rows={tagRows} />
      </Section>

      <Section
        title="Client categories"
        desc="Groupings shown on the Clientele list and filters."
      >
        <LookupManager kind="categories" rows={categoryRows} />
      </Section>

      <Section
        title="Session types"
        desc="Appointment categories shown in the booking form. Colours tint the blocks on the schedule grid."
      >
        <SessionTypesEditor initialTypes={sessionTypeRows} />
      </Section>

      <Section title="Account" desc="Signed in as you.">
        <div style={{ padding: '20px 22px' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontSize: '.88rem',
                color: 'var(--color-text)',
              }}
            >
              <div style={{ fontWeight: 600 }}>{email}</div>
              <div
                style={{
                  fontSize: '.76rem',
                  color: 'var(--color-text-light)',
                  marginTop: 2,
                }}
              >
                role {role} · {practiceInfo.name}
              </div>
            </div>
            <form action={logout}>
              <button type="submit" className="btn outline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({
  title,
  desc,
  children,
}: {
  title: string
  desc: string
  children: React.ReactNode
}) {
  return (
    <section
      className="card"
      style={{ marginBottom: 18, padding: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1rem',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
          }}
        >
          {desc}
        </div>
      </div>
      {children}
    </section>
  )
}

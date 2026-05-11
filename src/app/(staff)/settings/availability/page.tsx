import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { WeeklyGrid } from './_components/WeeklyGrid'
import { OneOffOverrides } from './_components/OneOffOverrides'
import type { AvailabilityRuleRow } from './actions'

export const dynamic = 'force-dynamic'

export default async function SettingsAvailabilityPage() {
  const { userId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  // v1: each user authors their own hours. Owner-on-behalf (a staff
  // selector visible to owners) is AVL-1b in docs/polish/availability-
  // editor.md §6 — deferred until the practice grows past one EP.
  const { data: rows } = await supabase
    .from('availability_rules')
    .select(
      `id, staff_user_id, recurrence, day_of_week, specific_date,
       start_time, end_time, slot_duration_minutes,
       effective_from, effective_to, notes`,
    )
    .eq('staff_user_id', userId)
    .is('deleted_at', null)

  const rules: AvailabilityRuleRow[] = (rows ?? []).map((r) => ({
    id: r.id,
    staff_user_id: r.staff_user_id,
    recurrence: r.recurrence,
    day_of_week: r.day_of_week,
    specific_date: r.specific_date,
    start_time: r.start_time,
    end_time: r.end_time,
    slot_duration_minutes: r.slot_duration_minutes,
    effective_from: r.effective_from,
    effective_to: r.effective_to,
    notes: r.notes,
  }))

  const weeklyRules = rules.filter((r) => r.recurrence === 'weekly')
  const oneOffRules = rules.filter((r) => r.recurrence === 'one_off')

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <Link
          href="/settings"
          style={{
            fontSize: '.78rem',
            color: 'var(--color-text-light)',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <ChevronLeft size={14} aria-hidden /> Settings
        </Link>
      </div>

      <div className="page-head">
        <div>
          <div className="eyebrow">Practice configuration</div>
          <h1>Hours</h1>
          <div className="sub">Your availability for client bookings.</div>
        </div>
      </div>

      <Section
        title="Weekly hours"
        desc="When you work week-to-week. Click Add hours under a day to set a window."
      >
        <WeeklyGrid rules={weeklyRules} />
      </Section>

      <Section
        title="One-off exceptions"
        desc="Extra clinics or schedule changes for specific dates. Sit alongside the weekly grid — they don't replace it."
      >
        <OneOffOverrides rules={oneOffRules} />
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

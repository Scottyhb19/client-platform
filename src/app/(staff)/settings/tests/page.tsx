import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  loadAllBatteriesForOrg,
  loadAllDisabledTests,
  loadAllOverridesForOrg,
  loadCatalog,
  loadCustomTestsForOrg,
  type OverrideMapEntry,
} from '@/lib/testing'
import { BatteryBuilder } from './_components/BatteryBuilder'
import { CustomTestBuilder } from './_components/CustomTestBuilder'
import { DisableTestsList } from './_components/DisableTestsList'
import { OverrideEditor } from './_components/OverrideEditor'

export const dynamic = 'force-dynamic'

export default async function SettingsTestsPage() {
  const { organizationId } = await requireRole(['owner', 'staff'])
  const supabase = await createSupabaseServerClient()

  const [
    catalog,
    schemaCatalog,
    overrides,
    disabled,
    customTests,
    batteries,
  ] = await Promise.all([
    // Default load: includes custom tests, excludes disabled. Used by the
    // override editor (3.1) so the EP can adjust hints on enabled tests.
    loadCatalog(supabase, organizationId),
    // Schema-only, includes-disabled load: used by the disable-tests
    // list (3.3). Custom tests are managed via the Custom Tests section.
    loadCatalog(supabase, organizationId, {
      includeCustom: false,
      includeDisabled: true,
    }),
    loadAllOverridesForOrg(supabase, organizationId),
    loadAllDisabledTests(supabase, organizationId),
    loadCustomTestsForOrg(supabase, organizationId),
    loadAllBatteriesForOrg(supabase, organizationId),
  ])

  // Maps don't survive the Server → Client component boundary cleanly.
  // Plain objects do.
  const overridesObject: Record<string, OverrideMapEntry> = Object.fromEntries(overrides)
  const disabledArray = Array.from(disabled)

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
          <ChevronLeft size={14} /> Settings
        </Link>
      </div>

      <div className="page-head">
        <div>
          <div className="eyebrow">Practice configuration</div>
          <h1>Tests</h1>
          <div className="sub">
            Per-metric defaults, custom tests, disabled tests, and saved
            batteries. Overrides survive schema upgrades.
          </div>
        </div>
      </div>

      <Section
        title="Per-metric overrides"
        desc="Adjust direction-of-good, chart, comparison, and visibility per metric. A green border marks an overridden field; hover any cell to see the schema default. The reset icon clears all five fields for that metric."
      >
        <OverrideEditor
          catalog={catalog}
          initialOverrides={overridesObject}
          disabled={disabledArray}
        />
      </Section>

      <Section
        title="Custom tests"
        desc="Tests not in the schema. Custom tests appear alongside standard tests in the capture flow with a Custom badge. Past results stay queryable after a test is archived."
      >
        <CustomTestBuilder customTests={customTests} catalog={catalog} />
      </Section>

      <Section
        title="Disable schema tests"
        desc="Hide a standard schema test from forward capture for this practice. Past results remain queryable. Custom tests are archived via the Custom Tests section."
      >
        <DisableTestsList schemaCatalog={schemaCatalog} disabled={disabledArray} />
      </Section>

      <Section
        title="Saved batteries"
        desc="Pre-defined sets of metrics for one-click capture. Cross-category by design — combine ROM, force plate, isokinetic, and questionnaire metrics in one battery. Apply from the capture modal."
      >
        <BatteryBuilder batteries={batteries} catalog={catalog} />
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


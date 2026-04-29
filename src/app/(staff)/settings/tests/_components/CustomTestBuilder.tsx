'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import type { CatalogCategory, PracticeCustomTest } from '@/lib/testing'
import { CustomTestForm } from './CustomTestForm'
import { archiveCustomTestAction } from '../actions'

interface Props {
  customTests: PracticeCustomTest[]
  catalog: CatalogCategory[]
}

type Mode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; id: string }

export function CustomTestBuilder({ customTests, catalog }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>({ type: 'closed' })
  const [pending, startTransition] = useTransition()

  const existingTestIds = new Set(customTests.map((t) => t.test_id))
  const editingTest =
    mode.type === 'edit' ? customTests.find((t) => t.id === mode.id) ?? null : null

  function handleArchive(t: PracticeCustomTest) {
    if (
      !confirm(
        `Archive "${t.name}"? Past results referencing this test stay queryable, but it won't appear in new capture flows. You can recreate it later.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await archiveCustomTestAction(t.id)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '14px 22px 18px' }}>
      {customTests.length === 0 && mode.type === 'closed' && (
        <div
          style={{
            padding: '18px 14px',
            background: 'var(--color-surface)',
            border: '1px dashed var(--color-border-subtle)',
            borderRadius: 10,
            color: 'var(--color-text-light)',
            fontSize: '.85rem',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          No custom tests yet. Add one to capture metrics that aren&apos;t in the schema.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {customTests.map((t) => (
          <CustomTestCard
            key={t.id}
            test={t}
            isEditing={mode.type === 'edit' && mode.id === t.id}
            disabled={pending}
            onEdit={() => setMode({ type: 'edit', id: t.id })}
            onArchive={() => handleArchive(t)}
          />
        ))}
      </div>

      {mode.type === 'closed' && (
        <button
          type="button"
          className="btn outline"
          onClick={() => setMode({ type: 'create' })}
          style={{ marginTop: 14 }}
        >
          <Plus size={14} /> Add custom test
        </button>
      )}

      {mode.type === 'create' && (
        <div style={{ marginTop: 14 }}>
          <CustomTestForm
            mode="create"
            existingTestIds={existingTestIds}
            catalog={catalog}
            onCancel={() => setMode({ type: 'closed' })}
            onSaved={() => {
              setMode({ type: 'closed' })
              router.refresh()
            }}
          />
        </div>
      )}

      {mode.type === 'edit' && editingTest && (
        <div style={{ marginTop: 14 }}>
          <CustomTestForm
            mode="edit"
            initialTest={editingTest}
            existingTestIds={existingTestIds}
            catalog={catalog}
            onCancel={() => setMode({ type: 'closed' })}
            onSaved={() => {
              setMode({ type: 'closed' })
              router.refresh()
            }}
          />
        </div>
      )}
    </div>
  )
}

function CustomTestCard({
  test,
  isEditing,
  disabled,
  onEdit,
  onArchive,
}: {
  test: PracticeCustomTest
  isEditing: boolean
  disabled: boolean
  onEdit: () => void
  onArchive: () => void
}) {
  const metricSummary = `${test.metrics.length} metric${test.metrics.length === 1 ? '' : 's'}`
  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${
          isEditing ? 'var(--color-primary)' : 'var(--color-border-subtle)'
        }`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 14,
        opacity: isEditing ? 0.6 : 1,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: '.92rem',
            color: 'var(--color-charcoal)',
          }}
        >
          {test.name}
        </div>
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
          }}
        >
          {test.category_id} · {test.subcategory_id} · {metricSummary} ·{' '}
          <code style={{ fontSize: '.72rem' }}>{test.test_id}</code>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          className="btn ghost"
          onClick={onEdit}
          disabled={disabled || isEditing}
        >
          Edit
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={onArchive}
          disabled={disabled || isEditing}
          title="Archive"
          style={{ color: 'var(--color-alert)' }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import type { CatalogCategory, EditableBatteryRow } from '@/lib/testing'
import { BatteryForm } from './BatteryForm'
import { archiveBatteryAction } from '../actions'

interface Props {
  batteries: EditableBatteryRow[]
  catalog: CatalogCategory[]
}

type Mode = { type: 'closed' } | { type: 'create' } | { type: 'edit'; id: string }

export function BatteryBuilder({ batteries, catalog }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>({ type: 'closed' })
  const [pending, startTransition] = useTransition()

  const editingBattery =
    mode.type === 'edit' ? batteries.find((b) => b.id === mode.id) ?? null : null

  function handleArchive(b: EditableBatteryRow) {
    if (
      !confirm(
        `Archive "${b.name}"? Past test sessions tagged with this battery stay readable, but it won't appear in the capture flow's battery picker. You can recreate it later.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await archiveBatteryAction(b.id)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '14px 22px 18px' }}>
      {batteries.length === 0 && mode.type === 'closed' && (
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
          No saved batteries yet. Create one to apply the same metric set with one click in capture.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {batteries.map((b) => (
          <BatteryCard
            key={b.id}
            battery={b}
            isEditing={mode.type === 'edit' && mode.id === b.id}
            disabled={pending}
            onEdit={() => setMode({ type: 'edit', id: b.id })}
            onArchive={() => handleArchive(b)}
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
          <Plus size={14} /> New battery
        </button>
      )}

      {mode.type === 'create' && (
        <div style={{ marginTop: 14 }}>
          <BatteryForm
            mode="create"
            catalog={catalog}
            onCancel={() => setMode({ type: 'closed' })}
            onSaved={() => {
              setMode({ type: 'closed' })
              router.refresh()
            }}
          />
        </div>
      )}

      {mode.type === 'edit' && editingBattery && (
        <div style={{ marginTop: 14 }}>
          <BatteryForm
            mode="edit"
            initialBattery={editingBattery}
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

function BatteryCard({
  battery,
  isEditing,
  disabled,
  onEdit,
  onArchive,
}: {
  battery: EditableBatteryRow
  isEditing: boolean
  disabled: boolean
  onEdit: () => void
  onArchive: () => void
}) {
  const metricCount = battery.metric_keys.length
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
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
            fontSize: '.92rem',
            color: 'var(--color-charcoal)',
          }}
        >
          {battery.name}
          {!battery.is_active && (
            <span className="tag overdue" style={{ fontSize: '.62rem' }}>
              Inactive
            </span>
          )}
        </div>
        <div
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {metricCount} metric{metricCount === 1 ? '' : 's'}
          {battery.description ? ` · ${battery.description}` : ''}
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

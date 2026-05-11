'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  deleteAvailabilityRuleAction,
  type AvailabilityRuleRow,
} from '../actions'
import { RuleForm } from './RuleForm'
import { formatDate, formatTime } from '../_lib/format'

/**
 * Secondary list panel for one-off rules — extra clinics or schedule
 * changes for specific dates. Sits alongside the weekly grid; one-off
 * rules ADD to the weekly grid's availability, not replace it. (Negative
 * overrides — "close this date" — are deferred per gap doc Q1; the
 * workaround is to book yourself an "Unavailable" session-type appointment.)
 */
type EditingState =
  | { kind: 'create' }
  | { kind: 'edit'; rule: AvailabilityRuleRow }
  | null

export function OneOffOverrides({
  rules,
}: {
  rules: AvailabilityRuleRow[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState<EditingState>(null)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const sorted = [...rules].sort((a, b) => {
    const ad = a.specific_date ?? ''
    const bd = b.specific_date ?? ''
    if (ad !== bd) return ad.localeCompare(bd)
    return a.start_time.localeCompare(b.start_time)
  })

  function handleDelete(rule: AvailabilityRuleRow) {
    if (!rule.specific_date) return
    const range = `${formatTime(rule.start_time)}–${formatTime(rule.end_time)}`
    const ok = window.confirm(
      `Delete exception on ${formatDate(rule.specific_date)} (${range})?`,
    )
    if (!ok) return
    setError(null)
    startTransition(async () => {
      const r = await deleteAvailabilityRuleAction(rule.id)
      if (r.error) {
        setError(r.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '14px 22px 22px' }}>
      {sorted.length === 0 && (
        <div
          style={{
            fontSize: '.86rem',
            color: 'var(--color-text-light)',
            padding: '4px 0 14px',
          }}
        >
          No one-off exceptions yet.
        </div>
      )}

      {sorted.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            marginBottom: 14,
          }}
        >
          {sorted.map((rule) => (
            <div
              key={rule.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto',
                alignItems: 'center',
                gap: 14,
                padding: '10px 14px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 8,
                background: 'var(--color-card)',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '.92rem',
                    fontWeight: 600,
                    color: 'var(--color-text)',
                  }}
                >
                  {rule.specific_date ? formatDate(rule.specific_date) : '—'}
                </div>
                <div
                  style={{
                    fontSize: '.76rem',
                    color: 'var(--color-text-light)',
                    marginTop: 1,
                  }}
                >
                  {formatTime(rule.start_time)}–{formatTime(rule.end_time)}
                </div>
              </div>
              <div
                style={{
                  fontSize: '.74rem',
                  color: 'var(--color-muted)',
                  whiteSpace: 'nowrap',
                }}
              >
                {rule.slot_duration_minutes} min
              </div>
              <button
                type="button"
                onClick={() => setEditing({ kind: 'edit', rule })}
                disabled={pending}
                aria-label="Edit exception"
                style={iconButtonStyle}
              >
                <Pencil size={14} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(rule)}
                disabled={pending}
                aria-label="Delete exception"
                style={{ ...iconButtonStyle, color: 'var(--color-alert)' }}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setEditing({ kind: 'create' })}
        disabled={pending}
        className="btn outline"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <Plus size={14} aria-hidden /> Add exception
      </button>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: '.78rem',
            color: 'var(--color-alert)',
            marginTop: 12,
          }}
        >
          {error}
        </div>
      )}

      {editing && (
        <RuleForm
          mode="one_off"
          editing={editing.kind === 'edit' ? editing.rule : null}
          existingRules={rules}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-light)',
  cursor: 'pointer',
  borderRadius: 6,
  display: 'grid',
  placeItems: 'center',
}

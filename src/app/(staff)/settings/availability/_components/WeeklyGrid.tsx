'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import {
  deleteAvailabilityRuleAction,
  type AvailabilityRuleRow,
} from '../actions'
import { RuleForm } from './RuleForm'
import { dayShort, formatTime } from '../_lib/format'

/**
 * Seven-column display of recurring weekly rules. Each column shows the
 * rules for one weekday as tiles + an "Add hours" button. Clicking a tile
 * opens the shared `RuleForm` in edit mode; clicking the add button opens
 * it in create mode with the day pre-selected. The form is rendered below
 * the grid so the user can still see the grid context while editing.
 *
 * Day index convention: 0=Mon … 6=Sun, matching client_available_slots
 * (line 481) and schedule/page.tsx:79.
 */
type EditingState =
  | { kind: 'create'; dayOfWeek: number }
  | { kind: 'edit'; rule: AvailabilityRuleRow }
  | null

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6]

export function WeeklyGrid({ rules }: { rules: AvailabilityRuleRow[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState<EditingState>(null)
  const [pending, startTransition] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const rulesByDay = new Map<number, AvailabilityRuleRow[]>()
  for (const r of rules) {
    if (r.day_of_week == null) continue
    const list = rulesByDay.get(r.day_of_week) ?? []
    list.push(r)
    rulesByDay.set(r.day_of_week, list)
  }
  for (const list of rulesByDay.values()) {
    list.sort((a, b) => a.start_time.localeCompare(b.start_time))
  }

  function handleDelete(rule: AvailabilityRuleRow) {
    if (rule.day_of_week == null) return
    const range = `${formatTime(rule.start_time)}–${formatTime(rule.end_time)}`
    const ok = window.confirm(
      `Delete ${dayShort(rule.day_of_week)} ${range}? Existing bookings inside this window stay scheduled.`,
    )
    if (!ok) return
    setDeleteError(null)
    startTransition(async () => {
      const r = await deleteAvailabilityRuleAction(rule.id)
      if (r.error) {
        setDeleteError(r.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '14px 22px 22px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))',
          gap: 10,
        }}
      >
        {DAY_INDEXES.map((d) => {
          const dayRules = rulesByDay.get(d) ?? []
          return (
            <div
              key={d}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '.78rem',
                  fontWeight: 700,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: 'var(--color-muted)',
                  paddingBottom: 6,
                  borderBottom: '1px solid var(--color-border-subtle)',
                  marginBottom: 2,
                }}
              >
                {dayShort(d)}
              </div>

              {dayRules.map((rule) => (
                <RuleTile
                  key={rule.id}
                  rule={rule}
                  onEdit={() => setEditing({ kind: 'edit', rule })}
                  onDelete={() => handleDelete(rule)}
                  disabled={pending}
                />
              ))}

              <button
                type="button"
                onClick={() =>
                  setEditing({ kind: 'create', dayOfWeek: d })
                }
                disabled={pending}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  width: '100%',
                  padding: '8px 6px',
                  border: '1px dashed var(--color-border-subtle)',
                  background: 'transparent',
                  borderRadius: 8,
                  color: 'var(--color-text-light)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '.78rem',
                  cursor: pending ? 'wait' : 'pointer',
                }}
              >
                <Plus size={13} aria-hidden /> Add hours
              </button>
            </div>
          )
        })}
      </div>

      {deleteError && (
        <div
          role="alert"
          style={{
            fontSize: '.78rem',
            color: 'var(--color-alert)',
            marginTop: 12,
          }}
        >
          {deleteError}
        </div>
      )}

      {editing && (
        <RuleForm
          mode="weekly"
          editing={editing.kind === 'edit' ? editing.rule : null}
          defaultDayOfWeek={
            editing.kind === 'create' ? editing.dayOfWeek : undefined
          }
          existingRules={rules}
          onSaved={() => setEditing(null)}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RuleTile({
  rule,
  onEdit,
  onDelete,
  disabled,
}: {
  rule: AvailabilityRuleRow
  onEdit: () => void
  onDelete: () => void
  disabled: boolean
}) {
  return (
    <div
      style={{
        padding: '8px 10px',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        background: 'var(--color-card)',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '.86rem',
          fontWeight: 600,
          color: 'var(--color-text)',
        }}
      >
        {formatTime(rule.start_time)}–{formatTime(rule.end_time)}
      </div>
      <div
        style={{
          fontSize: '.7rem',
          color: 'var(--color-muted)',
          marginTop: 1,
        }}
      >
        {rule.slot_duration_minutes} min
      </div>
      <div
        style={{
          display: 'flex',
          gap: 2,
          marginTop: 6,
        }}
      >
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          aria-label="Edit hours"
          style={iconButtonStyle}
        >
          <Pencil size={13} aria-hidden />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={disabled}
          aria-label="Delete hours"
          style={{ ...iconButtonStyle, color: 'var(--color-alert)' }}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  border: 'none',
  background: 'transparent',
  color: 'var(--color-text-light)',
  cursor: 'pointer',
  borderRadius: 6,
  display: 'grid',
  placeItems: 'center',
}

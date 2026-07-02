'use client'

/**
 * CN-6 — medical history panel on the Details tab.
 *
 * The clinical-record surface for client_medical_history, which until this
 * section was a read-only rendering of an unwritable table. Active
 * conditions list first (they were previously visible only as header tags,
 * truncated to two); resolved / historical conditions sit in a subdued
 * group beneath, replacing the old separate read-only panel.
 *
 * Verbs (see medical-actions.ts): "Mark resolved" is the primary remove —
 * the row stays in the record. Archive is for entries created by mistake
 * and routes through the soft-delete RPC; the on-system confirm (CN-13)
 * steers genuine resolutions to Mark resolved.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import {
  archiveMedicalConditionAction,
  createMedicalConditionAction,
  setMedicalConditionActiveAction,
  updateMedicalConditionAction,
} from '../medical-actions'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'
import { formatShortDate } from '@/lib/format-date'
import { ProfileCard, ProfileRow, type OverflowItem } from './profile-ui'
import type { ProfileCondition } from './ClientProfile'

export function MedicalHistoryPanel({
  clientId,
  conditions,
  readOnly = false,
}: {
  clientId: string
  conditions: ProfileCondition[]
  /** CN-7: archived client — list renders, every mutating affordance hidden. */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; condition: ProfileCondition } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // CN-13: on-system archive confirm; action errors land in the panel's
  // persistent error block via run().
  const [confirmArchive, setConfirmArchive] = useState<ProfileCondition | null>(
    null,
  )
  const [, startTransition] = useTransition()

  const active = conditions.filter((c) => c.is_active)
  const inactive = conditions.filter((c) => !c.is_active)

  function run(
    conditionId: string,
    action: () => Promise<{ error: string | null }>,
  ) {
    if (pendingId) return
    setError(null)
    setPendingId(conditionId)
    startTransition(async () => {
      const res = await action()
      setPendingId(null)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleArchive(c: ProfileCondition) {
    setConfirmArchive(c)
  }

  return (
    <ProfileCard
      title="Medical history"
      action={
        readOnly ? undefined : (
          <button
            type="button"
            className="btn ghost"
            aria-label="Add condition"
            onClick={() => setDialog({ mode: 'add' })}
            style={{ padding: 6 }}
          >
            <Plus size={14} aria-hidden />
          </button>
        )
      }
    >
      {active.length === 0 && inactive.length === 0 ? (
        <div
          style={{
            padding: '14px 18px',
            fontSize: '.86rem',
            color: 'var(--color-muted)',
            lineHeight: 1.6,
          }}
        >
          None recorded.
        </div>
      ) : (
        <div style={{ padding: '2px 18px 12px' }}>
          {active.map((c) => (
            <ConditionRow
              key={c.id}
              condition={c}
              busy={pendingId === c.id}
              readOnly={readOnly}
              onEdit={() => setDialog({ mode: 'edit', condition: c })}
              onToggleActive={() =>
                run(c.id, () => setMedicalConditionActiveAction(c.id, false))
              }
              onArchive={() => handleArchive(c)}
            />
          ))}

          {inactive.length > 0 && (
            <>
              <div
                className="eyebrow"
                style={{
                  fontSize: '.64rem',
                  margin: active.length > 0 ? '14px 0 4px' : '4px 0',
                }}
              >
                Resolved / historical
              </div>
              {inactive.map((c) => (
                <ConditionRow
                  key={c.id}
                  condition={c}
                  subdued
                  busy={pendingId === c.id}
                  readOnly={readOnly}
                  onEdit={() => setDialog({ mode: 'edit', condition: c })}
                  onToggleActive={() =>
                    run(c.id, () => setMedicalConditionActiveAction(c.id, true))
                  }
                  onArchive={() => handleArchive(c)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            margin: '0 18px 14px',
            padding: '10px 12px',
            background: 'rgba(214,64,69,.08)',
            border: '1px solid rgba(214,64,69,.25)',
            borderRadius: 8,
            color: 'var(--color-alert)',
            fontSize: '.84rem',
          }}
        >
          {error}
        </div>
      )}

      {dialog && (
        <ConditionDialog
          clientId={clientId}
          condition={dialog.mode === 'edit' ? dialog.condition : null}
          onClose={() => setDialog(null)}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          title="Archive this condition?"
          body={`${confirmArchive.condition} — archiving is for conditions entered by mistake. If the condition has resolved, use Mark resolved so it stays in the client's history.`}
          confirmLabel="Archive condition"
          tone="alert"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => {
            const c = confirmArchive
            setConfirmArchive(null)
            run(c.id, () => archiveMedicalConditionAction(c.id))
          }}
        />
      )}
    </ProfileCard>
  )
}

function ConditionRow({
  condition,
  subdued,
  busy,
  readOnly,
  onEdit,
  onToggleActive,
  onArchive,
}: {
  condition: ProfileCondition
  subdued?: boolean
  busy: boolean
  readOnly?: boolean
  onEdit: () => void
  onToggleActive: () => void
  onArchive: () => void
}) {
  const metaText = condition.diagnosis_date
    ? `diagnosed ${formatShortDate(condition.diagnosis_date)}`
    : ''

  // Progressive disclosure: actions live in the hover/focus overflow menu.
  // Only Archive is red, and only here in the menu. CN-7: read-only rows
  // carry no menu at all (ProfileRow skips it for an empty array).
  const menuItems: OverflowItem[] = readOnly
    ? []
    : [
        { key: 'edit', label: 'Edit', disabled: busy, onSelect: onEdit },
        {
          key: 'toggle',
          label: condition.is_active ? 'Mark resolved' : 'Reactivate',
          disabled: busy,
          onSelect: onToggleActive,
        },
        {
          key: 'archive',
          label: 'Archive',
          tone: 'alert',
          disabled: busy,
          onSelect: onArchive,
        },
      ]

  return (
    <ProfileRow
      name={condition.condition}
      subdued={subdued}
      busy={busy}
      meta={
        metaText ? (
          <div
            style={{
              fontSize: '.76rem',
              color: 'var(--color-muted)',
              marginTop: 1,
            }}
          >
            {metaText}
          </div>
        ) : undefined
      }
      contextNote={condition.notes}
      menuLabel={`Actions for ${condition.condition}`}
      menuItems={menuItems}
    />
  )
}

/* ====================== Add / edit dialog ====================== */

function ConditionDialog({
  clientId,
  condition,
  onClose,
}: {
  clientId: string
  /** Null = add; a condition = edit. */
  condition: ProfileCondition | null
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(condition?.condition ?? '')
  const [diagnosisDate, setDiagnosisDate] = useState(
    condition?.diagnosis_date ?? '',
  )
  const [showOnHeader, setShowOnHeader] = useState<boolean>(
    condition ? condition.show_on_header : true,
  )
  const [notes, setNotes] = useState(condition?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  function handleSave() {
    if (isSaving) return
    if (!name.trim()) {
      setError('Condition is required.')
      return
    }
    setError(null)
    startSaving(async () => {
      const fields = {
        condition: name,
        diagnosisDate,
        showOnHeader,
        notes,
      }
      const res = condition
        ? await updateMedicalConditionAction({
            conditionId: condition.id,
            version: condition.version,
            ...fields,
          })
        : await createMedicalConditionAction({ clientId, ...fields })
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="condition-dialog-heading"
      onClick={() => {
        if (!isSaving) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(28, 25, 23, .55)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="condition-dialog-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 14px',
            color: 'var(--color-charcoal)',
          }}
        >
          {condition ? 'Edit condition' : 'Add condition'}
        </h2>

        <FieldLabel htmlFor="condition-name">Condition</FieldLabel>
        <input
          id="condition-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSave()
            }
          }}
          placeholder="Osteoarthritis — L knee, T2 diabetes…"
          disabled={isSaving}
          autoFocus
          style={inputStyle}
        />

        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div style={{ flex: 1 }}>
            <FieldLabel htmlFor="condition-diagnosed">Diagnosed</FieldLabel>
            <input
              id="condition-diagnosed"
              type="date"
              value={diagnosisDate}
              min="1900-01-01"
              onChange={(e) => setDiagnosisDate(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </div>
          <div style={{ width: 140 }}>
            <FieldLabel htmlFor="condition-header-tag">Header tag</FieldLabel>
            <select
              id="condition-header-tag"
              value={showOnHeader ? 'tag' : 'no-tag'}
              onChange={(e) => setShowOnHeader(e.target.value === 'tag')}
              disabled={isSaving}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="tag">Tag</option>
              <option value="no-tag">No tag</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <FieldLabel htmlFor="condition-notes">Context note</FieldLabel>
          <textarea
            id="condition-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional neutral context — e.g. why this isn't currently a concern. Not for contraindications or precautions (flag those in clinical notes)."
            disabled={isSaving}
            rows={3}
            style={{
              ...inputStyle,
              height: 'auto',
              padding: '8px 12px',
              resize: 'vertical',
              lineHeight: 1.5,
            }}
          />
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'rgba(214,64,69,.08)',
              border: '1px solid rgba(214,64,69,.25)',
              borderRadius: 8,
              color: 'var(--color-alert)',
              fontSize: '.84rem',
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 18,
          }}
        >
          <button
            type="button"
            className="btn outline"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? 'Saving…' : condition ? 'Save changes' : 'Save condition'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ====================== Small local bits ====================== */

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '.62rem',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-light)',
        marginBottom: 4,
      }}
    >
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  background: 'var(--color-card)',
  fontSize: '.86rem',
  fontFamily: 'inherit',
  color: 'var(--color-text)',
  outline: 'none',
}


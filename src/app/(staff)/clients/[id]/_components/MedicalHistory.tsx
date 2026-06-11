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
 * and routes through the soft-delete RPC; the confirm copy steers genuine
 * resolutions to Mark resolved. The browser confirm() matches the current
 * NotesTab/flag pattern — CN-13 (P2) replaces all of them together.
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
import type { ProfileCondition } from './ClientProfile'

export function MedicalHistoryPanel({
  clientId,
  conditions,
}: {
  clientId: string
  conditions: ProfileCondition[]
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; condition: ProfileCondition } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
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
    if (
      !confirm(
        `Archive "${c.condition}"? Archiving is for conditions entered by mistake — if the condition has resolved, use Mark resolved so it stays in the client's history.`,
      )
    ) {
      return
    }
    run(c.id, () => archiveMedicalConditionAction(c.id))
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">Medical history</div>
        <button
          type="button"
          className="btn ghost"
          aria-label="Add condition"
          onClick={() => setDialog({ mode: 'add' })}
          style={{ padding: 6 }}
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>

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
        <div style={{ padding: '10px 18px 14px' }}>
          {active.map((c) => (
            <ConditionRow
              key={c.id}
              condition={c}
              busy={pendingId === c.id}
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
    </div>
  )
}

function ConditionRow({
  condition,
  subdued,
  busy,
  onEdit,
  onToggleActive,
  onArchive,
}: {
  condition: ProfileCondition
  subdued?: boolean
  busy: boolean
  onEdit: () => void
  onToggleActive: () => void
  onArchive: () => void
}) {
  const meta = [
    condition.severity ? `Severity ${condition.severity}` : null,
    condition.diagnosis_date
      ? `diagnosed ${formatConditionDate(condition.diagnosis_date)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      style={{
        padding: '8px 0',
        borderBottom: '1px solid var(--color-border-hairline)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <div
        style={{
          fontSize: '.86rem',
          fontWeight: 600,
          color: subdued ? 'var(--color-text-light)' : 'var(--color-text)',
        }}
      >
        {condition.condition}
      </div>
      {meta && (
        <div
          style={{
            fontSize: '.76rem',
            color: 'var(--color-muted)',
            marginTop: 1,
          }}
        >
          {meta}
        </div>
      )}
      {condition.notes && (
        <div
          style={{
            fontSize: '.8rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.5,
            marginTop: 3,
            whiteSpace: 'pre-wrap',
          }}
        >
          {condition.notes}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
        <RowAction label="Edit" disabled={busy} onClick={onEdit} />
        <RowAction
          label={condition.is_active ? 'Mark resolved' : 'Reactivate'}
          emphasis="primary"
          disabled={busy}
          onClick={onToggleActive}
        />
        <RowAction
          label="Archive"
          emphasis="alert"
          disabled={busy}
          onClick={onArchive}
        />
      </div>
    </div>
  )
}

function RowAction({
  label,
  onClick,
  disabled,
  emphasis,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  emphasis?: 'primary' | 'alert'
}) {
  const color =
    emphasis === 'primary'
      ? 'var(--color-primary)'
      : emphasis === 'alert'
        ? 'var(--color-alert)'
        : 'var(--color-text-light)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        fontFamily: 'inherit',
        fontWeight: 600,
        fontSize: '.76rem',
        color: disabled ? 'var(--color-muted)' : color,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {label}
    </button>
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
  const [severity, setSeverity] = useState<string>(
    condition?.severity ? String(condition.severity) : '',
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
        severity: severity === '' ? null : Number(severity),
        notes,
      }
      const res = condition
        ? await updateMedicalConditionAction({
            conditionId: condition.id,
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
          <div style={{ width: 130 }}>
            <FieldLabel htmlFor="condition-severity">Severity</FieldLabel>
            <select
              id="condition-severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              disabled={isSaving}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">None</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <FieldLabel htmlFor="condition-notes">Notes</FieldLabel>
          <textarea
            id="condition-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional context — management, restrictions, clearance…"
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

function formatConditionDate(dateIso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(dateIso))
  } catch {
    return dateIso
  }
}

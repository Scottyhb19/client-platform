'use client'

/**
 * Medications card on the Profile tab (profile rework commit 2).
 *
 * Clone of MedicalHistory.tsx, retargeted at client_medications (migration
 * 20260629140000). Each row is a medication name (body weight) with an
 * optional one-line neutral context note beneath it. Row actions live in the
 * hover / focus overflow menu (Edit, Mark ceased, Archive) — only Archive is
 * red, and only inside the menu.
 *
 * Verbs (see medication-actions.ts): "Mark ceased" (is_active = false) keeps
 * the row in the record (Ceased group) — the primary remove. Archive routes
 * through the soft-delete RPC and is for entries created by mistake; the
 * on-system confirm steers genuine cessations to Mark ceased.
 *
 * The context note is for neutral context only (a nuance such as why
 * something is not currently an issue) — never contraindications or
 * precautions, which are flagged in the clinical-notes layer and not stored
 * here.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import {
  archiveMedicationAction,
  createMedicationAction,
  setMedicationActiveAction,
  updateMedicationAction,
} from '../medication-actions'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'
import { ProfileCard, ProfileRow, type OverflowItem } from './profile-ui'
import type { ProfileMedication } from './ClientProfile'

export function MedicationsPanel({
  clientId,
  medications,
  readOnly = false,
}: {
  clientId: string
  medications: ProfileMedication[]
  /** CN-7: archived client — list renders, every mutating affordance hidden. */
  readOnly?: boolean
}) {
  const router = useRouter()
  const [dialog, setDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; medication: ProfileMedication } | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] =
    useState<ProfileMedication | null>(null)
  const [, startTransition] = useTransition()

  const active = medications.filter((m) => m.is_active)
  const ceased = medications.filter((m) => !m.is_active)

  function run(
    medicationId: string,
    action: () => Promise<{ error: string | null }>,
  ) {
    if (pendingId) return
    setError(null)
    setPendingId(medicationId)
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

  return (
    <ProfileCard
      title="Medications"
      action={
        readOnly ? undefined : (
          <button
            type="button"
            className="btn ghost"
            aria-label="Add medication"
            onClick={() => setDialog({ mode: 'add' })}
            style={{ padding: 6 }}
          >
            <Plus size={14} aria-hidden />
          </button>
        )
      }
    >
      {active.length === 0 && ceased.length === 0 ? (
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
          {active.map((m) => (
            <MedicationRow
              key={m.id}
              medication={m}
              busy={pendingId === m.id}
              readOnly={readOnly}
              onEdit={() => setDialog({ mode: 'edit', medication: m })}
              onToggleActive={() =>
                run(m.id, () => setMedicationActiveAction(m.id, false))
              }
              onArchive={() => setConfirmArchive(m)}
            />
          ))}

          {ceased.length > 0 && (
            <>
              <div
                className="eyebrow"
                style={{
                  fontSize: '.64rem',
                  margin: active.length > 0 ? '14px 0 4px' : '4px 0',
                }}
              >
                Ceased
              </div>
              {ceased.map((m) => (
                <MedicationRow
                  key={m.id}
                  medication={m}
                  subdued
                  busy={pendingId === m.id}
                  readOnly={readOnly}
                  onEdit={() => setDialog({ mode: 'edit', medication: m })}
                  onToggleActive={() =>
                    run(m.id, () => setMedicationActiveAction(m.id, true))
                  }
                  onArchive={() => setConfirmArchive(m)}
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
        <MedicationDialog
          clientId={clientId}
          medication={dialog.mode === 'edit' ? dialog.medication : null}
          onClose={() => setDialog(null)}
        />
      )}

      {confirmArchive && (
        <ConfirmDialog
          title="Archive this medication?"
          body={`${confirmArchive.name} — archiving is for medications entered by mistake. If the client has stopped taking it, use Mark ceased so it stays in their history.`}
          confirmLabel="Archive medication"
          tone="alert"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => {
            const m = confirmArchive
            setConfirmArchive(null)
            run(m.id, () => archiveMedicationAction(m.id))
          }}
        />
      )}
    </ProfileCard>
  )
}

function MedicationRow({
  medication,
  subdued,
  busy,
  readOnly,
  onEdit,
  onToggleActive,
  onArchive,
}: {
  medication: ProfileMedication
  subdued?: boolean
  busy: boolean
  readOnly?: boolean
  onEdit: () => void
  onToggleActive: () => void
  onArchive: () => void
}) {
  // Only Archive is red, and only here in the menu. CN-7: read-only rows
  // carry no menu at all (ProfileRow skips it for an empty array).
  const menuItems: OverflowItem[] = readOnly
    ? []
    : [
        { key: 'edit', label: 'Edit', disabled: busy, onSelect: onEdit },
        {
          key: 'toggle',
          label: medication.is_active ? 'Mark ceased' : 'Reactivate',
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
      name={medication.name}
      subdued={subdued}
      busy={busy}
      contextNote={medication.context_note}
      menuLabel={`Actions for ${medication.name}`}
      menuItems={menuItems}
    />
  )
}

/* ====================== Add / edit dialog ====================== */

function MedicationDialog({
  clientId,
  medication,
  onClose,
}: {
  clientId: string
  /** Null = add; a medication = edit. */
  medication: ProfileMedication | null
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(medication?.name ?? '')
  const [contextNote, setContextNote] = useState(
    medication?.context_note ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  function handleSave() {
    if (isSaving) return
    if (!name.trim()) {
      setError('Medication name is required.')
      return
    }
    setError(null)
    startSaving(async () => {
      const fields = { name, contextNote }
      const res = medication
        ? await updateMedicationAction({
            medicationId: medication.id,
            version: medication.version,
            ...fields,
          })
        : await createMedicationAction({ clientId, ...fields })
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
      aria-labelledby="medication-dialog-heading"
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
          borderRadius: 'var(--radius-card)',
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="medication-dialog-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 14px',
            color: 'var(--color-charcoal)',
          }}
        >
          {medication ? 'Edit medication' : 'Add medication'}
        </h2>

        <FieldLabel htmlFor="medication-name">Medication</FieldLabel>
        <input
          id="medication-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSave()
            }
          }}
          placeholder="Metformin, Atorvastatin…"
          disabled={isSaving}
          autoFocus
          style={inputStyle}
        />

        <div style={{ marginTop: 12 }}>
          <FieldLabel htmlFor="medication-context">Context note</FieldLabel>
          <input
            id="medication-context"
            type="text"
            value={contextNote}
            onChange={(e) => setContextNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSave()
              }
            }}
            placeholder="Optional one-line neutral context — not precautions"
            disabled={isSaving}
            style={inputStyle}
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
            {isSaving
              ? 'Saving…'
              : medication
                ? 'Save changes'
                : 'Save medication'}
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
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-card)',
  fontSize: '.86rem',
  fontFamily: 'inherit',
  color: 'var(--color-text)',
  outline: 'none',
}

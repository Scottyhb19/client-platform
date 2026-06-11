'use client'

/**
 * CN-1 + CN-4 — injury flags and contraindications on the client profile.
 *
 * FlagBanners renders the design-system clinical flag banner — the one
 * permitted use of the left-border accent pattern (3px solid alert red +
 * rgba(214,64,69,0.05) wash). It sits above the tab panels so an active
 * flag is visible on every tab of the clinical record. Clicking a banner
 * opens the manager.
 *
 * FlagDialog is the single flag control (operator-directed shape,
 * 2026-06-11): the header Flag icon turns red while flags are active and
 * opens the manager list; each flag offers Mark reviewed / Edit / Resolve
 * / Archive. With no active flags the dialog opens straight into the
 * create form.
 *
 * Resolve vs archive: resolving keeps the flag in the client's history
 * with its resolved date (clinical-record integrity) and merely
 * deactivates it everywhere; archive (soft-delete, author-locked RPC) is
 * for flags created by mistake.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  archiveClinicalNoteAction,
  createClinicalFlagAction,
  markClinicalFlagReviewedAction,
  resolveClinicalFlagAction,
  updateClinicalFlagAction,
  type ClinicalFlagType,
} from '../notes-actions'
import { ConfirmDialog } from './ConfirmDialog'

export type ClientFlag = {
  id: string
  flag_type: ClinicalFlagType
  body_region: string
  severity: number | null
  note: string
  note_date: string
  reviewed_at: string | null
  version: number
}

const FLAG_TYPE_LABEL: Record<ClinicalFlagType, string> = {
  injury_flag: 'Injury flag',
  contraindication: 'Contraindication',
}

/* ====================== Banners ====================== */

export function FlagBanners({
  flags,
  onManage,
}: {
  flags: ClientFlag[]
  onManage: () => void
}) {
  if (flags.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        marginBottom: 20,
      }}
    >
      {flags.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={onManage}
          title="Manage flags"
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            cursor: 'pointer',
            fontFamily: 'inherit',
            border: 'none',
            borderLeft: '3px solid var(--color-alert)',
            background: 'rgba(214,64,69,0.05)',
            borderRadius: '0 10px 10px 0',
            padding: '10px 14px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '.62rem',
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--color-alert)',
              }}
            >
              {FLAG_TYPE_LABEL[f.flag_type]}
              {f.severity ? ` — severity ${f.severity}` : ''}
            </span>
            <span
              style={{
                fontSize: '.7rem',
                color: 'var(--color-text-light)',
              }}
            >
              {formatFlagDate(f.note_date)}
            </span>
          </div>
          <div
            style={{
              fontSize: '.88rem',
              fontWeight: 600,
              color: 'var(--color-text)',
              marginTop: 2,
            }}
          >
            {f.body_region}
          </div>
          {f.note && (
            <div
              style={{
                fontSize: '.82rem',
                color: 'var(--color-text-light)',
                lineHeight: 1.5,
                marginTop: 2,
                whiteSpace: 'pre-wrap',
              }}
            >
              {f.note}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

/* ====================== Dialog (list / create / edit) ====================== */

type DialogView = { mode: 'list' } | { mode: 'create' } | { mode: 'edit'; flag: ClientFlag }

export function FlagDialog({
  clientId,
  flags,
  onClose,
}: {
  clientId: string
  flags: ClientFlag[]
  onClose: () => void
}) {
  // No active flags → straight into the create form; otherwise manage.
  const [view, setView] = useState<DialogView>(
    flags.length === 0 ? { mode: 'create' } : { mode: 'list' },
  )
  const [isBusy, setIsBusy] = useState(false)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="flag-dialog-heading"
      onClick={() => {
        if (!isBusy) onClose()
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
          id="flag-dialog-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 14px',
            color: 'var(--color-charcoal)',
          }}
        >
          {view.mode === 'list'
            ? 'Flags'
            : view.mode === 'edit'
              ? 'Edit flag'
              : 'Add flag'}
        </h2>

        {view.mode === 'list' && (
          <FlagList
            flags={flags}
            onAdd={() => setView({ mode: 'create' })}
            onEdit={(flag) => setView({ mode: 'edit', flag })}
            onBusy={setIsBusy}
            onClose={onClose}
          />
        )}
        {view.mode !== 'list' && (
          <FlagForm
            clientId={clientId}
            flag={view.mode === 'edit' ? view.flag : null}
            onBusy={setIsBusy}
            onDone={() => {
              // Return to the list when there is one to return to;
              // otherwise the create form was the whole dialog.
              if (flags.length > 0) setView({ mode: 'list' })
              else onClose()
            }}
            onCancel={() => {
              if (flags.length > 0) setView({ mode: 'list' })
              else onClose()
            }}
          />
        )}
      </div>
    </div>
  )
}

/* ====================== Manager list ====================== */

function FlagList({
  flags,
  onAdd,
  onEdit,
  onBusy,
  onClose,
}: {
  flags: ClientFlag[]
  onAdd: () => void
  onEdit: (flag: ClientFlag) => void
  onBusy: (busy: boolean) => void
  onClose: () => void
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  // CN-13: on-system archive confirm; errors from the action land in the
  // list's persistent error block via run(), same as every other verb.
  const [confirmArchive, setConfirmArchive] = useState<ClientFlag | null>(null)
  const [, startTransition] = useTransition()

  function run(
    flagId: string,
    action: () => Promise<{ error: string | null }>,
  ) {
    if (pendingId) return
    setError(null)
    setPendingId(flagId)
    onBusy(true)
    startTransition(async () => {
      const res = await action()
      setPendingId(null)
      onBusy(false)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleArchive(flag: ClientFlag) {
    setConfirmArchive(flag)
  }

  if (flags.length === 0) {
    return (
      <div>
        <p
          style={{
            fontSize: '.88rem',
            color: 'var(--color-text-light)',
            margin: '0 0 16px',
          }}
        >
          No active flags.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" className="btn outline" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={onAdd}>
            Add flag
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {flags.map((f) => {
          const busy = pendingId === f.id
          return (
            <div
              key={f.id}
              style={{
                borderLeft: '3px solid var(--color-alert)',
                background: 'rgba(214,64,69,0.05)',
                borderRadius: '0 10px 10px 0',
                padding: '10px 14px',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '.62rem',
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    color: 'var(--color-alert)',
                  }}
                >
                  {FLAG_TYPE_LABEL[f.flag_type]}
                  {f.severity ? ` — severity ${f.severity}` : ''}
                </span>
                <span
                  style={{ fontSize: '.7rem', color: 'var(--color-text-light)' }}
                >
                  {formatFlagDate(f.note_date)}
                  {f.reviewed_at
                    ? ` · reviewed ${formatFlagDate(f.reviewed_at)}`
                    : ''}
                </span>
              </div>
              <div
                style={{
                  fontSize: '.88rem',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  marginTop: 2,
                }}
              >
                {f.body_region}
              </div>
              {f.note && (
                <div
                  style={{
                    fontSize: '.8rem',
                    color: 'var(--color-text-light)',
                    lineHeight: 1.5,
                    marginTop: 2,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {f.note}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  marginTop: 8,
                }}
              >
                <FlagAction
                  label="Mark reviewed"
                  disabled={busy}
                  onClick={() =>
                    run(f.id, () => markClinicalFlagReviewedAction(f.id))
                  }
                />
                <FlagAction
                  label="Edit"
                  disabled={busy}
                  onClick={() => onEdit(f)}
                />
                <FlagAction
                  label="Resolve"
                  emphasis="primary"
                  disabled={busy}
                  onClick={() => run(f.id, () => resolveClinicalFlagAction(f.id))}
                />
                <FlagAction
                  label="Archive"
                  emphasis="alert"
                  disabled={busy}
                  onClick={() => handleArchive(f)}
                />
              </div>
            </div>
          )
        })}
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
        <button type="button" className="btn outline" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn primary" onClick={onAdd}>
          Add flag
        </button>
      </div>

      {confirmArchive && (
        <ConfirmDialog
          title={`Archive this ${FLAG_TYPE_LABEL[confirmArchive.flag_type].toLowerCase()}?`}
          body={`${confirmArchive.body_region} — archiving is for flags created by mistake. If the injury has recovered, use Resolve so the flag stays in the client's history.`}
          confirmLabel="Archive flag"
          tone="alert"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => {
            const flag = confirmArchive
            setConfirmArchive(null)
            run(flag.id, () => archiveClinicalNoteAction(flag.id))
          }}
        />
      )}
    </div>
  )
}

function FlagAction({
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

/* ====================== Create / edit form ====================== */

function FlagForm({
  clientId,
  flag,
  onBusy,
  onDone,
  onCancel,
}: {
  clientId: string
  /** Null = create; a flag = edit (type is fixed once created). */
  flag: ClientFlag | null
  onBusy: (busy: boolean) => void
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [flagType, setFlagType] = useState<ClinicalFlagType>(
    flag?.flag_type ?? 'injury_flag',
  )
  const [bodyRegion, setBodyRegion] = useState(flag?.body_region ?? '')
  const [severity, setSeverity] = useState<string>(
    flag?.severity ? String(flag.severity) : '',
  )
  const [note, setNote] = useState(flag?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  function handleSave() {
    if (isSaving) return
    if (!bodyRegion.trim()) {
      setError('Body region is required.')
      return
    }
    setError(null)
    onBusy(true)
    startSaving(async () => {
      const res = flag
        ? await updateClinicalFlagAction({
            noteId: flag.id,
            bodyRegion,
            severity: severity === '' ? null : Number(severity),
            note,
            version: flag.version,
          })
        : await createClinicalFlagAction({
            clientId,
            flagType,
            bodyRegion,
            severity: severity === '' ? null : Number(severity),
            note,
          })
      onBusy(false)
      if (res.error) {
        setError(res.error)
        return
      }
      router.refresh()
      onDone()
    })
  }

  return (
    <div>
      {/* Type — segmented pair; fixed once created */}
      {!flag && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(Object.keys(FLAG_TYPE_LABEL) as ClinicalFlagType[]).map((t) => {
            const on = flagType === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setFlagType(t)}
                aria-pressed={on}
                style={{
                  flex: 1,
                  height: 34,
                  borderRadius: 7,
                  border: `1px solid ${
                    on ? 'var(--color-alert)' : 'var(--color-border-subtle)'
                  }`,
                  background: on ? 'rgba(214,64,69,0.06)' : 'var(--color-card)',
                  color: on ? 'var(--color-alert)' : 'var(--color-text-light)',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  fontSize: '.82rem',
                  cursor: 'pointer',
                  transition: 'all 150ms cubic-bezier(0.4,0,0.2,1)',
                }}
              >
                {FLAG_TYPE_LABEL[t]}
              </button>
            )
          })}
        </div>
      )}
      {flag && (
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.62rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-alert)',
            marginBottom: 14,
          }}
        >
          {FLAG_TYPE_LABEL[flag.flag_type]}
        </div>
      )}

      <FieldLabel htmlFor="flag-body-region">Body region</FieldLabel>
      <input
        id="flag-body-region"
        type="text"
        value={bodyRegion}
        onChange={(e) => setBodyRegion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            handleSave()
          }
        }}
        placeholder="L knee, R shoulder, cardiovascular…"
        disabled={isSaving}
        autoFocus
        style={inputStyle}
      />

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <div style={{ width: 130 }}>
          <FieldLabel htmlFor="flag-severity">Severity</FieldLabel>
          <select
            id="flag-severity"
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
        <FieldLabel htmlFor="flag-note">Note</FieldLabel>
        <textarea
          id="flag-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional context — mechanism, restrictions, clearance…"
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
          onClick={onCancel}
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
          {isSaving ? 'Saving…' : flag ? 'Save changes' : 'Save flag'}
        </button>
      </div>
    </div>
  )
}

/* ====================== Small shared bits ====================== */

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

function formatFlagDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

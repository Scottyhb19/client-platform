'use client'

/**
 * CN-1 — injury flags and contraindications on the client profile.
 *
 * FlagBanners renders the design-system clinical flag banner — the one
 * permitted use of the left-border accent pattern (3px solid alert red +
 * rgba(214,64,69,0.05) wash). It sits above the tab panels so an active
 * flag is visible on every tab of the clinical record, not just Notes.
 *
 * FlagComposer is the dedicated creation control: type, body region,
 * optional severity, optional note. Flags are clinical_notes rows
 * (note_type = injury_flag | contraindication) created via
 * createClinicalFlagAction — deliberately not the template form, because
 * a flag is a ten-second structured marker, not a document.
 *
 * Review / resolve actions are CN-4 (next gap in dependency order);
 * until it lands a flag stays active once created.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createClinicalFlagAction,
  type ClinicalFlagType,
} from '../notes-actions'

export type ClientFlag = {
  id: string
  flag_type: ClinicalFlagType
  body_region: string
  severity: number | null
  note: string
  note_date: string
}

const FLAG_TYPE_LABEL: Record<ClinicalFlagType, string> = {
  injury_flag: 'Injury flag',
  contraindication: 'Contraindication',
}

/* ====================== Banners ====================== */

export function FlagBanners({ flags }: { flags: ClientFlag[] }) {
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
        <div
          key={f.id}
          style={{
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
        </div>
      ))}
    </div>
  )
}

/* ====================== Composer ====================== */

export function FlagComposer({
  clientId,
  onClose,
}: {
  clientId: string
  onClose: () => void
}) {
  const router = useRouter()
  const [flagType, setFlagType] = useState<ClinicalFlagType>('injury_flag')
  const [bodyRegion, setBodyRegion] = useState('')
  const [severity, setSeverity] = useState<string>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  function handleSave() {
    if (isSaving) return
    if (!bodyRegion.trim()) {
      setError('Body region is required.')
      return
    }
    setError(null)
    startSaving(async () => {
      const res = await createClinicalFlagAction({
        clientId,
        flagType,
        bodyRegion,
        severity: severity === '' ? null : Number(severity),
        note,
      })
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
      aria-labelledby="flag-composer-heading"
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
          maxWidth: 440,
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="flag-composer-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 14px',
            color: 'var(--color-charcoal)',
          }}
        >
          Add flag
        </h2>

        {/* Type — segmented pair */}
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
            {isSaving ? 'Saving…' : 'Save flag'}
          </button>
        </div>
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

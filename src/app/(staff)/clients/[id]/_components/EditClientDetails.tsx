'use client'

/**
 * CN-5 — edit dialog for a client's personal (Contact) details.
 *
 * Covers everything the Contact panel renders: name, phone, DOB, sex,
 * address, category, referrer, referred-by, emergency contact. Email renders
 * read-only with no edit control — it is the invite/login identity (see
 * updateClientDetailsAction). Goals are edited separately via GoalsEditDialog
 * (the Goals card has its own pencil), so they are no longer part of this form.
 *
 * OCC: the form carries clients.version from the page load; the action
 * refuses the save if the row has moved on (second tab, second staff
 * member) rather than silently clobbering. GoalsEditDialog shares the same
 * version, so a goals edit and a details edit can't silently overwrite.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  updateClientDetailsAction,
  updateClientGoalsAction,
} from '../actions'
import type { ProfileCategory, ProfileClient } from './ClientProfile'

export function EditClientDetailsDialog({
  client,
  categories,
  onClose,
}: {
  client: ProfileClient
  categories: ProfileCategory[]
  onClose: () => void
}) {
  const router = useRouter()
  const [firstName, setFirstName] = useState(client.first_name)
  const [lastName, setLastName] = useState(client.last_name)
  const [phone, setPhone] = useState(client.phone ?? '')
  const [dob, setDob] = useState(client.dob ?? '')
  const [sex, setSex] = useState(client.sex ?? '')
  const [address, setAddress] = useState(client.address ?? '')
  const [categoryId, setCategoryId] = useState(client.category_id ?? '')
  const [referralSource, setReferralSource] = useState(
    client.referral_source ?? '',
  )
  const [referredBy, setReferredBy] = useState(client.referred_by ?? '')
  const [emergencyName, setEmergencyName] = useState(
    client.emergency_contact_name ?? '',
  )
  const [emergencyPhone, setEmergencyPhone] = useState(
    client.emergency_contact_phone ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  function handleSave() {
    if (isSaving) return
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required.')
      return
    }
    setError(null)
    startSaving(async () => {
      const res = await updateClientDetailsAction({
        clientId: client.id,
        version: client.version,
        firstName,
        lastName,
        phone,
        dob,
        sex,
        address,
        categoryId: categoryId === '' ? null : categoryId,
        referralSource,
        referredBy,
        emergencyContactName: emergencyName,
        emergencyContactPhone: emergencyPhone,
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
      aria-labelledby="edit-details-heading"
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
          maxWidth: 560,
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          background: 'var(--color-card)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 14,
          padding: '24px 26px',
          boxShadow: '0 12px 40px rgba(0,0,0,.18)',
        }}
      >
        <h2
          id="edit-details-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 14px',
            color: 'var(--color-charcoal)',
          }}
        >
          Edit details
        </h2>

        <Row>
          <Field label="First name" htmlFor="edit-first-name">
            <input
              id="edit-first-name"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={isSaving}
              autoFocus
              style={inputStyle}
            />
          </Field>
          <Field label="Last name" htmlFor="edit-last-name">
            <input
              id="edit-last-name"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
        </Row>

        {/* Email is the sign-in identity — rendered, not editable. */}
        <div style={{ marginTop: 12 }}>
          <FieldLabel>Email</FieldLabel>
          <div
            style={{
              fontSize: '.86rem',
              color: 'var(--color-text-light)',
              padding: '8px 0 2px',
            }}
          >
            {client.email}
          </div>
        </div>

        <Row style={{ marginTop: 12 }}>
          <Field label="Phone" htmlFor="edit-phone">
            <input
              id="edit-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
          <Field label="Date of birth" htmlFor="edit-dob">
            <input
              id="edit-dob"
              type="date"
              value={dob}
              min="1900-01-01"
              onChange={(e) => setDob(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
        </Row>

        <Row style={{ marginTop: 12 }}>
          <Field label="Sex" htmlFor="edit-sex">
            <input
              id="edit-sex"
              type="text"
              value={sex}
              onChange={(e) => setSex(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
          <Field label="Category" htmlFor="edit-category">
            <select
              id="edit-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={isSaving}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">—</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </Row>

        <div style={{ marginTop: 12 }}>
          <Field label="Address" htmlFor="edit-address">
            <input
              id="edit-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
        </div>

        <Row style={{ marginTop: 12 }}>
          <Field label="Referrer" htmlFor="edit-referral-source">
            <input
              id="edit-referral-source"
              type="text"
              value={referralSource}
              onChange={(e) => setReferralSource(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
          <Field label="Referred by" htmlFor="edit-referred-by">
            <input
              id="edit-referred-by"
              type="text"
              value={referredBy}
              onChange={(e) => setReferredBy(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
        </Row>

        <Row style={{ marginTop: 12 }}>
          <Field label="Emergency contact" htmlFor="edit-emergency-name">
            <input
              id="edit-emergency-name"
              type="text"
              value={emergencyName}
              onChange={(e) => setEmergencyName(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
          <Field label="Emergency phone" htmlFor="edit-emergency-phone">
            <input
              id="edit-emergency-phone"
              type="tel"
              value={emergencyPhone}
              onChange={(e) => setEmergencyPhone(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
        </Row>

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
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ====================== Goals edit dialog ====================== */

/**
 * Dedicated goals editor — opened from the Goals card's pencil, separate from
 * the Contact "Edit details" form. One goal per line; the Profile tab renders
 * the saved text as a real list by splitting on newlines.
 */
export function GoalsEditDialog({
  client,
  onClose,
}: {
  client: ProfileClient
  onClose: () => void
}) {
  const router = useRouter()
  const [goals, setGoals] = useState(client.goals ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()

  function handleSave() {
    if (isSaving) return
    setError(null)
    startSaving(async () => {
      const res = await updateClientGoalsAction({
        clientId: client.id,
        version: client.version,
        goals,
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
      aria-labelledby="edit-goals-heading"
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
          id="edit-goals-heading"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '1.3rem',
            margin: '0 0 14px',
            color: 'var(--color-charcoal)',
          }}
        >
          Edit goals
        </h2>

        <FieldLabel htmlFor="goals-only">Goals</FieldLabel>
        <textarea
          id="goals-only"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          placeholder="One goal per line"
          disabled={isSaving}
          autoFocus
          rows={5}
          style={{
            ...inputStyle,
            height: 'auto',
            padding: '8px 12px',
            resize: 'vertical',
            lineHeight: 1.5,
          }}
        />

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
            {isSaving ? 'Saving…' : 'Save goals'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ====================== Small local bits ====================== */

function Row({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </div>
  )
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string
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

'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
} from 'lucide-react'
import { AutoTextarea } from '@/components/AutoTextarea'
import {
  addNoteTemplateFieldAction,
  createNoteTemplateAction,
  deleteNoteTemplateAction,
  deleteNoteTemplateFieldAction,
  moveNoteTemplateFieldAction,
  renameNoteTemplateAction,
  updateNoteTemplateFieldAction,
  type NoteTemplateRow,
} from '../actions'

/**
 * Settings → Note templates.
 *
 * The editor IS the form — what you see here is exactly what an EP sees
 * when writing a note from the template. Each field renders with an
 * inline-editable heading on top and an auto-growing textarea beneath
 * it. Whatever you type into that textarea becomes the field's default
 * value (pre-fills new notes from this template). Up/down/delete and
 * the save indicator sit on the right of each row, always visible.
 *
 * Save model: blur commits. A small "Saving…" → "Saved" indicator beside
 * each field gives feedback without a global save button.
 *
 * The legacy `field_type` enum (short_text / long_text / number) is no
 * longer surfaced; every field is treated as a long-text box. The DB
 * enum stays for back-compat — legacy rows soft-migrate to long_text on
 * first edit.
 */
export function NoteTemplatesEditor({
  initialTemplates,
}: {
  initialTemplates: NoteTemplateRow[]
}) {
  const router = useRouter()
  const [templates, setTemplates] = useState<NoteTemplateRow[]>(initialTemplates)
  // Templates default to closed — they only open when the EP physically
  // expands one. Newly created templates are auto-opened by handleAddTemplate
  // (see below) so the EP can immediately edit the just-created template.
  const [openId, setOpenId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Re-sync local templates when server-fed prop refreshes (e.g. after
  // adding a field). Keeps the UI in lockstep with the database.
  useEffect(() => {
    setTemplates(initialTemplates)
  }, [initialTemplates])

  function handleAddTemplate() {
    if (!newName.trim()) {
      setAddError('Template name is required.')
      return
    }
    setAddError(null)
    startTransition(async () => {
      const res = await createNoteTemplateAction(newName)
      if (res.error || !res.id) {
        setAddError(res.error ?? 'Unknown error.')
        return
      }
      setNewName('')
      router.refresh()
      setOpenId(res.id)
    })
  }

  function handleDeleteTemplate(t: NoteTemplateRow) {
    if (
      !confirm(
        `Delete "${t.name}"? Existing notes written with this template stay readable — they keep their field labels — but you won't be able to write new notes against this template.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await deleteNoteTemplateAction(t.id)
      if (res.error) {
        alert(res.error)
        return
      }
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
      if (openId === t.id) setOpenId(null)
      router.refresh()
    })
  }

  return (
    <div style={{ padding: '14px 22px 18px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            open={openId === t.id}
            onToggle={() => setOpenId((cur) => (cur === t.id ? null : t.id))}
            onDelete={() => handleDeleteTemplate(t)}
          />
        ))}
      </div>

      <div
        style={{
          marginTop: 16,
          paddingTop: 14,
          borderTop: '1px dashed var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAddTemplate()
              }
            }}
            placeholder="New template name (e.g. Phone call, Initial assessment)…"
            disabled={pending}
            style={{
              flex: 1,
              height: 36,
              padding: '0 12px',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 7,
              background: 'var(--color-card)',
              fontSize: '.86rem',
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleAddTemplate}
            disabled={pending || !newName.trim()}
            className="btn primary"
            style={{ padding: '0 14px', height: 36 }}
          >
            <Plus size={14} aria-hidden />
            Add template
          </button>
        </div>
        {addError && (
          <div
            role="alert"
            style={{ fontSize: '.78rem', color: 'var(--color-alert)' }}
          >
            {addError}
          </div>
        )}
      </div>
    </div>
  )
}

/* ====================== Template card ====================== */

function TemplateCard({
  template,
  open,
  onToggle,
  onDelete,
}: {
  template: NoteTemplateRow
  open: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const [name, setName] = useState(template.name)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Sync local state if the prop is refreshed by the server.
  useEffect(() => {
    setName(template.name)
  }, [template.name])

  function commitRename() {
    if (name.trim() === template.name) return
    if (!name.trim()) {
      setName(template.name)
      return
    }
    startTransition(async () => {
      const res = await renameNoteTemplateAction(template.id, name)
      setRenameError(res.error)
      if (res.error) setName(template.name)
    })
  }

  return (
    <div
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 9,
        background: 'var(--color-card)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? 'Collapse template' : 'Expand template'}
          style={{
            width: 22,
            height: 22,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-light)',
            cursor: 'pointer',
            borderRadius: 4,
          }}
        >
          {open ? (
            <ChevronDown size={16} aria-hidden />
          ) : (
            <ChevronRight size={16} aria-hidden />
          )}
        </button>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          aria-label="Template name"
          style={{
            flex: 1,
            border: 'none',
            background: 'transparent',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.95rem',
            color: 'var(--color-charcoal)',
            outline: 'none',
            padding: '4px 6px',
            borderRadius: 4,
          }}
        />
        <span
          style={{
            fontSize: '.74rem',
            color: 'var(--color-text-light)',
          }}
        >
          {template.fields.length}{' '}
          {template.fields.length === 1 ? 'field' : 'fields'}
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete template"
          title="Delete template"
          style={{
            width: 28,
            height: 28,
            display: 'grid',
            placeItems: 'center',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-light)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
      {renameError && (
        <div
          role="alert"
          style={{
            padding: '0 12px 8px 40px',
            fontSize: '.74rem',
            color: 'var(--color-alert)',
          }}
        >
          {renameError}
        </div>
      )}
      {open && (
        <FieldBuilder
          templateId={template.id}
          initialFields={template.fields}
          onSaveAndClose={onToggle}
        />
      )}
    </div>
  )
}

/* ====================== Field builder (combined editor + preview) ====================== */

function FieldBuilder({
  templateId,
  initialFields,
  onSaveAndClose,
}: {
  templateId: string
  initialFields: NoteTemplateRow['fields']
  onSaveAndClose: () => void
}) {
  const router = useRouter()
  const [newLabel, setNewLabel] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, startAdding] = useTransition()
  const [savedFlash, setSavedFlash] = useState(false)

  // The save button is a safety net for the "type, then click Save"
  // pattern: blurring the active element forces any pending field-level
  // commit to fire. We flash "All changes saved" for a moment, then
  // collapse the card so the EP gets a clear "done" state.
  function handleSaveAll() {
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    setSavedFlash(true)
    window.setTimeout(() => {
      setSavedFlash(false)
      onSaveAndClose()
    }, 700)
  }

  function handleAddField() {
    if (!newLabel.trim()) {
      setAddError('Field label is required.')
      return
    }
    setAddError(null)
    startAdding(async () => {
      const res = await addNoteTemplateFieldAction(templateId, newLabel)
      if (res.error) {
        setAddError(res.error)
        return
      }
      setNewLabel('')
      router.refresh()
    })
  }

  function handleDeleteField(fieldId: string) {
    startAdding(async () => {
      const res = await deleteNoteTemplateFieldAction(fieldId)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  function handleMove(fieldId: string, direction: 'up' | 'down') {
    startAdding(async () => {
      const res = await moveNoteTemplateFieldAction(fieldId, direction)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div
      style={{
        padding: '14px 22px 18px',
        background: 'var(--color-surface)',
        borderTop: '1px dashed var(--color-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {initialFields.length === 0 && (
        <div
          style={{
            padding: '8px 0',
            fontSize: '.84rem',
            color: 'var(--color-text-light)',
            textAlign: 'center',
          }}
        >
          No fields yet — add one below to give the template some shape.
        </div>
      )}

      {initialFields.map((f, idx) => (
        <FieldBlock
          key={f.id}
          field={f}
          isFirst={idx === 0}
          isLast={idx === initialFields.length - 1}
          onMove={(dir) => handleMove(f.id, dir)}
          onDelete={() => handleDeleteField(f.id)}
        />
      ))}

      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          paddingTop: 4,
          borderTop: '1px dashed var(--color-border-subtle)',
        }}
      >
        <input
          type="text"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddField()
            }
          }}
          placeholder="New field label (e.g. Pain rating)…"
          disabled={adding}
          style={{
            flex: 1,
            height: 32,
            padding: '0 10px',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 6,
            background: 'var(--color-card)',
            fontSize: '.84rem',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={handleAddField}
          disabled={adding || !newLabel.trim()}
          className="btn outline"
          style={{ padding: '0 12px', height: 32, fontSize: '.8rem' }}
        >
          <Plus size={13} aria-hidden />
          Add field
        </button>
      </div>
      {addError && (
        <div
          role="alert"
          style={{ fontSize: '.74rem', color: 'var(--color-alert)' }}
        >
          {addError}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 10,
          paddingTop: 10,
          borderTop: '1px dashed var(--color-border-subtle)',
        }}
      >
        {savedFlash && (
          <span
            role="status"
            aria-live="polite"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '.78rem',
              color: 'var(--color-text-light)',
            }}
          >
            <Check size={13} aria-hidden />
            All changes saved
          </span>
        )}
        <button
          type="button"
          onClick={handleSaveAll}
          className="btn primary"
          style={{ padding: '0 16px', height: 34 }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

/* ====================== One field — heading + textarea + controls ====================== */

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function FieldBlock({
  field,
  isFirst,
  isLast,
  onMove,
  onDelete,
}: {
  field: NoteTemplateRow['fields'][number]
  isFirst: boolean
  isLast: boolean
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
}) {
  const [label, setLabel] = useState(field.label)
  const [defaultValue, setDefaultValue] = useState(field.default_value ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  // Re-sync if the parent passes new server data.
  useEffect(() => {
    setLabel(field.label)
    setDefaultValue(field.default_value ?? '')
  }, [field.id, field.label, field.default_value])

  // "Saved" pip auto-clears after a moment so it doesn't hang around.
  useEffect(() => {
    if (status !== 'saved') return
    const id = window.setTimeout(() => setStatus('idle'), 1400)
    return () => window.clearTimeout(id)
  }, [status])

  function commit(nextLabel: string, nextDefault: string) {
    const labelChanged = nextLabel.trim() !== field.label
    const defaultChanged = nextDefault !== (field.default_value ?? '')
    if (!labelChanged && !defaultChanged) return
    if (!nextLabel.trim()) {
      setLabel(field.label) // revert empty labels
      return
    }
    setStatus('saving')
    setErrorMsg(null)
    startTransition(async () => {
      const res = await updateNoteTemplateFieldAction(
        field.id,
        nextLabel,
        nextDefault,
      )
      if (res.error) {
        setStatus('error')
        setErrorMsg(res.error)
      } else {
        setStatus('saved')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <HeadingInput
          value={label}
          onChange={setLabel}
          onCommit={() => commit(label, defaultValue)}
        />
        <SaveIndicator status={status} />
        <FieldControls
          isFirst={isFirst}
          isLast={isLast}
          onMove={onMove}
          onDelete={onDelete}
        />
      </div>
      <AutoTextarea
        value={defaultValue}
        onChange={setDefaultValue}
        onBlur={() => commit(label, defaultValue)}
        placeholder="Optional starter text — pre-fills this field on every new note from this template."
        minHeight={64}
        ariaLabel={`${label} default value`}
        style={{ background: 'var(--color-card)' }}
      />
      {errorMsg && (
        <div
          role="alert"
          style={{
            fontSize: '.72rem',
            color: 'var(--color-alert)',
          }}
        >
          {errorMsg}
        </div>
      )}
    </div>
  )
}

/* ====================== Inline-editable heading ====================== */

/**
 * Looks like a styled heading by default; clicking it focuses an input
 * with the same dimensions so the EP can type a new label without a
 * visible mode switch. Hover and focus reveal a subtle outline so the
 * affordance is discoverable without being noisy.
 */
function HeadingInput({
  value,
  onChange,
  onCommit,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const ringed = hovered || focused

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        setFocused(false)
        onCommit()
      }}
      onFocus={() => setFocused(true)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      aria-label="Field label"
      style={{
        flex: 1,
        background: ringed ? 'var(--color-card)' : 'transparent',
        border: `1px solid ${ringed ? 'var(--color-border-subtle)' : 'transparent'}`,
        padding: '4px 8px',
        borderRadius: 4,
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '.7rem',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-light)',
        outline: 'none',
        transition: 'background 120ms, border-color 120ms',
      }}
    />
  )
}

/* ====================== Save status pip ====================== */

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') {
    return <span style={{ width: 56 }} aria-hidden />
  }
  const label =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : 'Save failed'
  const color =
    status === 'error' ? 'var(--color-alert)' : 'var(--color-text-light)'
  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        fontSize: '.7rem',
        color,
        whiteSpace: 'nowrap',
        width: 56,
        textAlign: 'right',
        fontStyle: status === 'saving' ? 'italic' : 'normal',
      }}
    >
      {label}
    </span>
  )
}

/* ====================== Up/Down/Delete controls ====================== */

function FieldControls({
  isFirst,
  isLast,
  onMove,
  onDelete,
}: {
  isFirst: boolean
  isLast: boolean
  onMove: (direction: 'up' | 'down') => void
  onDelete: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      <button
        type="button"
        onClick={() => onMove('up')}
        disabled={isFirst}
        aria-label="Move field up"
        title="Move up"
        style={controlStyle(isFirst)}
      >
        <ArrowUp size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onMove('down')}
        disabled={isLast}
        aria-label="Move field down"
        title="Move down"
        style={controlStyle(isLast)}
      >
        <ArrowDown size={13} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete field"
        title="Delete field"
        style={controlStyle(false)}
      >
        <Trash2 size={13} aria-hidden />
      </button>
    </div>
  )
}

function controlStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 26,
    height: 26,
    display: 'grid',
    placeItems: 'center',
    background: 'transparent',
    border: 'none',
    color: disabled ? 'var(--color-muted)' : 'var(--color-text-light)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    padding: 0,
    borderRadius: 4,
  }
}

'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  FileText,
  Pin,
  PinOff,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react'
import { AutoTextarea } from '@/components/AutoTextarea'
import {
  archiveClinicalNoteAction,
  createClinicalNoteAction,
  toggleClinicalNotePinAction,
  updateClinicalNoteAction,
  type NoteFieldValue,
} from '../notes-actions'
import type {
  ProfileAppointment,
  ProfileNote,
  ProfileNoteTemplate,
  ProfileReport,
} from './ClientProfile'
import { TestCaptureModal } from './TestCaptureModal'
import type {
  BatteryRow,
  CatalogCategory,
  LastUsedBatteryHint,
} from '@/lib/testing'

type SidebarTab = 'previous' | 'reports' | 'files'
type LeftMode =
  | { kind: 'idle' }
  | { kind: 'create' }
  | { kind: 'edit'; noteId: string }
type SidebarView =
  | { kind: 'list' }
  | { kind: 'reading'; noteId: string }

const PAGE_SIZE = 10
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000

interface NotesTabProps {
  clientId: string
  notes: ProfileNote[]
  templates: ProfileNoteTemplate[]
  appointments: ProfileAppointment[]
  reports: ProfileReport[]
  lastTemplateId: string | null
  initialOpenCreate: boolean
  initialAppointmentId: string | null
  // Testing-module props for the in-note "capture test session" panel.
  // Threaded through to the NoteForm so a clinician can run a battery
  // alongside their narrative without leaving the note editor.
  testCatalog: CatalogCategory[]
  testBatteries: BatteryRow[]
  lastUsedBattery: LastUsedBatteryHint | null
}

/**
 * Session-notes tab.
 *
 * Layout:
 *   - Left column: ONE active form (create / edit) or an empty-state
 *     "Create New Note" button. The chronological feed of saved notes
 *     lives entirely in the side rail.
 *   - Right column: paginated, condensed list of previous notes (pinned
 *     first), plus Reports and Files tabs. Click a note row to expand
 *     it in place; from there you can Edit (which hands off to the left
 *     form, auto-saving any in-progress create-note first) or Export PDF.
 *
 * URL contract: deep-linked from the schedule popover via
 * `?tab=notes&new=1&appointment=<id>` to start a new note pre-filled.
 */
export function NotesTab({
  clientId,
  notes,
  templates,
  appointments,
  reports,
  lastTemplateId,
  initialOpenCreate,
  initialAppointmentId,
  testCatalog,
  testBatteries,
  lastUsedBattery,
}: NotesTabProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [leftMode, setLeftMode] = useState<LeftMode>(
    initialOpenCreate ? { kind: 'create' } : { kind: 'idle' },
  )
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('previous')
  const [sidebarView, setSidebarView] = useState<SidebarView>({ kind: 'list' })
  const [copyMode, setCopyMode] = useState(false)

  const formRef = useRef<NoteFormHandle>(null)

  // Strip the `new=` and `appointment=` URL params after we hydrate the
  // create form — refreshing later shouldn't re-open it.
  const cleanedRef = useRef(false)
  useEffect(() => {
    if (cleanedRef.current) return
    if (!searchParams.has('new') && !searchParams.has('appointment')) {
      cleanedRef.current = true
      return
    }
    const next = new URLSearchParams(searchParams.toString())
    next.delete('new')
    next.delete('appointment')
    cleanedRef.current = true
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '?')
  }, [searchParams, router])

  function handleSavedOk() {
    setLeftMode({ kind: 'idle' })
    router.refresh()
  }

  // Edit handoff. If the left side is mid-create with content, save it
  // first so the practitioner doesn't lose work, then switch to edit.
  async function handleStartEdit(noteId: string) {
    if (leftMode.kind === 'create') {
      const handle = formRef.current
      if (handle && handle.isDirty()) {
        const res = await handle.saveIfDirty()
        if (!res.ok) {
          alert(
            res.error ??
              "Couldn't save the note you were writing — fix the issue or cancel before editing another note.",
          )
          return
        }
      }
    }
    setLeftMode({ kind: 'edit', noteId })
    setSidebarView({ kind: 'list' })
    router.refresh()
  }

  function handleStartCreate() {
    setLeftMode({ kind: 'create' })
  }

  function handleCancel() {
    setLeftMode({ kind: 'idle' })
    setCopyMode(false)
  }

  // The "Edit existing note" link below the appointment picker. Only
  // surfaced when a duplicate is detected, so the in-progress create
  // form is already blocked from saving — no point preserving it.
  function handleEditExistingNote(noteId: string) {
    setLeftMode({ kind: 'edit', noteId })
    setSidebarView({ kind: 'list' })
    setCopyMode(false)
    router.refresh()
  }

  // Copy-mode wiring. The form's chevron button toggles us into select
  // mode; the side rail then shows a copy icon on every same-template
  // note. Clicking that icon hands the note's content back here, which
  // we push into the form via the imperative ref.
  function handleEnterCopyMode() {
    setSidebarTab('previous')
    setSidebarView({ kind: 'list' })
    setCopyMode(true)
  }

  function handleCancelCopyMode() {
    setCopyMode(false)
  }

  function handleCopyFromNote(noteId: string) {
    const handle = formRef.current
    if (!handle) {
      setCopyMode(false)
      return
    }
    if (handle.isUserDirty()) {
      const ok = confirm(
        "You've started writing this note. Replace what you've typed with the copied note's contents?",
      )
      if (!ok) {
        setCopyMode(false)
        return
      }
    }
    const note = notes.find((n) => n.id === noteId)
    const fields = note?.content_json?.fields ?? []
    handle.applyCopy(fields)
    setCopyMode(false)
  }

  // Escape key cancels select mode (matches the modal-dismiss intuition).
  useEffect(() => {
    if (!copyMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setCopyMode(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [copyMode])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 22,
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {leftMode.kind === 'idle' && (
          <button
            type="button"
            onClick={handleStartCreate}
            className="btn primary"
            style={{
              alignSelf: 'flex-start',
              fontSize: '.86rem',
              fontWeight: 600,
              padding: '10px 18px',
            }}
          >
            <Plus size={14} aria-hidden />
            Create New Note
          </button>
        )}
        {leftMode.kind === 'create' && (
          <NoteForm
            ref={formRef}
            mode="create"
            clientId={clientId}
            notes={notes}
            templates={templates}
            appointments={appointments}
            lastTemplateId={lastTemplateId}
            initialAppointmentId={initialAppointmentId}
            existingNote={null}
            copyMode={copyMode}
            onEnterCopyMode={handleEnterCopyMode}
            onExitCopyMode={handleCancelCopyMode}
            onCancel={handleCancel}
            onSaved={handleSavedOk}
            onEditExistingNote={handleEditExistingNote}
            testCatalog={testCatalog}
            testBatteries={testBatteries}
            lastUsedBattery={lastUsedBattery}
          />
        )}
        {leftMode.kind === 'edit' && (
          <NoteForm
            ref={formRef}
            mode="edit"
            clientId={clientId}
            notes={notes}
            templates={templates}
            appointments={appointments}
            lastTemplateId={lastTemplateId}
            initialAppointmentId={null}
            existingNote={notes.find((n) => n.id === leftMode.noteId) ?? null}
            copyMode={false}
            onEnterCopyMode={handleEnterCopyMode}
            onExitCopyMode={handleCancelCopyMode}
            onCancel={handleCancel}
            onSaved={handleSavedOk}
            onEditExistingNote={handleEditExistingNote}
            testCatalog={testCatalog}
            testBatteries={testBatteries}
            lastUsedBattery={lastUsedBattery}
          />
        )}
      </div>

      <SideRail
        clientId={clientId}
        tab={sidebarTab}
        onTabChange={(t) => {
          setSidebarTab(t)
          setSidebarView({ kind: 'list' })
        }}
        view={sidebarView}
        onView={setSidebarView}
        notes={notes}
        appointments={appointments}
        templates={templates}
        reports={reports}
        onStartEdit={handleStartEdit}
        copyMode={copyMode}
        copyTemplateId={
          copyMode ? formRef.current?.getActiveTemplateId() ?? null : null
        }
        onCopyFromNote={handleCopyFromNote}
        onCancelCopy={handleCancelCopyMode}
      />
    </div>
  )
}

/* =========================================================================
 * NoteForm — shared between Create and Edit modes
 * ========================================================================= */

type NoteFormHandle = {
  isDirty: () => boolean
  /** True only when the user has changed at least one field beyond its
   *  initial (default-from-template) value — i.e. real typed input. */
  isUserDirty: () => boolean
  saveIfDirty: () => Promise<{ ok: boolean; error?: string }>
  getActiveTemplateId: () => string | null
  /** Replace current values with the given content, matched by label. */
  applyCopy: (
    fields: ReadonlyArray<{ label: string; value: string }>,
  ) => void
}

const NoteForm = forwardRef<
  NoteFormHandle,
  {
    mode: 'create' | 'edit'
    clientId: string
    notes: ProfileNote[]
    templates: ProfileNoteTemplate[]
    appointments: ProfileAppointment[]
    lastTemplateId: string | null
    initialAppointmentId: string | null
    existingNote: ProfileNote | null
    copyMode: boolean
    onEnterCopyMode: () => void
    onExitCopyMode: () => void
    onCancel: () => void
    onSaved: () => void
    onEditExistingNote: (noteId: string) => void
    testCatalog: CatalogCategory[]
    testBatteries: BatteryRow[]
    lastUsedBattery: LastUsedBatteryHint | null
  }
>(function NoteForm(
  {
    mode,
    clientId,
    notes,
    templates,
    appointments,
    lastTemplateId,
    initialAppointmentId,
    existingNote,
    copyMode,
    onEnterCopyMode,
    onExitCopyMode,
    onCancel,
    onSaved,
    onEditExistingNote,
    testCatalog,
    testBatteries,
    lastUsedBattery,
  },
  ref,
) {
  // ---- Template selection ------------------------------------------------
  const defaultTemplateId = useMemo(() => {
    if (mode === 'edit' && existingNote?.template_id) {
      return existingNote.template_id
    }
    if (lastTemplateId && templates.some((t) => t.id === lastTemplateId)) {
      return lastTemplateId
    }
    return templates[0]?.id ?? null
  }, [mode, existingNote, lastTemplateId, templates])

  const [templateId, setTemplateId] = useState<string | null>(defaultTemplateId)

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  )

  // ---- Appointment selection ---------------------------------------------
  // Priority:
  //   1. Edit mode → the note's existing appointment.
  //   2. URL-supplied appointment id (deep-link from schedule popover).
  //      Honoured even if it's already taken — the conflict banner will
  //      surface clearly so the EP can hop to the existing note.
  //   3. Next future appointment if it doesn't already have a note.
  //   4. Otherwise, "None — no linked session". The picker stays usable;
  //      the EP picks a different upcoming session manually if needed.
  const defaultAppointmentId = useMemo(() => {
    if (mode === 'edit') return existingNote?.appointment_id ?? null
    if (
      initialAppointmentId &&
      appointments.some((a) => a.id === initialAppointmentId)
    ) {
      return initialAppointmentId
    }
    const usedAppointmentIds = new Set<string>()
    for (const n of notes) {
      if (n.appointment_id) usedAppointmentIds.add(n.appointment_id)
    }
    const now = Date.now()
    const future = appointments
      .filter((a) => new Date(a.end_at).getTime() >= now)
      .sort(
        (x, y) =>
          new Date(x.start_at).getTime() - new Date(y.start_at).getTime(),
      )
    const next = future[0]
    if (!next) return null
    return usedAppointmentIds.has(next.id) ? null : next.id
  }, [mode, existingNote, initialAppointmentId, appointments, notes])

  const [appointmentId, setAppointmentId] = useState<string | null>(
    defaultAppointmentId,
  )

  // ---- Field values ------------------------------------------------------
  const [values, setValues] = useState<Record<string, string>>(() =>
    initialValuesFor(mode, defaultTemplateId, templates, existingNote),
  )

  // Track whether the user has edited any field — used by the parent
  // (NotesTab) to decide whether an in-progress create-note should be
  // saved before switching to edit a different note.
  const initialValuesRef = useRef(values)
  const dirtyRef = useRef(false)
  useEffect(() => {
    dirtyRef.current = false
    initialValuesRef.current = values
    // intentional: re-baselining only when the active template changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplate?.id])

  // Re-seed when the user picks a different template (create mode only —
  // edit mode shouldn't auto-overwrite the saved content if the user
  // experimentally swaps template).
  const seededTemplateRef = useRef<string | null>(defaultTemplateId)
  useEffect(() => {
    if (mode !== 'create') return
    if (!activeTemplate) {
      setValues({})
      seededTemplateRef.current = null
      return
    }
    if (seededTemplateRef.current === activeTemplate.id) return
    const next: Record<string, string> = {}
    for (const f of activeTemplate.fields) {
      next[f.id] = f.default_value ?? ''
    }
    setValues(next)
    seededTemplateRef.current = activeTemplate.id
  }, [activeTemplate, mode])

  // ---- In-note test capture ---------------------------------------------
  // Per brief §1.2 entry point #1, a clinical note can link to a test
  // session captured alongside the narrative. Exposed in create mode
  // only; edit mode preserves whatever link the note already has.
  const [testSessionId, setTestSessionId] = useState<string | null>(null)
  const [testCaptureSummary, setTestCaptureSummary] = useState<string | null>(
    null,
  )
  const [captureOpen, setCaptureOpen] = useState(false)

  // ---- Save / submit -----------------------------------------------------
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function setValue(fieldId: string, value: string) {
    if (value !== (initialValuesRef.current[fieldId] ?? '')) {
      dirtyRef.current = true
    }
    setValues((prev) => ({ ...prev, [fieldId]: value }))
  }

  async function performSave(): Promise<{ ok: boolean; error?: string }> {
    if (!activeTemplate) {
      const msg = 'Pick a template before saving.'
      setError(msg)
      return { ok: false, error: msg }
    }
    const fields: NoteFieldValue[] = activeTemplate.fields.map((f) => ({
      label: f.label,
      type: f.field_type,
      value: values[f.id] ?? '',
    }))

    if (mode === 'create') {
      const res = await createClinicalNoteAction({
        clientId,
        templateId: activeTemplate.id,
        appointmentId,
        fields,
        testSessionId,
      })
      if (res.error) {
        setError(res.error)
        return { ok: false, error: res.error }
      }
      return { ok: true }
    }
    if (!existingNote) {
      const msg = 'Note no longer exists.'
      setError(msg)
      return { ok: false, error: msg }
    }
    const res = await updateClinicalNoteAction({
      noteId: existingNote.id,
      templateId: activeTemplate.id,
      appointmentId,
      fields,
      version: existingNote.version,
    })
    if (res.error) {
      setError(res.error)
      return { ok: false, error: res.error }
    }
    return { ok: true }
  }

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const res = await performSave()
      if (res.ok) onSaved()
    })
  }

  // Map a copied note's field-by-label values onto the current template's
  // field ids. Used both by the main "Copy Previous Note" action and by
  // the side-rail copy-icon click.
  function applyCopiedFields(
    copied: ReadonlyArray<{ label: string; value: string }>,
  ) {
    if (!activeTemplate) return
    const byLabel = new Map<string, string>()
    for (const f of copied) byLabel.set(f.label, f.value)
    const next: Record<string, string> = {}
    for (const f of activeTemplate.fields) {
      next[f.id] = byLabel.get(f.label) ?? f.default_value ?? ''
    }
    setValues(next)
    dirtyRef.current = true
  }

  useImperativeHandle(
    ref,
    () => ({
      isDirty: () => dirtyRef.current,
      isUserDirty: () => dirtyRef.current,
      saveIfDirty: async () => {
        if (!dirtyRef.current) return { ok: true }
        return performSave()
      },
      getActiveTemplateId: () => activeTemplate?.id ?? null,
      applyCopy: (fields) => applyCopiedFields(fields),
    }),
    // performSave / applyCopiedFields close over latest state via refs;
    // intentional rebuild each render to keep the closures fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  )

  // ---- Copy Previous Note (create mode only) ----------------------------
  const mostRecentSameTemplate = useMemo(() => {
    if (mode !== 'create') return null
    if (!activeTemplate) return null
    const matching = notes
      .filter((n) => n.template_id === activeTemplate.id)
      .slice()
      .sort(
        (a, b) =>
          new Date(b.note_date).getTime() - new Date(a.note_date).getTime() ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
    return matching[0] ?? null
  }, [mode, activeTemplate, notes])

  function handleCopyMostRecent() {
    if (!mostRecentSameTemplate) return
    if (dirtyRef.current) {
      const ok = confirm(
        "You've started writing this note. Replace what you've typed with the copied note's contents?",
      )
      if (!ok) return
    }
    applyCopiedFields(mostRecentSameTemplate.content_json?.fields ?? [])
  }

  function handleToggleCopyMode() {
    if (copyMode) {
      onExitCopyMode()
    } else {
      onEnterCopyMode()
    }
  }

  // ---- Duplicate-prevention: one note per appointment -----------------
  // Build an appointment_id → note_id map. In edit mode, exclude the
  // note being edited so re-saving with its own appointment doesn't
  // register as a conflict.
  const noteByAppointmentId = useMemo(() => {
    const map = new Map<string, string>()
    for (const n of notes) {
      if (!n.appointment_id) continue
      if (mode === 'edit' && existingNote && n.id === existingNote.id) continue
      map.set(n.appointment_id, n.id)
    }
    return map
  }, [notes, mode, existingNote])

  const conflictingNoteId = appointmentId
    ? (noteByAppointmentId.get(appointmentId) ?? null)
    : null

  return (
    <div
      className="card"
      style={{
        padding: 0,
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        boxShadow: '0 4px 14px rgba(35, 31, 32, 0.06)',
      }}
    >
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            flex: 1,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.78rem',
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text)',
          }}
        >
          {mode === 'create' ? 'New note' : 'Edit note'}
        </div>
        {mode === 'create' && (
          <CopyPreviousNoteButton
            disabled={!mostRecentSameTemplate}
            disabledTooltip={
              activeTemplate
                ? `No previous notes use the "${activeTemplate.name}" template yet.`
                : 'Pick a template first.'
            }
            copyMode={copyMode}
            onCopyMostRecent={handleCopyMostRecent}
            onToggleSelectMode={handleToggleCopyMode}
          />
        )}
      </div>

      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--color-border-subtle)',
          display: 'flex',
          gap: 14,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <FormField label="Session" wide>
          <AppointmentPicker
            appointments={appointments}
            value={appointmentId}
            onChange={setAppointmentId}
            takenAppointmentIds={noteByAppointmentId}
          />
        </FormField>
        <FormField label="Template" wide>
          <select
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(e.target.value || null)}
            disabled={pending}
            style={selectStyle}
          >
            {templates.length === 0 && (
              <option value="" disabled>
                No templates — add one in Settings
              </option>
            )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      {conflictingNoteId && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 20px',
            background: 'rgba(214, 64, 69, 0.06)',
            borderBottom: '1px solid var(--color-border-subtle)',
            fontSize: '.8rem',
            color: 'var(--color-alert)',
            lineHeight: 1.4,
          }}
        >
          <span style={{ flex: 1 }}>
            This session already has a note.
          </span>
          <button
            type="button"
            onClick={() => onEditExistingNote(conflictingNoteId)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              fontFamily: 'inherit',
              fontSize: 'inherit',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            Edit existing note →
          </button>
        </div>
      )}

      {mode === 'create' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 20px',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: '.7rem',
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              fontWeight: 500,
              color: 'var(--color-muted)',
            }}
          >
            Test session
          </span>
          {testSessionId === null ? (
            <button
              type="button"
              className="btn outline"
              onClick={() => setCaptureOpen(true)}
              disabled={pending}
              style={{ fontSize: '.78rem', padding: '6px 12px' }}
            >
              <Plus size={13} aria-hidden /> Capture test session
            </button>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '.82rem',
                color: 'var(--color-text)',
              }}
            >
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--color-accent, #2e7d32)',
                }}
              />
              Captured · {testCaptureSummary ?? 'linked'}
              <button
                type="button"
                className="btn ghost"
                onClick={() => setCaptureOpen(true)}
                disabled={pending}
                style={{ fontSize: '.74rem', padding: '4px 8px' }}
              >
                Replace
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setTestSessionId(null)
                  setTestCaptureSummary(null)
                }}
                disabled={pending}
                style={{ fontSize: '.74rem', padding: '4px 8px' }}
              >
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      <div style={{ padding: '14px 20px 8px' }}>
        {!activeTemplate && (
          <div
            style={{
              padding: '20px 0',
              fontSize: '.86rem',
              color: 'var(--color-text-light)',
              textAlign: 'center',
            }}
          >
            Pick a template above. You can build new ones in Settings →
            Note templates.
          </div>
        )}
        {activeTemplate && activeTemplate.fields.length === 0 && (
          <div
            style={{
              padding: '20px 0',
              fontSize: '.86rem',
              color: 'var(--color-text-light)',
              textAlign: 'center',
            }}
          >
            This template has no fields yet — add some in Settings → Note
            templates.
          </div>
        )}
        {activeTemplate?.fields.map((f) => (
          <NoteFieldInput
            key={f.id}
            label={f.label}
            value={values[f.id] ?? ''}
            onChange={(v) => setValue(f.id, v)}
            disabled={pending}
          />
        ))}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: '8px 20px',
            fontSize: '.82rem',
            color: 'var(--color-alert)',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-surface)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 10,
        }}
      >
        <button
          type="button"
          className="btn outline"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={handleSubmit}
          disabled={pending || !activeTemplate || conflictingNoteId !== null}
          title={
            conflictingNoteId
              ? 'This session already has a note. Edit the existing note instead.'
              : undefined
          }
        >
          {pending ? 'Saving…' : mode === 'create' ? 'Save note' : 'Save changes'}
        </button>
      </div>

      {mode === 'create' && (
        <TestCaptureModal
          open={captureOpen}
          onClose={() => setCaptureOpen(false)}
          clientId={clientId}
          catalog={testCatalog}
          batteries={testBatteries}
          lastUsedBattery={lastUsedBattery}
          onCaptured={(sessionId, summary) => {
            setTestSessionId(sessionId)
            setTestCaptureSummary(summary)
          }}
        />
      )}
    </div>
  )
})

function initialValuesFor(
  mode: 'create' | 'edit',
  templateId: string | null,
  templates: ProfileNoteTemplate[],
  existingNote: ProfileNote | null,
): Record<string, string> {
  if (mode === 'edit' && existingNote) {
    // Best-effort: match content_json fields to template fields by label.
    // If the template has been edited since the note was written, fields
    // present on both sides line up; orphaned content stays inside
    // content_json but isn't editable here.
    const t = templates.find((x) => x.id === templateId)
    if (!t) return {}
    const byLabel = new Map<string, string>()
    for (const f of existingNote.content_json?.fields ?? []) {
      byLabel.set(f.label, f.value)
    }
    const init: Record<string, string> = {}
    for (const f of t.fields) {
      init[f.id] = byLabel.get(f.label) ?? f.default_value ?? ''
    }
    return init
  }
  if (!templateId) return {}
  const t = templates.find((x) => x.id === templateId)
  if (!t) return {}
  const init: Record<string, string> = {}
  for (const f of t.fields) init[f.id] = f.default_value ?? ''
  return init
}

/* ====================== Copy Previous Note (split button) ====================== */

/**
 * Two-part button: a main "Copy Previous Note" action that copies the
 * most recent same-template note, plus a chevron that flips the side
 * rail into select mode so the EP can pick any prior note. Disabled
 * (with tooltip) when no prior notes match the current template.
 */
function CopyPreviousNoteButton({
  disabled,
  disabledTooltip,
  copyMode,
  onCopyMostRecent,
  onToggleSelectMode,
}: {
  disabled: boolean
  disabledTooltip: string
  copyMode: boolean
  onCopyMostRecent: () => void
  onToggleSelectMode: () => void
}) {
  const baseColor = disabled
    ? 'var(--color-muted)'
    : copyMode
      ? 'var(--color-primary)'
      : 'var(--color-text)'
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        border: `1px solid ${
          copyMode ? 'var(--color-primary)' : 'var(--color-border-subtle)'
        }`,
        borderRadius: 7,
        background: 'var(--color-card)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onCopyMostRecent}
        disabled={disabled}
        title={disabled ? disabledTooltip : 'Copy the most recent note using this template'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 12px',
          background: 'transparent',
          border: 'none',
          borderRight: '1px solid var(--color-border-subtle)',
          fontSize: '.82rem',
          fontWeight: 600,
          fontFamily: 'inherit',
          color: baseColor,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Copy size={13} aria-hidden />
        Copy Previous Note
      </button>
      <button
        type="button"
        onClick={onToggleSelectMode}
        title="Select alternative day to copy"
        aria-label="Select alternative day to copy"
        aria-pressed={copyMode}
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: '0 8px',
          background: copyMode ? 'var(--color-surface-2)' : 'transparent',
          border: 'none',
          color: baseColor,
          cursor: 'pointer',
        }}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
    </div>
  )
}

/* ====================== Form helpers ====================== */

function FormField({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        flex: wide ? '1 1 220px' : undefined,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.66rem',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-light)',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const selectStyle: React.CSSProperties = {
  height: 34,
  padding: '0 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 7,
  background: 'var(--color-card)',
  fontSize: '.86rem',
  fontFamily: 'inherit',
  outline: 'none',
}

/**
 * Appointment picker.
 *
 * Layout (top → bottom):
 *   1. Next session     ← single row, the next future/in-progress appt
 *   2. None             ← "don't link this note to any appointment"
 *   3. Upcoming         ← optgroup, capped at appointments within 14 days
 *   4. Past             ← optgroup, capped at appointments within 14 days
 *
 * "Show more" toggle (rendered outside the dropdown, beneath it) uncaps
 * both groups so an EP can write a note for a session further out or
 * further back than two weeks.
 *
 * Bucketing uses `end_at >= now` so an appointment that's currently in
 * progress, or one that hasn't started yet, both count as upcoming. This
 * fixes the bug where "Mon 27 Apr · 1:00 pm" showed as Past when the
 * user opened the picker just before 1:00 pm.
 */
function AppointmentPicker({
  appointments,
  value,
  onChange,
  takenAppointmentIds,
}: {
  appointments: ProfileAppointment[]
  value: string | null
  onChange: (id: string | null) => void
  takenAppointmentIds: Map<string, string>
}) {
  const [showAll, setShowAll] = useState(false)

  const { nextSession, upcomingRest, past, hiddenCount } = useMemo(() => {
    const now = Date.now()
    const upcomingAll = appointments
      .filter((a) => new Date(a.end_at).getTime() >= now)
      .sort(
        (x, y) =>
          new Date(x.start_at).getTime() - new Date(y.start_at).getTime(),
      )
    const pastAll = appointments
      .filter((a) => new Date(a.end_at).getTime() < now)
      .sort(
        (x, y) =>
          new Date(y.start_at).getTime() - new Date(x.start_at).getTime(),
      )

    const nextSession = upcomingAll[0] ?? null
    const upcomingRestAll = upcomingAll.slice(1)

    if (showAll) {
      return {
        nextSession,
        upcomingRest: upcomingRestAll,
        past: pastAll,
        hiddenCount: 0,
      }
    }

    const upcomingCutoff = now + FOURTEEN_DAYS_MS
    const pastCutoff = now - FOURTEEN_DAYS_MS
    const upcomingCapped = upcomingRestAll.filter(
      (a) => new Date(a.start_at).getTime() <= upcomingCutoff,
    )
    const pastCapped = pastAll.filter(
      (a) => new Date(a.start_at).getTime() >= pastCutoff,
    )
    const hidden =
      upcomingRestAll.length -
      upcomingCapped.length +
      (pastAll.length - pastCapped.length)

    return {
      nextSession,
      upcomingRest: upcomingCapped,
      past: pastCapped,
      hiddenCount: hidden,
    }
  }, [appointments, showAll])

  function labelFor(a: ProfileAppointment): string {
    const base = formatAppointmentLabel(a)
    return takenAppointmentIds.has(a.id) ? `${base} · ✓ has note` : base
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        style={selectStyle}
      >
        {nextSession && (
          <option value={nextSession.id}>
            Next session · {labelFor(nextSession)}
          </option>
        )}
        <option value="">None — no linked session</option>
        {upcomingRest.length > 0 && (
          <optgroup label="Upcoming">
            {upcomingRest.map((a) => (
              <option key={a.id} value={a.id}>
                {labelFor(a)}
              </option>
            ))}
          </optgroup>
        )}
        {past.length > 0 && (
          <optgroup label="Past">
            {past.map((a) => (
              <option key={a.id} value={a.id}>
                {labelFor(a)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-light)',
            fontSize: '.74rem',
            textAlign: 'left',
            padding: 0,
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'inherit',
            alignSelf: 'flex-start',
          }}
        >
          Show {hiddenCount} more session{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

function formatAppointmentLabel(a: ProfileAppointment): string {
  const dt = new Date(a.start_at)
  const dateStr = new Intl.DateTimeFormat('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dt)
  const timeStr = new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(dt)
  return `${dateStr} · ${timeStr} · ${a.appointment_type}`
}

function NoteFieldInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: '.66rem',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-light)',
          display: 'block',
          marginBottom: 4,
        }}
      >
        {label}
      </label>
      <AutoTextarea
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={`${label.toLowerCase()}…`}
        minHeight={64}
        ariaLabel={label}
      />
    </div>
  )
}

/* =========================================================================
 * Side rail — three tabs, condensed list, click-to-expand
 * ========================================================================= */

function SideRail({
  clientId,
  tab,
  onTabChange,
  view,
  onView,
  notes,
  appointments,
  templates,
  reports,
  onStartEdit,
  copyMode,
  copyTemplateId,
  onCopyFromNote,
  onCancelCopy,
}: {
  clientId: string
  tab: SidebarTab
  onTabChange: (t: SidebarTab) => void
  view: SidebarView
  onView: (v: SidebarView) => void
  notes: ProfileNote[]
  appointments: ProfileAppointment[]
  templates: ProfileNoteTemplate[]
  reports: ProfileReport[]
  onStartEdit: (noteId: string) => void
  copyMode: boolean
  copyTemplateId: string | null
  onCopyFromNote: (noteId: string) => void
  onCancelCopy: () => void
}) {
  const copyTemplateName = copyTemplateId
    ? (templates.find((t) => t.id === copyTemplateId)?.name ?? null)
    : null
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: 'var(--color-surface)',
          padding: 3,
          borderRadius: 7,
          border: '1px solid var(--color-border-subtle)',
        }}
      >
        {(
          [
            ['previous', 'Previous'],
            ['reports', 'Reports'],
            ['files', 'Files'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onTabChange(k)}
            style={{
              flex: 1,
              padding: '7px 10px',
              border: 'none',
              borderRadius: 5,
              fontSize: '.78rem',
              fontWeight: 600,
              cursor: 'pointer',
              background: tab === k ? 'var(--color-card)' : 'transparent',
              color: tab === k ? 'var(--color-text)' : 'var(--color-text-light)',
              boxShadow: tab === k ? '0 1px 3px rgba(0,0,0,.06)' : 'none',
              fontFamily: 'inherit',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {copyMode && (
        <CopyModeBanner
          templateName={copyTemplateName}
          onCancel={onCancelCopy}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {tab === 'previous' && view.kind === 'list' && (
          <PreviousNotesList
            notes={notes}
            appointments={appointments}
            templates={templates}
            onOpen={(noteId) => onView({ kind: 'reading', noteId })}
            clientId={clientId}
            copyMode={copyMode}
            copyTemplateId={copyTemplateId}
            onCopyFromNote={onCopyFromNote}
          />
        )}
        {tab === 'previous' && view.kind === 'reading' && (
          <NoteReader
            note={notes.find((n) => n.id === view.noteId) ?? null}
            appointments={appointments}
            templates={templates}
            clientId={clientId}
            onBack={() => onView({ kind: 'list' })}
            onEdit={() => onStartEdit(view.noteId)}
          />
        )}
        {tab === 'reports' && (
          <div style={{ padding: 14 }}>
            <ReportsPanel reports={reports} />
          </div>
        )}
        {tab === 'files' && (
          <div style={{ padding: 14 }}>
            <FilesPanel />
          </div>
        )}
      </div>
    </div>
  )
}

function CopyModeBanner({
  templateName,
  onCancel,
}: {
  templateName: string | null
  onCancel: () => void
}) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px 8px 12px',
        background: 'rgba(45, 178, 76, 0.08)',
        border: '1px solid rgba(45, 178, 76, 0.35)',
        borderRadius: 7,
        fontSize: '.74rem',
        color: 'var(--color-text)',
        lineHeight: 1.4,
      }}
    >
      <Copy size={13} aria-hidden style={{ color: 'var(--color-accent)' }} />
      <div style={{ flex: 1 }}>
        Pick a note to copy
        {templateName ? (
          <>
            {' '}
            — only{' '}
            <strong style={{ fontWeight: 600 }}>{templateName}</strong> notes
            are eligible.
          </>
        ) : (
          '.'
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel copy"
        title="Cancel (Esc)"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 4,
          cursor: 'pointer',
          color: 'var(--color-text-light)',
          display: 'grid',
          placeItems: 'center',
          borderRadius: 4,
        }}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  )
}

/* ====================== Previous notes list ====================== */

function PreviousNotesList({
  notes,
  appointments,
  templates,
  onOpen,
  clientId,
  copyMode,
  copyTemplateId,
  onCopyFromNote,
}: {
  notes: ProfileNote[]
  appointments: ProfileAppointment[]
  templates: ProfileNoteTemplate[]
  onOpen: (noteId: string) => void
  clientId: string
  copyMode: boolean
  copyTemplateId: string | null
  onCopyFromNote: (noteId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)

  // Reset to page 0 whenever the search query changes — otherwise a query
  // that yields fewer pages than `page` would land on a blank slice.
  useEffect(() => {
    setPage(0)
  }, [query])

  // Filter then split into pinned vs unpinned. Search is case-insensitive
  // and matches across content_json field labels + values plus the legacy
  // SOAP columns. Pinned notes that don't match are hidden during search
  // (matches honour the "see only what matches" mental model).
  const { pinned, unpinned } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? notes.filter((n) => noteMatchesQuery(n, q))
      : notes
    const pinned: ProfileNote[] = []
    const unpinned: ProfileNote[] = []
    for (const n of filtered) (n.is_pinned ? pinned : unpinned).push(n)
    const cmp = (a: ProfileNote, b: ProfileNote) =>
      new Date(b.note_date).getTime() - new Date(a.note_date).getTime() ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    pinned.sort(cmp)
    unpinned.sort(cmp)
    return { pinned, unpinned }
  }, [notes, query])

  const pageCount = Math.max(1, Math.ceil(unpinned.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const slice = unpinned.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  )

  const noNotesAtAll = notes.length === 0
  const noMatches = !noNotesAtAll && pinned.length === 0 && unpinned.length === 0

  return (
    <div>
      {!noNotesAtAll && (
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-card)',
          }}
        >
          <div style={{ position: 'relative' }}>
            <Search
              size={13}
              aria-hidden
              style={{
                position: 'absolute',
                left: 9,
                top: 9,
                color: 'var(--color-text-light)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
              style={{
                width: '100%',
                height: 30,
                padding: '0 28px 0 28px',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 6,
                background: 'var(--color-surface)',
                fontSize: '.8rem',
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                style={{
                  position: 'absolute',
                  right: 4,
                  top: 4,
                  width: 22,
                  height: 22,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-light)',
                  cursor: 'pointer',
                  borderRadius: 3,
                }}
              >
                <X size={12} aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}

      {noNotesAtAll ? (
        <div
          style={{
            padding: 14,
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.55,
          }}
        >
          No prior notes for this client. Notes you save will land here for
          quick reference.
        </div>
      ) : noMatches ? (
        <div
          style={{
            padding: '14px',
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
          }}
        >
          No notes match &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <>
          {pinned.length > 0 && (
            <div
              style={{
                background: 'var(--color-surface)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <SidebarHeader>Pinned</SidebarHeader>
              {pinned.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  appointments={appointments}
                  templates={templates}
                  onOpen={() => onOpen(n.id)}
                  clientId={clientId}
                  copyMode={copyMode}
                  copyEligible={copyMode && n.template_id === copyTemplateId}
                  onCopy={() => onCopyFromNote(n.id)}
                />
              ))}
            </div>
          )}
          <div>
            {slice.length === 0 ? (
              <div
                style={{
                  padding: '12px 14px',
                  fontSize: '.78rem',
                  color: 'var(--color-text-light)',
                }}
              >
                All visible notes are pinned.
              </div>
            ) : (
              slice.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  appointments={appointments}
                  templates={templates}
                  onOpen={() => onOpen(n.id)}
                  clientId={clientId}
                  copyMode={copyMode}
                  copyEligible={copyMode && n.template_id === copyTemplateId}
                  onCopy={() => onCopyFromNote(n.id)}
                />
              ))
            )}
            {pageCount > 1 && (
              <Pagination
                page={safePage}
                pageCount={pageCount}
                onChange={setPage}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Case-insensitive note-content match. Searches across content_json
 * field labels + values, plus the legacy SOAP columns the page loader
 * selects (body_rich + subjective + title) so pre-template notes are
 * still findable.
 */
function noteMatchesQuery(n: ProfileNote, q: string): boolean {
  const fields = n.content_json?.fields ?? []
  for (const f of fields) {
    if (f.label.toLowerCase().includes(q)) return true
    if (f.value.toLowerCase().includes(q)) return true
  }
  if (n.body_rich?.toLowerCase().includes(q)) return true
  if (n.subjective?.toLowerCase().includes(q)) return true
  if (n.title?.toLowerCase().includes(q)) return true
  return false
}

function NoteRow({
  note,
  appointments,
  templates,
  onOpen,
  clientId,
  copyMode,
  copyEligible,
  onCopy,
}: {
  note: ProfileNote
  appointments: ProfileAppointment[]
  templates: ProfileNoteTemplate[]
  onOpen: () => void
  clientId: string
  copyMode: boolean
  copyEligible: boolean
  onCopy: () => void
}) {
  const linked = note.appointment_id
    ? appointments.find((a) => a.id === note.appointment_id)
    : null
  const date = linked
    ? formatSessionDate(linked.start_at)
    : formatDate(note.note_date)
  const templateName = note.template_id
    ? (templates.find((t) => t.id === note.template_id)?.name ?? null)
    : null
  // Notes that don't match the current template are visible but dimmed
  // during select mode so the EP can see why they aren't copyable.
  const dimmed = copyMode && !copyEligible

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 4,
        borderBottom: '1px solid var(--color-border-subtle)',
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          padding: '10px 4px 10px 14px',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'inherit',
          fontFamily: 'inherit',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            rowGap: 4,
            fontSize: '.8rem',
            fontWeight: 600,
            color: 'var(--color-text)',
            marginBottom: 2,
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>{date}</span>
          {templateName && (
            <span
              style={{
                fontSize: '.66rem',
                fontWeight: 600,
                color: 'var(--color-text-light)',
                background: 'var(--color-surface-2)',
                padding: '1px 6px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
            >
              {templateName}
            </span>
          )}
        </div>
      </button>
      {copyMode ? (
        copyEligible ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCopy()
            }}
            aria-label="Copy this note's contents into the form"
            title="Copy this note"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '12px 10px',
              cursor: 'pointer',
              color: 'var(--color-accent)',
            }}
          >
            <Copy size={14} aria-hidden />
          </button>
        ) : (
          <span
            aria-hidden
            style={{
              padding: '12px 10px',
              fontSize: '.62rem',
              color: 'var(--color-muted)',
            }}
          >
            —
          </span>
        )
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <ArchiveButton note={note} />
          <PinToggle note={note} clientId={clientId} />
        </div>
      )}
    </div>
  )
}

function ArchiveButton({ note }: { note: ProfileNote }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function handleArchive(e: React.MouseEvent) {
    e.stopPropagation()
    if (
      !confirm(
        "Archive this note? It'll be hidden from the timeline but stays in the database for compliance.",
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await archiveClinicalNoteAction(note.id)
      if (res.error) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleArchive}
      disabled={pending}
      aria-label="Archive note"
      title="Archive"
      style={{
        background: 'transparent',
        border: 'none',
        padding: '12px 6px',
        cursor: pending ? 'wait' : 'pointer',
        color: 'var(--color-text-light)',
        opacity: pending ? 0.5 : 1,
      }}
    >
      <Archive size={13} aria-hidden />
    </button>
  )
}

function PinToggle({
  note,
  clientId,
}: {
  note: ProfileNote
  clientId: string
}) {
  const [pending, startTransition] = useTransition()
  const [pinned, setPinned] = useState(note.is_pinned)
  const router = useRouter()

  // Keep local optimistic state in sync if the prop changes underneath.
  useEffect(() => {
    setPinned(note.is_pinned)
  }, [note.is_pinned])

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    const next = !pinned
    setPinned(next) // optimistic
    startTransition(async () => {
      const res = await toggleClinicalNotePinAction(note.id, next)
      if (res.error) {
        setPinned(!next) // revert
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  // Suppress unused-var warning for clientId (kept for future server-action call hooks)
  void clientId

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={pending}
      aria-label={pinned ? 'Unpin note' : 'Pin note'}
      title={pinned ? 'Unpin' : 'Pin to top'}
      style={{
        background: 'transparent',
        border: 'none',
        padding: '12px 10px',
        cursor: pending ? 'wait' : 'pointer',
        color: pinned ? 'var(--color-alert)' : 'var(--color-text-light)',
        opacity: pending ? 0.5 : 1,
      }}
    >
      {pinned ? <Pin size={13} aria-hidden /> : <PinOff size={13} aria-hidden />}
    </button>
  )
}

function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number
  pageCount: number
  onChange: (next: number) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-surface)',
      }}
    >
      <button
        type="button"
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        style={pagerButtonStyle(page === 0)}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} aria-hidden />
      </button>
      <span style={{ fontSize: '.74rem', color: 'var(--color-text-light)' }}>
        Page {page + 1} of {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(pageCount - 1, page + 1))}
        disabled={page >= pageCount - 1}
        style={pagerButtonStyle(page >= pageCount - 1)}
        aria-label="Next page"
      >
        <ChevronRight size={14} aria-hidden />
      </button>
    </div>
  )
}

function pagerButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? 'var(--color-muted)' : 'var(--color-text-light)',
    display: 'grid',
    placeItems: 'center',
    borderRadius: 4,
  }
}

/* ====================== Note reader (expanded view) ====================== */

function NoteReader({
  note,
  appointments,
  templates,
  clientId,
  onBack,
  onEdit,
}: {
  note: ProfileNote | null
  appointments: ProfileAppointment[]
  templates: ProfileNoteTemplate[]
  clientId: string
  onBack: () => void
  onEdit: () => void
}) {
  if (!note) {
    return (
      <div style={{ padding: 14 }}>
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
          }}
        >
          That note is no longer available. <button
            type="button"
            onClick={onBack}
            style={inlineLinkStyle}
          >
            Back to list
          </button>
        </div>
      </div>
    )
  }

  const linked = note.appointment_id
    ? appointments.find((a) => a.id === note.appointment_id)
    : null
  const date = linked
    ? formatSessionDate(linked.start_at)
    : formatDate(note.note_date)
  const templateName = note.template_id
    ? (templates.find((t) => t.id === note.template_id)?.name ?? null)
    : null

  const fields = note.content_json?.fields?.filter((f) => f.value) ?? []
  const legacyBody =
    fields.length === 0
      ? (note.body_rich?.trim() || note.subjective?.trim() || '')
      : ''

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          borderBottom: '1px solid var(--color-border-subtle)',
          background: 'var(--color-surface)',
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to list"
          style={{
            background: 'transparent',
            border: 'none',
            padding: 4,
            cursor: 'pointer',
            color: 'var(--color-text-light)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <ArrowLeft size={14} aria-hidden />
        </button>
        <div
          style={{
            flex: 1,
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '.8rem',
            color: 'var(--color-text)',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {date}
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit note"
          title="Edit"
          style={iconButtonStyle}
        >
          <Edit3 size={13} aria-hidden />
        </button>
        <a
          href={`/clients/${clientId}/notes/${note.id}/print`}
          target="_blank"
          rel="noreferrer"
          aria-label="Export as PDF"
          title="Export as PDF (browser print dialog)"
          style={iconButtonStyle}
        >
          <Printer size={13} aria-hidden />
        </a>
      </div>

      <div
        style={{
          padding: 14,
          maxHeight: 480,
          overflowY: 'auto',
        }}
      >
        {(templateName || linked) && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            {templateName && <span className="tag muted">{templateName}</span>}
            {linked && (
              <span
                style={{
                  fontSize: '.7rem',
                  color: 'var(--color-text-light)',
                }}
              >
                {linked.appointment_type}
              </span>
            )}
          </div>
        )}

        {fields.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {fields.map((f, idx) => (
              <div key={idx}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '.62rem',
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-light)',
                    marginBottom: 2,
                  }}
                >
                  {f.label}
                </div>
                <div
                  style={{
                    fontSize: '.84rem',
                    color: 'var(--color-text)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                  }}
                >
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              fontSize: '.84rem',
              color: 'var(--color-text)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.6,
            }}
          >
            {legacyBody || (
              <span style={{ color: 'var(--color-muted)' }}>(empty note)</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 4,
  cursor: 'pointer',
  color: 'var(--color-text-light)',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 4,
  textDecoration: 'none',
}

const inlineLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--color-primary)',
  textDecoration: 'underline',
  cursor: 'pointer',
  padding: 0,
  font: 'inherit',
}

/* ====================== Reports / Files placeholders ====================== */

function ReportsPanel({ reports }: { reports: ProfileReport[] }) {
  if (reports.length === 0) {
    return (
      <div
        style={{
          fontSize: '.82rem',
          color: 'var(--color-text-light)',
          lineHeight: 1.55,
        }}
      >
        No reports filed for this client yet. Force-plate profiles,
        ForceFrame results, and movement reassessments will land here once
        the assessment module is wired.
      </div>
    )
  }
  return (
    <div>
      <SidebarHeader>Reports</SidebarHeader>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 380,
          overflowY: 'auto',
        }}
      >
        {reports.map((r) => (
          <button
            key={r.id}
            type="button"
            disabled
            title="Report viewing wires in with the reports module"
            style={{
              background: 'transparent',
              border: 'none',
              borderTop: '1px solid var(--color-border-subtle)',
              padding: '8px 4px',
              textAlign: 'left',
              cursor: 'not-allowed',
              opacity: 0.85,
              color: 'inherit',
              fontFamily: 'inherit',
            }}
          >
            <div
              style={{
                fontSize: '.8rem',
                fontWeight: 600,
                color: 'var(--color-text)',
              }}
            >
              {r.title}
            </div>
            <div
              style={{
                fontSize: '.72rem',
                color: 'var(--color-text-light)',
                marginTop: 2,
              }}
            >
              {formatDate(r.test_date)} · {r.report_type}
              {!r.is_published && ' · Draft'}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function FilesPanel() {
  return (
    <div>
      <SidebarHeader>Files</SidebarHeader>
      <div
        style={{
          padding: '12px 0',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 9,
            background: 'var(--color-surface)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--color-text-light)',
            margin: '0 auto 10px',
          }}
        >
          <FileText size={18} aria-hidden />
        </div>
        <div
          style={{
            fontSize: '.82rem',
            color: 'var(--color-text-light)',
            lineHeight: 1.5,
          }}
        >
          No files yet. Specialist letters, scan reports, and referrer
          letters will live here so you can pull them up while writing
          notes — clicking a PDF opens in a new tab; other files download.
        </div>
      </div>
    </div>
  )
}

function SidebarHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: '.62rem',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: 'var(--color-text-light)',
        padding: '8px 14px 4px',
      }}
    >
      {children}
    </div>
  )
}

/* =========================================================================
 * Helpers
 * ========================================================================= */

function formatDate(dateIso: string): string {
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

function formatSessionDate(iso: string): string {
  try {
    const dt = new Date(iso)
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(dt)
  } catch {
    return iso
  }
}

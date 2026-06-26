'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  MoreVertical,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  SaveStatusContext,
  SaveStatusPill,
  useSaveStatus,
} from '@/app/(staff)/library/_components/editor-kit'
import {
  DayContentEditor,
  type DayEditorActions,
  type DayEditorExercise,
  type MetricUnitOption,
  type SectionTitleOption,
} from '@/app/(staff)/library/_components/DayContentEditor'
import type { LibraryExercise } from '@/app/(staff)/library/types'
import { ConfirmDialog } from '@/app/(staff)/_components/ConfirmDialog'
import { renameProgramTemplateAction } from '@/app/(staff)/library/program-template-actions'
import { addSessionSectionTitleAction } from '@/app/(staff)/library/session-actions'
import {
  addTemplateDayAction,
  addTemplateExerciseAction,
  addTemplateSetAction,
  deleteTemplateDayAction,
  duplicateTemplateDayAction,
  groupTemplateAcrossAction,
  moveTemplateDayAction,
  moveTemplateExerciseAction,
  removeTemplateExerciseAction,
  removeTemplateSetAction,
  renameTemplateDayAction,
  reorderTemplateExercisesAction,
  ungroupTemplateExerciseAction,
  updateTemplateExerciseAction,
  updateTemplateMetricAction,
  updateTemplateRepMetricAction,
  updateTemplateSectionTitleAction,
  updateTemplateSetAction,
} from '@/app/(staff)/library/program-template-editor-actions'

/*
 * In-Library PROGRAM-TEMPLATE editor (P-1, edit-existing v1). Owns the
 * SaveStatus provider + the name header; renders the template as weeks → days,
 * and expands ONE day at a time into the shared DayContentEditor (one library
 * panel at a time). Day management (rename / reorder / add / remove / duplicate)
 * lives on the day rows + week footers. Week add/remove is out of scope (v1).
 */

export type EditorTplDay = {
  id: string
  day_label: string
  exercises: DayEditorExercise[]
}
export type EditorTplWeek = {
  id: string
  week_number: number
  days: EditorTplDay[]
}
export type EditorTemplate = {
  id: string
  name: string
  weeks: EditorTplWeek[]
}

const fieldStyle: React.CSSProperties = {
  height: 40,
  padding: '0 10px',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-input)',
  background: 'var(--color-surface)',
  fontFamily: 'var(--font-sans)',
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--color-text)',
  outline: 'none',
  width: '100%',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-display)',
  fontSize: '.66rem',
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--color-muted)',
  marginBottom: 5,
}

export function ProgramEditor({
  template,
  library,
  movementPatterns,
  exerciseTags,
  metricUnits,
  sectionTitles,
}: {
  template: EditorTemplate
  library: LibraryExercise[]
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  metricUnits: MetricUnitOption[]
  sectionTitles: SectionTitleOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [nameError, setNameError] = useState<string | null>(null)
  const [expandedDayId, setExpandedDayId] = useState<string | null>(null)
  const { value: saveValue, run } = useSaveStatus()

  function saveName(value: string) {
    const name = value.trim()
    if (name === template.name) return
    startTransition(async () => {
      const res = await run(renameProgramTemplateAction(template.id, name))
      if (res.error) setNameError(res.error)
      else {
        setNameError(null)
        router.refresh()
      }
    })
  }

  // DayEditorActions for one template day, closing over the template id (for
  // revalidation) + the day id. addSectionTitle reuses the org-level action.
  function dayActionsFor(dayId: string): DayEditorActions {
    return {
      addExercise: (exId, slot) => addTemplateExerciseAction(template.id, dayId, exId, slot),
      removeExercise: (exId) => removeTemplateExerciseAction(template.id, exId),
      moveExercise: (exId, dir) => moveTemplateExerciseAction(template.id, dayId, exId, dir),
      reorderExercises: (ids, moved) =>
        reorderTemplateExercisesAction(template.id, dayId, ids, moved),
      groupAcross: (b, a) => groupTemplateAcrossAction(template.id, dayId, b, a),
      ungroup: (exId) => ungroupTemplateExerciseAction(template.id, exId),
      updateExercise: (exId, patch) => updateTemplateExerciseAction(template.id, exId, patch),
      updateSet: (setId, patch) => updateTemplateSetAction(template.id, setId, patch),
      addSet: (exId) => addTemplateSetAction(template.id, exId),
      removeSet: (setId) => removeTemplateSetAction(template.id, setId),
      updateRepMetric: (exId, next) => updateTemplateRepMetricAction(template.id, exId, next),
      updateMetric: (exId, next) => updateTemplateMetricAction(template.id, exId, next),
      updateSectionTitle: (exId, next) =>
        updateTemplateSectionTitleAction(template.id, exId, next),
      addSectionTitle: (name) => addSessionSectionTitleAction(name),
    }
  }

  return (
    <SaveStatusContext.Provider value={saveValue}>
      <div style={{ display: 'grid', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              href="/library"
              aria-label="Back to library"
              style={{
                color: 'var(--color-text-light)',
                padding: 6,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <ArrowLeft size={18} aria-hidden />
            </Link>
            <div className="eyebrow" style={{ marginBottom: 0 }}>
              Program template · editing
            </div>
          </div>
          <SaveStatusPill />
        </div>

        <div style={{ maxWidth: 420 }}>
          <label style={labelStyle}>Name</label>
          <input
            defaultValue={template.name}
            onBlur={(e) => saveName(e.target.value)}
            placeholder="Template name"
            style={fieldStyle}
          />
          {nameError && (
            <div role="alert" style={{ marginTop: 6, fontSize: '.78rem', color: 'var(--color-alert)' }}>
              {nameError}
            </div>
          )}
        </div>

        {template.weeks.length === 0 ? (
          <EmptyTemplate />
        ) : (
          template.weeks.map((week) => (
            <WeekSection
              key={week.id}
              templateId={template.id}
              week={week}
              expandedDayId={expandedDayId}
              setExpandedDayId={setExpandedDayId}
              dayActionsFor={dayActionsFor}
              library={library}
              movementPatterns={movementPatterns}
              exerciseTags={exerciseTags}
              metricUnits={metricUnits}
              sectionTitles={sectionTitles}
            />
          ))
        )}
      </div>
    </SaveStatusContext.Provider>
  )
}

function EmptyTemplate() {
  return (
    <div
      className="card"
      style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--color-text-light)' }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: '1.1rem',
          color: 'var(--color-charcoal)',
          marginBottom: 4,
        }}
      >
        This template has no weeks yet
      </div>
      <p style={{ fontSize: '.86rem', lineHeight: 1.55, margin: '0 auto', maxWidth: 420 }}>
        Templates are saved from a real program (the calendar&rsquo;s{' '}
        <strong style={{ color: 'var(--color-text)' }}>Save as template</strong>), which
        carries their week structure. Editing weeks from scratch isn&rsquo;t available yet.
      </p>
    </div>
  )
}

function WeekSection({
  templateId,
  week,
  expandedDayId,
  setExpandedDayId,
  dayActionsFor,
  library,
  movementPatterns,
  exerciseTags,
  metricUnits,
  sectionTitles,
}: {
  templateId: string
  week: EditorTplWeek
  expandedDayId: string | null
  setExpandedDayId: (id: string | null) => void
  dayActionsFor: (dayId: string) => DayEditorActions
  library: LibraryExercise[]
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  metricUnits: MetricUnitOption[]
  sectionTitles: SectionTitleOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleAddDay() {
    const label = newLabel.trim()
    if (!label) {
      setError('Give the day a name.')
      return
    }
    setError(null)
    startTransition(async () => {
      const res = await addTemplateDayAction(templateId, week.id, label)
      if (res.error) setError(res.error)
      else {
        setNewLabel('')
        setAdding(false)
        router.refresh()
      }
    })
  }

  return (
    <section style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--color-text-light)',
        }}
      >
        Week {week.week_number}
      </div>

      {week.days.map((day, idx) => (
        <DayRow
          key={day.id}
          templateId={templateId}
          weekId={week.id}
          day={day}
          isFirst={idx === 0}
          isLast={idx === week.days.length - 1}
          expanded={expandedDayId === day.id}
          onToggle={() => setExpandedDayId(expandedDayId === day.id ? null : day.id)}
          dayActionsFor={dayActionsFor}
          library={library}
          movementPatterns={movementPatterns}
          exerciseTags={exerciseTags}
          metricUnits={metricUnits}
          sectionTitles={sectionTitles}
        />
      ))}

      {adding ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 2 }}>
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddDay()
              if (e.key === 'Escape') {
                setAdding(false)
                setNewLabel('')
                setError(null)
              }
            }}
            placeholder="e.g. Day C — Conditioning"
            style={{ ...fieldStyle, height: 34, fontSize: '.86rem', fontWeight: 500, maxWidth: 280 }}
          />
          <button type="button" className="btn primary" onClick={handleAddDay} disabled={pending}>
            Add
          </button>
          <button
            type="button"
            className="btn outline"
            onClick={() => {
              setAdding(false)
              setNewLabel('')
              setError(null)
            }}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null)
            setAdding(true)
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            background: 'none',
            border: '1px dashed var(--color-border-subtle)',
            borderRadius: 'var(--radius-button)',
            padding: '7px 12px',
            color: 'var(--color-text-light)',
            fontSize: '.82rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Plus size={14} aria-hidden />
          Add day
        </button>
      )}

      {error && (
        <div role="alert" style={{ fontSize: '.78rem', color: 'var(--color-alert)', paddingLeft: 2 }}>
          {error}
        </div>
      )}
    </section>
  )
}

function DayRow({
  templateId,
  weekId,
  day,
  isFirst,
  isLast,
  expanded,
  onToggle,
  dayActionsFor,
  library,
  movementPatterns,
  exerciseTags,
  metricUnits,
  sectionTitles,
}: {
  templateId: string
  weekId: string
  day: EditorTplDay
  isFirst: boolean
  isLast: boolean
  expanded: boolean
  onToggle: () => void
  dayActionsFor: (dayId: string) => DayEditorActions
  library: LibraryExercise[]
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  metricUnits: MetricUnitOption[]
  sectionTitles: SectionTitleOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [label, setLabel] = useState(day.day_label)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const liveGroups = new Set(
    day.exercises.map((e) => e.superset_group_id).filter((g): g is string => g !== null),
  )
  const summary = `${day.exercises.length} ${day.exercises.length === 1 ? 'exercise' : 'exercises'}${
    liveGroups.size > 0 ? ` · ${liveGroups.size} ${liveGroups.size === 1 ? 'superset' : 'supersets'}` : ''
  }`

  function run<T extends { error: string | null }>(p: Promise<T>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      const res = await p
      if (res.error) setError(res.error)
      else {
        onOk?.()
        router.refresh()
      }
    })
  }

  function handleRename() {
    const trimmed = label.trim()
    if (trimmed === day.day_label) {
      setRenaming(false)
      return
    }
    run(renameTemplateDayAction(templateId, day.id, trimmed), () => setRenaming(false))
  }

  // On-system confirm (shared ConfirmDialog) in place of browser confirm();
  // a delete failure shows inside the dialog so the EP can retry.
  function runDelete() {
    setDeleteError(null)
    startTransition(async () => {
      const res = await deleteTemplateDayAction(templateId, day.id)
      if (res.error) {
        setDeleteError(res.error)
        return
      }
      if (expanded) onToggle()
      setConfirmDelete(false)
      router.refresh()
    })
  }

  return (
    <div
      className="card"
      style={{ padding: '12px 14px', display: 'grid', gap: expanded ? 14 : 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-label={expanded ? 'Collapse day' : 'Expand day'}
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-light)',
            display: 'grid',
            placeItems: 'center',
            padding: 2,
          }}
        >
          {expanded ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') {
                    setLabel(day.day_label)
                    setRenaming(false)
                  }
                }}
                style={{
                  ...fieldStyle,
                  height: 30,
                  fontSize: '.9rem',
                  fontWeight: 600,
                  maxWidth: 260,
                }}
              />
              <DayIconButton label="Save name" onClick={handleRename} disabled={pending}>
                <Check size={15} aria-hidden />
              </DayIconButton>
              <DayIconButton
                label="Cancel rename"
                onClick={() => {
                  setLabel(day.day_label)
                  setRenaming(false)
                  setError(null)
                }}
              >
                <X size={15} aria-hidden />
              </DayIconButton>
            </div>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              style={{
                display: 'block',
                textAlign: 'left',
                border: 'none',
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: '.98rem',
                color: 'var(--color-charcoal)',
                overflowWrap: 'anywhere',
              }}
            >
              {day.day_label}
            </button>
          )}
          {!renaming && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 2 }}>
              {summary}
            </div>
          )}
        </div>

        {!renaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <DayIconButton label="Move day up" onClick={() => run(moveTemplateDayAction(templateId, weekId, day.id, 'up'))} disabled={isFirst || pending}>
              <ArrowUp size={15} aria-hidden />
            </DayIconButton>
            <DayIconButton label="Move day down" onClick={() => run(moveTemplateDayAction(templateId, weekId, day.id, 'down'))} disabled={isLast || pending}>
              <ArrowDown size={15} aria-hidden />
            </DayIconButton>
            <div style={{ position: 'relative' }}>
              <DayIconButton label="Day actions" onClick={() => setMenuOpen((o) => !o)}>
                <MoreVertical size={16} aria-hidden />
              </DayIconButton>
              {menuOpen && (
                <>
                  <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      right: 0,
                      marginTop: 4,
                      zIndex: 11,
                      minWidth: 150,
                      background: 'var(--color-card)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-card-dense)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                      overflow: 'hidden',
                    }}
                  >
                    <DayMenuItem
                      icon={<Copy size={14} aria-hidden />}
                      onClick={() => {
                        setMenuOpen(false)
                        run(duplicateTemplateDayAction(templateId, day.id))
                      }}
                    >
                      Duplicate day
                    </DayMenuItem>
                    <DayMenuItem
                      icon={<Trash2 size={14} aria-hidden />}
                      danger
                      onClick={() => {
                        setMenuOpen(false)
                        setDeleteError(null)
                        setConfirmDelete(true)
                      }}
                    >
                      Delete day
                    </DayMenuItem>
                  </div>
                </>
              )}
            </div>
            <button
              type="button"
              className="btn outline"
              onClick={onToggle}
              style={{ marginLeft: 4, padding: '5px 12px', fontSize: '.8rem' }}
            >
              {expanded ? 'Done' : 'Edit'}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: '.78rem', color: 'var(--color-alert)' }}>
          {error}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete day?"
          body={
            <>Delete “{day.day_label}” and its exercises from this template?</>
          }
          confirmLabel="Delete"
          busy={pending}
          error={deleteError}
          onCancel={() => {
            if (pending) return
            setConfirmDelete(false)
            setDeleteError(null)
          }}
          onConfirm={runDelete}
        />
      )}

      {expanded && (
        <DayContentEditor
          exercises={day.exercises}
          library={library}
          movementPatterns={movementPatterns}
          exerciseTags={exerciseTags}
          metricUnits={metricUnits}
          sectionTitles={sectionTitles}
          actions={dayActionsFor(day.id)}
        />
      )}
    </div>
  )
}

function DayIconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 30,
        height: 30,
        border: 'none',
        background: 'none',
        borderRadius: 'var(--radius-button)',
        color: disabled ? 'var(--color-border-subtle)' : 'var(--color-text-light)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function DayMenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        width: '100%',
        textAlign: 'left',
        padding: '9px 12px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: '.84rem',
        fontWeight: 500,
        color: danger ? 'var(--color-alert)' : 'var(--color-text)',
      }}
    >
      <span style={{ color: danger ? 'var(--color-alert)' : 'var(--color-text-light)', display: 'grid', placeItems: 'center' }}>
        {icon}
      </span>
      {children}
    </button>
  )
}

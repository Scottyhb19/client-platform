'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
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
import {
  addSessionExerciseAction,
  addSessionSectionTitleAction,
  addSessionSetAction,
  groupSessionAcrossAction,
  moveSessionExerciseAction,
  removeSessionExerciseAction,
  removeSessionSetAction,
  renameSessionAction,
  reorderSessionExercisesAction,
  ungroupSessionExerciseAction,
  updateSessionExerciseAction,
  updateSessionMetricAction,
  updateSessionRepMetricAction,
  updateSessionSectionTitleAction,
  updateSessionSetAction,
} from '@/app/(staff)/library/session-actions'

/*
 * In-Library SESSION editor (S-5). Owns the SaveStatus provider + the name
 * header (so the pill reflects card edits too), and renders the shared
 * DayContentEditor (the cloned grouping engine) wired to the session server
 * actions via a DayEditorActions object closing over this session's id.
 */

export type EditorSession = {
  id: string
  name: string
  exercises: DayEditorExercise[]
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

export function SessionEditor({
  session,
  library,
  movementPatterns,
  exerciseTags,
  metricUnits,
  sectionTitles,
}: {
  session: EditorSession
  library: LibraryExercise[]
  movementPatterns: { id: string; name: string }[]
  exerciseTags: { id: string; name: string }[]
  metricUnits: MetricUnitOption[]
  sectionTitles: SectionTitleOption[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [nameError, setNameError] = useState<string | null>(null)
  const { value: saveValue, run } = useSaveStatus()

  function saveName(value: string) {
    const name = value.trim()
    if (name === session.name) return
    startTransition(async () => {
      const res = await run(renameSessionAction(session.id, name))
      if (res.error) setNameError(res.error)
      else {
        setNameError(null)
        router.refresh()
      }
    })
  }

  // The DayContentEditor's mutation contract, each call closing over this
  // session's id. The action signatures already return the kit's SaveResult.
  const actions = useMemo<DayEditorActions>(
    () => ({
      addExercise: (exerciseId, slot) =>
        addSessionExerciseAction(session.id, exerciseId, slot),
      removeExercise: (exerciseId) =>
        removeSessionExerciseAction(session.id, exerciseId),
      moveExercise: (exerciseId, direction) =>
        moveSessionExerciseAction(session.id, exerciseId, direction),
      reorderExercises: (orderedIds, movedId) =>
        reorderSessionExercisesAction(session.id, orderedIds, movedId),
      groupAcross: (beforeId, afterId) =>
        groupSessionAcrossAction(session.id, beforeId, afterId),
      ungroup: (exerciseId) =>
        ungroupSessionExerciseAction(session.id, exerciseId),
      updateExercise: (exerciseId, patch) =>
        updateSessionExerciseAction(session.id, exerciseId, patch),
      updateSet: (setId, patch) =>
        updateSessionSetAction(session.id, setId, patch),
      addSet: (exerciseId) => addSessionSetAction(session.id, exerciseId),
      removeSet: (setId) => removeSessionSetAction(session.id, setId),
      updateRepMetric: (exerciseId, next) =>
        updateSessionRepMetricAction(session.id, exerciseId, next),
      updateMetric: (exerciseId, next) =>
        updateSessionMetricAction(session.id, exerciseId, next),
      updateSectionTitle: (exerciseId, next) =>
        updateSessionSectionTitleAction(session.id, exerciseId, next),
      addSectionTitle: (name) => addSessionSectionTitleAction(name),
    }),
    [session.id],
  )

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
              Session · editing
            </div>
          </div>
          <SaveStatusPill />
        </div>

        <div style={{ maxWidth: 420 }}>
          <label style={labelStyle}>Name</label>
          <input
            defaultValue={session.name}
            onBlur={(e) => saveName(e.target.value)}
            placeholder="Session name"
            style={fieldStyle}
          />
          {nameError && (
            <div
              role="alert"
              style={{
                marginTop: 6,
                fontSize: '.78rem',
                color: 'var(--color-alert)',
              }}
            >
              {nameError}
            </div>
          )}
        </div>

        <DayContentEditor
          exercises={session.exercises}
          library={library}
          movementPatterns={movementPatterns}
          exerciseTags={exerciseTags}
          metricUnits={metricUnits}
          sectionTitles={sectionTitles}
          actions={actions}
        />
      </div>
    </SaveStatusContext.Provider>
  )
}

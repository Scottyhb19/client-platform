import { createSupabaseServerClient } from '@/lib/supabase/server'
import { LibraryView } from './_components/LibraryView'
import { LIBRARY_EXERCISE_COLUMNS, toLibraryExercises } from './_lib/exercise-query'
import type {
  CircuitSummary,
  ClientOption,
  Pattern,
  ProgramTemplateSummary,
  SessionTemplateSummary,
  TemplateDayLite,
  Tag,
} from './types'

export const dynamic = 'force-dynamic'

/**
 * 05 Library — exercises (live), circuits + sessions + programs scaffold.
 * Data fetch stays server-side; LibraryView is a Client Component that
 * holds the active-tab state and swaps rendered content.
 */
export default async function LibraryPage() {
  const supabase = await createSupabaseServerClient()

  const [
    { data: exercisesRaw, error: exErr },
    { data: patterns },
    { data: tags },
    { data: templatesRaw },
    { data: clientsRaw },
    { data: circuitsRaw },
    { data: sessionsRaw },
  ] = await Promise.all([
    // Shared select with the session builder's Library tab (G-7,
    // 2026-06-12) — one query shape, one card mapping, no drift.
    supabase
      .from('exercises')
      .select(LIBRARY_EXERCISE_COLUMNS)
      .is('deleted_at', null)
      .order('name'),
    supabase
      .from('movement_patterns')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    supabase
      .from('exercise_tags')
      .select('id, name')
      .is('deleted_at', null)
      .order('sort_order'),
    // LPT-2: program templates for the Programs tab. Pull the structure tree
    // (weeks → days → exercises) + reverse-embedded programs to derive the
    // summary counts; RLS scopes everything to the org. Soft-deleted children
    // are filtered in the mapper (the embed can't filter per-relation here).
    supabase
      .from('program_templates')
      .select(
        `id, name, description, created_at,
         template_weeks(id, week_number, deleted_at,
           template_days(id, day_label, sort_order, deleted_at,
             template_exercises(id, deleted_at))),
         programs(id, deleted_at)`,
      )
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // LPT-4: clients for the apply-to-client picker. Active (non-archived)
    // only — you can't start a new block for an archived client. RLS-scoped.
    supabase
      .from('clients')
      .select('id, first_name, last_name')
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('first_name'),
    // C-4: circuits for the Circuits tab. Pull the exercise children to derive
    // the count; RLS scopes to the org, soft-deleted children filtered in TS.
    supabase
      .from('circuits')
      .select('id, name, circuit_type, notes, created_at, circuit_exercises(id, deleted_at)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // S-4: session templates for the Sessions tab. Pull the exercise children
    // to derive the exercise count + distinct superset-group count; RLS scopes
    // to the org, soft-deleted children filtered in TS.
    supabase
      .from('session_templates')
      .select('id, name, created_at, session_template_exercises(id, superset_group_id, deleted_at)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ])

  if (exErr) throw new Error(`Load exercises: ${exErr.message}`)

  const exercises = toLibraryExercises(exercisesRaw)
  const programTemplates = toProgramTemplateSummaries(templatesRaw)
  const clients = (clientsRaw ?? []) as ClientOption[]
  const circuits = toCircuitSummaries(circuitsRaw)
  const sessions = toSessionSummaries(sessionsRaw)

  return (
    <div className="page">
      <LibraryView
        exercises={exercises}
        patterns={(patterns ?? []) as Pattern[]}
        tags={(tags ?? []) as Tag[]}
        programTemplates={programTemplates}
        circuits={circuits}
        sessions={sessions}
        clients={clients}
        total={exercises.length}
        patternCount={(patterns ?? []).length}
      />
    </div>
  )
}

/** Raw shape of the nested program_templates select (counts derived in TS). */
type RawTemplateRow = {
  id: string
  name: string
  description: string | null
  created_at: string
  template_weeks:
    | Array<{
        id: string
        week_number: number
        deleted_at: string | null
        template_days:
          | Array<{
              id: string
              day_label: string
              sort_order: number
              deleted_at: string | null
              template_exercises:
                | Array<{ id: string; deleted_at: string | null }>
                | null
            }>
          | null
      }>
    | null
  programs: Array<{ id: string; deleted_at: string | null }> | null
}

function toProgramTemplateSummaries(rows: unknown): ProgramTemplateSummary[] {
  const list = (rows ?? []) as RawTemplateRow[]
  return list.map((t) => {
    const weeks = (t.template_weeks ?? []).filter((w) => w.deleted_at === null)
    let dayCount = 0
    let exerciseCount = 0
    const days: TemplateDayLite[] = []
    for (const w of weeks) {
      const wd = (w.template_days ?? []).filter((d) => d.deleted_at === null)
      dayCount += wd.length
      for (const d of wd) {
        exerciseCount += (d.template_exercises ?? []).filter(
          (e) => e.deleted_at === null,
        ).length
        days.push({
          id: d.id,
          weekNumber: w.week_number,
          dayLabel: d.day_label,
          sortOrder: d.sort_order,
        })
      }
    }
    days.sort((a, b) => a.weekNumber - b.weekNumber || a.sortOrder - b.sortOrder)
    const usedCount = (t.programs ?? []).filter(
      (p) => p.deleted_at === null,
    ).length
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      created_at: t.created_at,
      weekCount: weeks.length,
      dayCount,
      exerciseCount,
      usedCount,
      days,
    }
  })
}

/** Raw shape of the nested circuits select (count derived in TS). */
type RawCircuitRow = {
  id: string
  name: string
  circuit_type: CircuitSummary['circuit_type']
  notes: string | null
  created_at: string
  circuit_exercises: Array<{ id: string; deleted_at: string | null }> | null
}

function toCircuitSummaries(rows: unknown): CircuitSummary[] {
  const list = (rows ?? []) as RawCircuitRow[]
  return list.map((c) => ({
    id: c.id,
    name: c.name,
    circuit_type: c.circuit_type,
    notes: c.notes,
    created_at: c.created_at,
    exerciseCount: (c.circuit_exercises ?? []).filter((e) => e.deleted_at === null).length,
  }))
}

/** Raw shape of the nested session_templates select (counts derived in TS). */
type RawSessionRow = {
  id: string
  name: string
  created_at: string
  session_template_exercises:
    | Array<{ id: string; superset_group_id: string | null; deleted_at: string | null }>
    | null
}

function toSessionSummaries(rows: unknown): SessionTemplateSummary[] {
  const list = (rows ?? []) as RawSessionRow[]
  return list.map((s) => {
    const live = (s.session_template_exercises ?? []).filter((e) => e.deleted_at === null)
    const groups = new Set(
      live
        .map((e) => e.superset_group_id)
        .filter((g): g is string => g !== null),
    )
    return {
      id: s.id,
      name: s.name,
      created_at: s.created_at,
      exerciseCount: live.length,
      supersetCount: groups.size,
    }
  })
}

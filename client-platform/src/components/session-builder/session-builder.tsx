"use client";

import { useState, useEffect, useCallback } from "react";
import { ExerciseCard } from "./exercise-card";
import { ActionBar } from "./action-bar";
import { RightPanel } from "./right-panel";
import type {
  SessionExercise,
  SessionDay,
  SetRow,
  NoteItem,
  LibraryExercise,
  RightPanelTab,
} from "./types";

// Generate a simple ID for new exercises (before saving to DB)
let counter = 0;
function tempId() {
  return `temp-${Date.now()}-${counter++}`;
}

// Generate set rows from a sets/reps prescription
function makeSetRows(sets: number | null, reps: string | null, load: string | null): SetRow[] {
  const count = sets ?? 3;
  return Array.from({ length: count }, (_, i) => ({
    setNumber: i + 1,
    reps: reps ?? "",
    optional: load ?? "",
  }));
}

// Compute sequence labels (A1, A2 for supersets, B1, C1, etc.)
function computeSequence(exercises: SessionExercise[]): string[] {
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const labels: string[] = [];
  let letter = 0;
  let num = 1;

  for (let i = 0; i < exercises.length; i++) {
    labels.push(`${ABC[letter] ?? "Z"}${num}`);

    const current = exercises[i];
    const next = exercises[i + 1];

    // If current and next share a superset group, increment number
    if (
      current.supersetGroup &&
      next?.supersetGroup &&
      current.supersetGroup === next.supersetGroup
    ) {
      num++;
    } else {
      letter++;
      num = 1;
    }
  }

  return labels;
}

interface Props {
  programId: string;
  dayId: string;
}

export function SessionBuilder({ programId, dayId }: Props) {
  const [day, setDay] = useState<SessionDay | null>(null);
  const [exercises, setExercises] = useState<SessionExercise[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<RightPanelTab>("notes");
  const [swapTarget, setSwapTarget] = useState<string | null>(null); // exercise ID being swapped
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch program data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/programs/${programId}`);
        if (!res.ok) throw new Error("Failed to load program");
        const program = await res.json();

        const dayGroup = program.days.find(
          (d: { id: string }) => d.id === dayId
        );
        if (!dayGroup) throw new Error("Day not found");

        const mapped: SessionExercise[] = dayGroup.exercises.map(
          (pe: {
            id: string;
            exerciseId: string;
            exercise: { name: string; videoUrl: string | null };
            sectionTitle: string | null;
            sortOrder: number;
            sets: number | null;
            reps: string | null;
            rest: string | null;
            rpe: number | null;
            metric: string | null;
            load: string | null;
            instructions: string | null;
            supersetGroup: string | null;
          }) => ({
            id: pe.id,
            programExerciseId: pe.id,
            exerciseId: pe.exerciseId,
            name: pe.exercise.name,
            videoUrl: pe.exercise.videoUrl,
            sectionTitle: pe.sectionTitle,
            sortOrder: pe.sortOrder,
            sets: pe.sets,
            reps: pe.reps,
            rest: pe.rest,
            rpe: pe.rpe,
            metric: pe.metric,
            load: pe.load,
            instructions: pe.instructions,
            supersetGroup: pe.supersetGroup,
            setRows: makeSetRows(pe.sets, pe.reps, pe.load),
          })
        );

        setDay({
          dayId,
          label: dayGroup.label,
          programId: program.id,
          programName: program.name,
          clientId: program.client.id,
          clientName: `${program.client.firstName} ${program.client.lastName}`,
          exercises: mapped,
        });
        setExercises(mapped);

        // Fetch clinical notes
        const notesRes = await fetch(
          `/api/notes?clientId=${program.client.id}`
        );
        if (notesRes.ok) {
          setNotes(await notesRes.json());
        }
      } catch (err) {
        console.error("Failed to load session builder:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [programId, dayId]);

  // Mark changes
  const markDirty = useCallback(() => setHasChanges(true), []);

  // Update a single exercise field
  const updateExercise = useCallback(
    (id: string, updates: Partial<SessionExercise>) => {
      setExercises((prev) =>
        prev.map((ex) => (ex.id === id ? { ...ex, ...updates } : ex))
      );
      markDirty();
    },
    [markDirty]
  );

  // Update a set row within an exercise
  const updateSetRow = useCallback(
    (exerciseId: string, setNumber: number, field: "reps" | "optional", value: string) => {
      setExercises((prev) =>
        prev.map((ex) =>
          ex.id === exerciseId
            ? {
                ...ex,
                setRows: ex.setRows.map((row) =>
                  row.setNumber === setNumber ? { ...row, [field]: value } : row
                ),
              }
            : ex
        )
      );
      markDirty();
    },
    [markDirty]
  );

  // Add a set row to an exercise
  const addSet = useCallback(
    (exerciseId: string) => {
      setExercises((prev) =>
        prev.map((ex) => {
          if (ex.id !== exerciseId) return ex;
          const lastRow = ex.setRows[ex.setRows.length - 1];
          return {
            ...ex,
            sets: (ex.sets ?? 0) + 1,
            setRows: [
              ...ex.setRows,
              {
                setNumber: ex.setRows.length + 1,
                reps: lastRow?.reps ?? "",
                optional: lastRow?.optional ?? "",
              },
            ],
          };
        })
      );
      markDirty();
    },
    [markDirty]
  );

  // Remove last set row
  const removeSet = useCallback(
    (exerciseId: string) => {
      setExercises((prev) =>
        prev.map((ex) => {
          if (ex.id !== exerciseId || ex.setRows.length <= 1) return ex;
          return {
            ...ex,
            sets: Math.max((ex.sets ?? 1) - 1, 1),
            setRows: ex.setRows.slice(0, -1),
          };
        })
      );
      markDirty();
    },
    [markDirty]
  );

  // Delete an exercise
  const deleteExercise = useCallback(
    (id: string) => {
      setExercises((prev) => {
        const filtered = prev.filter((ex) => ex.id !== id);
        // Recompute sort orders
        return filtered.map((ex, i) => ({ ...ex, sortOrder: i }));
      });
      markDirty();
    },
    [markDirty]
  );

  // Add exercise from library
  const addExerciseFromLibrary = useCallback(
    (libEx: LibraryExercise) => {
      if (swapTarget) {
        // Swap mode: replace the existing exercise
        setExercises((prev) =>
          prev.map((ex) =>
            ex.id === swapTarget
              ? {
                  ...ex,
                  exerciseId: libEx.id,
                  name: libEx.name,
                  videoUrl: libEx.videoUrl,
                  sets: libEx.defaultSets ?? ex.sets,
                  reps: libEx.defaultReps ?? ex.reps,
                  load: libEx.defaultLoad ?? ex.load,
                  setRows: makeSetRows(
                    libEx.defaultSets ?? ex.sets,
                    libEx.defaultReps ?? ex.reps,
                    libEx.defaultLoad ?? ex.load
                  ),
                }
              : ex
          )
        );
        setSwapTarget(null);
        setActiveTab("notes");
      } else {
        // Add mode: append to list
        const newEx: SessionExercise = {
          id: tempId(),
          exerciseId: libEx.id,
          name: libEx.name,
          videoUrl: libEx.videoUrl,
          sectionTitle: null,
          sortOrder: exercises.length,
          sets: libEx.defaultSets ?? 3,
          reps: libEx.defaultReps ?? "10",
          rest: null,
          rpe: null,
          metric: null,
          load: libEx.defaultLoad,
          instructions: null,
          supersetGroup: null,
          setRows: makeSetRows(
            libEx.defaultSets ?? 3,
            libEx.defaultReps ?? "10",
            libEx.defaultLoad
          ),
        };
        setExercises((prev) => [...prev, newEx]);
      }
      markDirty();
    },
    [swapTarget, exercises.length, markDirty]
  );

  // Initiate exercise swap
  const startSwap = useCallback(
    (exerciseId: string) => {
      setSwapTarget(exerciseId);
      setActiveTab("library");
    },
    []
  );

  // Cancel swap
  const cancelSwap = useCallback(() => {
    setSwapTarget(null);
    setActiveTab("notes");
  }, []);

  // Toggle superset between two adjacent exercises
  const toggleSuperset = useCallback(
    (topIndex: number) => {
      setExercises((prev) => {
        const top = prev[topIndex];
        const bottom = prev[topIndex + 1];
        if (!top || !bottom) return prev;

        const alreadyGrouped =
          top.supersetGroup &&
          top.supersetGroup === bottom.supersetGroup;

        if (alreadyGrouped) {
          // Ungroup — create new objects (never mutate existing ones)
          return prev.map((ex, i) =>
            i === topIndex || i === topIndex + 1
              ? { ...ex, supersetGroup: null }
              : ex
          );
        } else {
          // Group — reuse existing group or create a new one
          const group = top.supersetGroup ?? `ss-${tempId()}`;
          return prev.map((ex, i) =>
            i === topIndex || i === topIndex + 1
              ? { ...ex, supersetGroup: group }
              : ex
          );
        }
      });
      markDirty();
    },
    [markDirty]
  );

  // Open library panel for adding
  const openAddExercise = useCallback(() => {
    setSwapTarget(null);
    setActiveTab("library");
  }, []);

  // Save all changes back to the API
  const save = useCallback(async () => {
    if (!day) return;
    setSaving(true);

    try {
      // Delete exercises that were removed
      const originalIds = new Set(day.exercises.map((e) => e.id));
      const currentIds = new Set(
        exercises.filter((e) => e.programExerciseId).map((e) => e.programExerciseId!)
      );
      const deletedIds = [...originalIds].filter((id) => !currentIds.has(id));

      // Delete removed exercises
      for (const id of deletedIds) {
        await fetch(`/api/programs/${programId}/days/${dayId}/exercises`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, deletedAt: new Date().toISOString() }),
        });
      }

      // Update existing and create new exercises
      for (let i = 0; i < exercises.length; i++) {
        const ex = exercises[i];
        if (ex.programExerciseId) {
          // Update existing
          await fetch(`/api/programs/${programId}/days/${dayId}/exercises`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: ex.programExerciseId,
              sortOrder: i,
              sectionTitle: ex.sectionTitle,
              sets: ex.setRows.length,
              reps: ex.setRows[0]?.reps ?? ex.reps,
              load: ex.setRows[0]?.optional ?? ex.load,
              instructions: ex.instructions,
              supersetGroup: ex.supersetGroup,
            }),
          });
        } else {
          // Create new
          await fetch(`/api/programs/${programId}/days/${dayId}/exercises`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              exerciseId: ex.exerciseId,
              sortOrder: i,
              sectionTitle: ex.sectionTitle,
              sets: ex.setRows.length,
              reps: ex.setRows[0]?.reps ?? ex.reps,
              load: ex.setRows[0]?.optional ?? ex.load,
              instructions: ex.instructions,
              supersetGroup: ex.supersetGroup,
            }),
          });
        }
      }

      setHasChanges(false);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [day, exercises, programId, dayId]);

  // Compute sequence labels
  const sequenceLabels = computeSequence(exercises);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="text-[var(--color-slate)] text-sm">Loading session builder...</div>
      </div>
    );
  }

  if (!day) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)]">
        <div className="text-[var(--color-red)] text-sm">Program or day not found.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] -m-6 -mt-6">
      {/* Header */}
      <div className="bg-white border-b border-[var(--color-border)] px-6 py-2.5 flex items-center justify-between flex-shrink-0">
        <button
          onClick={() => window.history.back()}
          className="text-[var(--color-slate)] text-xs font-medium flex items-center gap-1.5 hover:text-[var(--color-primary)] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Calendar
        </button>

        <div className="text-center">
          <div className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)]">
            {day.clientName} — {day.label}
          </div>
          <div className="text-[0.7rem] text-[var(--color-slate)]">{day.programName}</div>
        </div>

        <button
          onClick={save}
          disabled={saving || !hasChanges}
          className="text-xs font-semibold px-3.5 py-1.5 rounded-md border-none bg-[var(--color-primary)] text-white cursor-pointer disabled:opacity-40 disabled:cursor-default hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Main layout: exercises + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Scrollable exercise area */}
        <div className="flex-1 overflow-y-auto p-5 pb-20">
          {exercises.map((ex, index) => (
            <div key={ex.id}>
              <ExerciseCard
                exercise={ex}
                sequenceLabel={sequenceLabels[index]}
                isSuperseted={!!ex.supersetGroup}
                isFirstInSuperset={
                  !!ex.supersetGroup &&
                  (index === 0 || exercises[index - 1]?.supersetGroup !== ex.supersetGroup)
                }
                isLastInSuperset={
                  !!ex.supersetGroup &&
                  (index === exercises.length - 1 ||
                    exercises[index + 1]?.supersetGroup !== ex.supersetGroup)
                }
                showSectionTitle={
                  !!ex.sectionTitle &&
                  (index === 0 || exercises[index - 1]?.sectionTitle !== ex.sectionTitle)
                }
                onUpdate={(updates) => updateExercise(ex.id, updates)}
                onUpdateSetRow={(setNum, field, value) => updateSetRow(ex.id, setNum, field, value)}
                onAddSet={() => addSet(ex.id)}
                onRemoveSet={() => removeSet(ex.id)}
                onDelete={() => deleteExercise(ex.id)}
                onSwap={() => startSwap(ex.id)}
                onChangeSectionTitle={(title) =>
                  updateExercise(ex.id, { sectionTitle: title })
                }
              />

              {/* Action bar between exercises */}
              {index < exercises.length - 1 && (
                <ActionBar
                  isSupersetted={
                    !!ex.supersetGroup &&
                    !!exercises[index + 1]?.supersetGroup &&
                    ex.supersetGroup === exercises[index + 1]?.supersetGroup
                  }
                  onToggleSuperset={() => toggleSuperset(index)}
                  onAddExercise={openAddExercise}
                />
              )}
            </div>
          ))}

          {/* Add exercise button at bottom */}
          <button
            onClick={openAddExercise}
            className="flex items-center justify-center gap-1.5 w-full p-3 mt-2 border border-dashed border-[var(--color-border)] rounded-lg cursor-pointer text-[var(--color-slate)] text-xs font-medium bg-white hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          >
            + Add exercise
          </button>
        </div>

        {/* Right panel */}
        <RightPanel
          activeTab={activeTab}
          onTabChange={setActiveTab}
          notes={notes}
          clientId={day.clientId}
          swapTarget={swapTarget}
          swapExerciseName={
            swapTarget
              ? exercises.find((e) => e.id === swapTarget)?.name ?? null
              : null
          }
          onCancelSwap={cancelSwap}
          onSelectExercise={addExerciseFromLibrary}
        />
      </div>
    </div>
  );
}

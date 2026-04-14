// Types for the session builder's local state.
// These mirror the DB shape but are mutable for in-memory editing.

export interface SessionExercise {
  id: string;
  programExerciseId?: string; // undefined for newly added exercises
  exerciseId: string;
  name: string;
  videoUrl: string | null;
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
  // Per-set prescription overrides (for the set table)
  setRows: SetRow[];
}

export interface SetRow {
  setNumber: number;
  reps: string;
  optional: string; // load, tempo, notes — flexible per-set field
}

export interface SessionDay {
  dayId: string;
  label: string;
  programId: string;
  programName: string;
  clientId: string;
  clientName: string;
  exercises: SessionExercise[];
}

export interface NoteItem {
  id: string;
  type: string;
  content: string;
  isInjuryFlag: boolean;
  createdAt: string;
}

export interface LibraryExercise {
  id: string;
  name: string;
  movementPattern: string | null;
  videoUrl: string | null;
  defaultSets: number | null;
  defaultReps: string | null;
  defaultLoad: string | null;
  tags: { name: string }[];
}

export type RightPanelTab = "notes" | "reports" | "library";

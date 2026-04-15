"use client";

import { use, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface SetLog {
  setNumber: number;
  prescribed: string;
  repsCompleted: string;
  loadUsed: string;
}

interface ExerciseLog {
  programExerciseId: string;
  exerciseId: string;
  name: string;
  videoUrl: string | null;
  instructions: string | null;
  supersetGroup: string | null;
  sets: SetLog[];
  rpe: string;
}

interface DayData {
  id: string;
  label: string;
  programId: string;
  programName: string;
  clientId: string;
  exercises: ExerciseLog[];
}

// Sequence labels that handle supersets (A1, A2, B1, etc.)
function computeSequence(exercises: ExerciseLog[]): string[] {
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const labels: string[] = [];
  let letter = 0;
  let num = 1;

  for (let i = 0; i < exercises.length; i++) {
    labels.push(`${ABC[letter] ?? "Z"}${num}`);
    const current = exercises[i];
    const next = exercises[i + 1];
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

export default function PortalSessionPage({
  params,
}: {
  params: Promise<{ dayId: string }>;
}) {
  const { dayId } = use(params);
  const router = useRouter();
  const [day, setDay] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const startedAt = useRef(new Date().toISOString());

  // Load program data and build exercise logs
  useEffect(() => {
    async function load() {
      try {
        // For now, fetch the test program — in production this uses the client's assigned program
        const res = await fetch("/api/programs/test-program");
        if (!res.ok) throw new Error("Failed to load");
        const program = await res.json();

        const dayGroup = program.days.find(
          (d: { id: string }) => d.id === dayId
        );
        if (!dayGroup) throw new Error("Day not found");

        const exercises: ExerciseLog[] = dayGroup.exercises.map(
          (pe: {
            id: string;
            exerciseId: string;
            exercise: { name: string; videoUrl: string | null };
            sets: number | null;
            reps: string | null;
            load: string | null;
            instructions: string | null;
            supersetGroup: string | null;
          }) => {
            const setCount = pe.sets ?? 3;
            return {
              programExerciseId: pe.id,
              exerciseId: pe.exerciseId,
              name: pe.exercise.name,
              videoUrl: pe.exercise.videoUrl,
              instructions: pe.instructions,
              supersetGroup: pe.supersetGroup,
              sets: Array.from({ length: setCount }, (_, i) => ({
                setNumber: i + 1,
                prescribed: pe.reps ?? "",
                repsCompleted: pe.reps ?? "",
                loadUsed: pe.load ?? "",
              })),
              rpe: "",
            };
          }
        );

        setDay({
          id: dayGroup.id,
          label: dayGroup.label,
          programId: program.id,
          programName: program.name,
          clientId: program.client.id,
          exercises,
        });
      } catch (err) {
        console.error("Failed to load session:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dayId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-sm text-[var(--color-slate)]">
        Loading session...
      </div>
    );
  }

  if (!day) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-sm text-[var(--color-slate)]">
        Session not found.
      </div>
    );
  }

  const exercises = day.exercises;
  const labels = computeSequence(exercises);
  const current = exercises[currentIndex];
  const isLast = currentIndex === exercises.length - 1;
  const progress = ((currentIndex + 1) / exercises.length) * 100;

  function updateSet(
    setNumber: number,
    field: "repsCompleted" | "loadUsed",
    value: string
  ) {
    setDay((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        exercises: prev.exercises.map((ex, i) =>
          i === currentIndex
            ? {
                ...ex,
                sets: ex.sets.map((s) =>
                  s.setNumber === setNumber ? { ...s, [field]: value } : s
                ),
              }
            : ex
        ),
      };
    });
  }

  function updateRpe(value: string) {
    setDay((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        exercises: prev.exercises.map((ex, i) =>
          i === currentIndex ? { ...ex, rpe: value } : ex
        ),
      };
    });
  }

  async function submitSession() {
    if (!day) return;
    setSubmitting(true);

    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: day.clientId,
          programId: day.programId,
          dayLabel: day.label,
          startedAt: startedAt.current,
          completedAt: new Date().toISOString(),
          exerciseLogs: day.exercises.map((ex) => ({
            programExerciseId: ex.programExerciseId,
            sets: ex.sets.map((s) => ({
              setNumber: s.setNumber,
              repsCompleted: parseInt(s.repsCompleted) || null,
              loadUsed: s.loadUsed || null,
              rpe: parseInt(ex.rpe) || null,
            })),
          })),
        }),
      });
      setDone(true);
    } catch (err) {
      console.error("Failed to submit session:", err);
    } finally {
      setSubmitting(false);
    }
  }

  // Completed screen
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--color-accent)]/15 flex items-center justify-center mb-4">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
        <h2 className="font-[family-name:var(--font-display)] font-bold text-xl text-[var(--color-charcoal)] mb-1">
          Session Complete
        </h2>
        <p className="text-sm text-[var(--color-slate)] mb-6">
          {day.label} logged. Nice work.
        </p>
        <button
          onClick={() => router.push("/program")}
          className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-xl font-semibold text-sm border-none cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          Back to Program
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="bg-[var(--color-charcoal)] px-5 pt-5 pb-4 text-white -mx-4 -mt-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => router.push("/program")}
            className="text-white/50 text-xs font-medium flex items-center gap-1 bg-transparent border-none cursor-pointer hover:text-white/80"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Exit
          </button>
          <div className="text-xs text-white/40">
            {currentIndex + 1} / {exercises.length}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <h1 className="font-[family-name:var(--font-display)] font-bold text-lg">
          {day.label}
        </h1>
        <div className="text-xs text-white/40">{day.programName}</div>
      </div>

      {/* Exercise card */}
      <div className="flex-1 px-4 pt-5 pb-4">
        <div className="bg-white rounded-2xl border border-[var(--color-border)] overflow-hidden shadow-sm">
          {/* Exercise header */}
          <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2.5">
              <div
                className={`font-[family-name:var(--font-display)] font-black text-sm w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  current.supersetGroup
                    ? "bg-[var(--color-accent)] text-[var(--color-charcoal)]"
                    : "bg-[var(--color-charcoal)] text-white"
                }`}
              >
                {labels[currentIndex]}
              </div>
              <h2 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
                {current.name}
              </h2>
            </div>
            {current.instructions && (
              <p className="text-xs text-[var(--color-slate)] mt-2 leading-relaxed">
                {current.instructions}
              </p>
            )}
          </div>

          {/* Video link */}
          {current.videoUrl && (
            <a
              href={current.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-5 py-2.5 border-b border-[var(--color-border)] text-xs text-[var(--color-primary)] font-medium hover:bg-[var(--color-background)]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <polygon points="6 3 20 12 6 21" />
              </svg>
              Watch demo
            </a>
          )}

          {/* Set logging table */}
          <div className="px-5 py-3">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-[0.68rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider py-2 text-center w-10">
                    Set
                  </th>
                  <th className="text-[0.68rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider py-2 text-center">
                    Reps
                  </th>
                  <th className="text-[0.68rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider py-2 text-center">
                    Load / Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {current.sets.map((set) => (
                  <tr key={set.setNumber}>
                    <td className="py-1.5 text-center">
                      <div className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-slate)]">
                        {set.setNumber}
                      </div>
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        className="w-full h-10 border border-[var(--color-border)] rounded-lg text-center font-[family-name:var(--font-display)] font-bold text-base text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
                        value={set.repsCompleted}
                        onChange={(e) =>
                          updateSet(
                            set.setNumber,
                            "repsCompleted",
                            e.target.value
                          )
                        }
                        placeholder={set.prescribed}
                      />
                    </td>
                    <td className="py-1.5 px-1.5">
                      <input
                        type="text"
                        className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
                        value={set.loadUsed}
                        onChange={(e) =>
                          updateSet(set.setNumber, "loadUsed", e.target.value)
                        }
                        placeholder="e.g. 60kg"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* RPE slider */}
          <div className="px-5 py-3 border-t border-[var(--color-border)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider">
                RPE (how hard?)
              </span>
              <span className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)]">
                {current.rpe || "–"} / 10
              </span>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => (
                <button
                  key={val}
                  onClick={() => updateRpe(String(val))}
                  className={`flex-1 h-9 rounded-lg font-[family-name:var(--font-display)] font-bold text-xs border cursor-pointer transition-colors ${
                    current.rpe === String(val)
                      ? val >= 8
                        ? "bg-[var(--color-red)] text-white border-[var(--color-red)]"
                        : val >= 5
                          ? "bg-[var(--color-accent)] text-[var(--color-charcoal)] border-[var(--color-accent)]"
                          : "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-white text-[var(--color-slate)] border-[var(--color-border)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {val}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="px-4 pb-6 flex gap-3">
        {currentIndex > 0 && (
          <button
            onClick={() => setCurrentIndex((i) => i - 1)}
            className="flex-1 py-3.5 rounded-xl font-semibold text-sm border border-[var(--color-border)] bg-white text-[var(--color-charcoal)] cursor-pointer hover:border-[var(--color-primary)] transition-colors"
          >
            Previous
          </button>
        )}
        {isLast ? (
          <button
            onClick={submitSession}
            disabled={submitting}
            className="flex-1 py-3.5 rounded-xl font-[family-name:var(--font-display)] font-bold text-base border-none bg-[var(--color-accent)] text-[var(--color-charcoal)] cursor-pointer disabled:opacity-50 hover:brightness-95 transition-all"
          >
            {submitting ? "Saving..." : "Complete Session"}
          </button>
        ) : (
          <button
            onClick={() => setCurrentIndex((i) => i + 1)}
            className="flex-1 py-3.5 rounded-xl font-[family-name:var(--font-display)] font-bold text-base border-none bg-[var(--color-primary)] text-white cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            Next Exercise
          </button>
        )}
      </div>
    </div>
  );
}

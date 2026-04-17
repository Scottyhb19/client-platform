"use client";

import { useState, useEffect } from "react";

interface SetData {
  setNumber: number;
  repsCompleted: number | null;
  loadUsed: string | null;
  rpe: number | null;
}

interface ExerciseLogData {
  id: string;
  programExercise: {
    exercise: { name: string };
  };
  sets: SetData[];
}

interface SessionData {
  id: string;
  dayLabel: string;
  sessionRpe: number | null;
  feedback: string | null;
  durationMin: number | null;
  completedAt: string;
  exerciseLogs: ExerciseLogData[];
}

export default function PortalReportsPage() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(
          "/api/sessions?clientId=test-client&limit=20"
        );
        if (!res.ok) throw new Error("Failed to load sessions");
        setSessions(await res.json());
      } catch (err) {
        console.error("Failed to load reports:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-sm text-[var(--color-slate)]">
        Loading reports...
      </div>
    );
  }

  // Stats summary
  const totalSessions = sessions.length;
  const totalDuration = sessions.reduce(
    (sum, s) => sum + (s.durationMin ?? 0),
    0
  );
  const avgRpe =
    sessions.filter((s) => s.sessionRpe).length > 0
      ? (
          sessions.reduce((sum, s) => sum + (s.sessionRpe ?? 0), 0) /
          sessions.filter((s) => s.sessionRpe).length
        ).toFixed(1)
      : null;

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="bg-[var(--color-charcoal)] px-5 pt-6 pb-5 text-white -mx-4 -mt-4">
        <div className="text-xs text-white/40 mb-0.5">Your progress</div>
        <h1 className="font-[family-name:var(--font-display)] font-bold text-xl text-white">
          My Reports
        </h1>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2 pt-4 px-1 mb-4">
        <div className="bg-white rounded-2xl border border-[var(--color-border)] px-3 py-3 text-center">
          <div className="font-[family-name:var(--font-display)] font-black text-2xl text-[var(--color-primary)]">
            {totalSessions}
          </div>
          <div className="text-[0.65rem] text-[var(--color-slate)] font-medium">
            Sessions
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[var(--color-border)] px-3 py-3 text-center">
          <div className="font-[family-name:var(--font-display)] font-black text-2xl text-[var(--color-charcoal)]">
            {totalDuration > 0 ? `${totalDuration}m` : "–"}
          </div>
          <div className="text-[0.65rem] text-[var(--color-slate)] font-medium">
            Total Time
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-[var(--color-border)] px-3 py-3 text-center">
          <div className="font-[family-name:var(--font-display)] font-black text-2xl text-[var(--color-accent)]">
            {avgRpe ?? "–"}
          </div>
          <div className="text-[0.65rem] text-[var(--color-slate)] font-medium">
            Avg RPE
          </div>
        </div>
      </div>

      {/* Session history */}
      <div className="px-1">
        <h2 className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)] mb-2 px-1">
          Session History
        </h2>

        {sessions.length > 0 ? (
          <div className="space-y-2">
            {sessions.map((session) => {
              const date = new Date(session.completedAt);
              const isExpanded = expanded === session.id;

              return (
                <div
                  key={session.id}
                  className="bg-white rounded-2xl border border-[var(--color-border)] overflow-hidden"
                >
                  {/* Summary row */}
                  <button
                    onClick={() =>
                      setExpanded(isExpanded ? null : session.id)
                    }
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-transparent border-none cursor-pointer text-left"
                  >
                    <div className="flex flex-col items-center w-11 flex-shrink-0">
                      <div className="text-[0.6rem] font-semibold text-[var(--color-slate)] uppercase">
                        {date.toLocaleDateString("en-AU", {
                          weekday: "short",
                        })}
                      </div>
                      <div className="font-[family-name:var(--font-display)] font-black text-xl text-[var(--color-charcoal)] leading-none">
                        {date.getDate()}
                      </div>
                      <div className="text-[0.6rem] text-[var(--color-slate)]">
                        {date.toLocaleDateString("en-AU", { month: "short" })}
                      </div>
                    </div>

                    <div className="w-px h-10 bg-[var(--color-border)]" />

                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-[var(--color-charcoal)]">
                        {session.dayLabel}
                      </div>
                      <div className="text-xs text-[var(--color-slate)] mt-0.5">
                        {session.exerciseLogs.length} exercises
                        {session.durationMin
                          ? ` · ${session.durationMin} min`
                          : ""}
                        {session.sessionRpe
                          ? ` · RPE ${session.sessionRpe}`
                          : ""}
                      </div>
                    </div>

                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--color-slate)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      className={`flex-shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border)] px-4 py-3">
                      {session.exerciseLogs.map((log) => (
                        <div
                          key={log.id}
                          className="py-2 border-b border-black/[0.04] last:border-b-0"
                        >
                          <div className="font-semibold text-xs text-[var(--color-charcoal)] mb-1">
                            {log.programExercise.exercise.name}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {log.sets.map((set) => (
                              <div
                                key={set.setNumber}
                                className="text-[0.65rem] bg-[var(--color-background)] text-[var(--color-slate)] px-2 py-0.5 rounded"
                              >
                                Set {set.setNumber}:{" "}
                                {set.repsCompleted ?? "–"} reps
                                {set.loadUsed ? ` @ ${set.loadUsed}` : ""}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {session.feedback && (
                        <div className="mt-2 text-xs text-[var(--color-slate)] italic">
                          &ldquo;{session.feedback}&rdquo;
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[var(--color-border)] px-5 py-8 text-center">
            <div className="text-2xl mb-2">📊</div>
            <div className="text-sm text-[var(--color-slate)]">
              No sessions logged yet.
            </div>
            <div className="text-xs text-[var(--color-slate)] mt-1">
              Complete a session to see your progress here.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

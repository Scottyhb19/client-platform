"use client";

import { useState, useEffect } from "react";

interface ProgramDay {
  id: string;
  label: string;
  exercises: {
    id: string;
    exercise: { name: string };
    sets: number | null;
    reps: string | null;
    supersetGroup: string | null;
  }[];
}

interface Program {
  id: string;
  name: string;
  days: ProgramDay[];
}

export default function PortalProgramPage() {
  const [program, setProgram] = useState<Program | null>(null);
  const [selectedDay, setSelectedDay] = useState<ProgramDay | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // For now, fetch the test program. In production, this uses the authenticated client's program.
    fetch("/api/programs/test-program")
      .then((r) => r.json())
      .then((data) => {
        setProgram(data);
        if (data.days?.length > 0) setSelectedDay(data.days[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-sm text-[var(--color-slate)]">
        Loading your program...
      </div>
    );
  }

  if (!program) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-sm text-[var(--color-slate)]">
        No program assigned yet.
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="bg-[var(--color-charcoal)] px-5 pt-6 pb-5 text-white -mx-4 -mt-4">
        <div className="text-xs text-white/40 mb-0.5">Your program</div>
        <h1 className="font-[family-name:var(--font-display)] font-bold text-xl text-white">
          {program.name}
        </h1>
      </div>

      {/* Day tabs */}
      <div className="bg-white border-b border-[var(--color-border)] -mx-4 px-4 py-3 flex gap-2 overflow-x-auto">
        {program.days.map((day) => (
          <button
            key={day.id}
            onClick={() => setSelectedDay(day)}
            className={`whitespace-nowrap px-4 py-2 rounded-xl font-semibold text-sm border transition-colors ${
              selectedDay?.id === day.id
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-white text-[var(--color-charcoal)] border-[var(--color-border)] hover:border-[var(--color-primary)]"
            }`}
          >
            {day.label}
          </button>
        ))}
      </div>

      {/* Exercise preview */}
      {selectedDay && (
        <div className="pt-4">
          <div className="bg-white rounded-2xl border border-[var(--color-border)] overflow-hidden shadow-sm">
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
              <h2 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
                {selectedDay.label}
              </h2>
              <div className="text-xs text-[var(--color-slate)] mt-0.5">
                {selectedDay.exercises.length} exercises
              </div>
            </div>

            <div className="px-5 py-2">
              {selectedDay.exercises.map((ex, i) => {
                const isSuperset = !!ex.supersetGroup;
                return (
                  <div
                    key={ex.id}
                    className="flex items-baseline gap-2.5 py-2 border-b border-black/[0.04] last:border-b-0"
                  >
                    <div
                      className={`font-[family-name:var(--font-display)] font-bold text-[0.68rem] w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 ${
                        isSuperset
                          ? "bg-[var(--color-accent)] text-[var(--color-charcoal)]"
                          : "bg-[var(--color-primary)] text-white"
                      }`}
                    >
                      {String.fromCharCode(65 + i)}1
                    </div>
                    <div className="flex-1">
                      <div className="font-semibold text-sm text-[var(--color-charcoal)]">
                        {ex.exercise.name}
                      </div>
                      <div className="text-xs text-[var(--color-slate)]">
                        {ex.sets && ex.reps
                          ? `${ex.sets} × ${ex.reps}`
                          : "Prescription pending"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button className="block w-[calc(100%-36px)] mx-[18px] mb-4 py-3.5 bg-[var(--color-primary)] text-white border-none rounded-xl font-[family-name:var(--font-display)] font-bold text-base cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors">
              Begin Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

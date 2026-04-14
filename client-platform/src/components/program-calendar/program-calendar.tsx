"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface ProgramDay {
  id: string;
  label: string;
  exercises: ProgramExercise[];
}

interface ProgramExercise {
  id: string;
  exercise: { name: string };
  sets: number | null;
  reps: string | null;
  rest: string | null;
  rpe: number | null;
  load: string | null;
  instructions: string | null;
  supersetGroup: string | null;
  sortOrder: number;
}

interface ProgramData {
  id: string;
  name: string;
  status: string;
  days: ProgramDay[];
}

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  programDay: ProgramDay | null; // which program day falls here
}

interface Props {
  programId: string;
  clientId: string;
  clientName: string;
}

// Build the day pattern: Day A, rest, Day B, rest, Day C, rest, rest
function getDayPattern(days: ProgramDay[]): (ProgramDay | null)[] {
  if (days.length === 0) return [null, null, null, null, null, null, null];
  // Simple repeating: session, rest, session, rest... fill 7 days
  const pattern: (ProgramDay | null)[] = [];
  let dayIdx = 0;
  for (let i = 0; i < 7; i++) {
    if (dayIdx < days.length && i % 2 === 0) {
      pattern.push(days[dayIdx]);
      dayIdx++;
    } else {
      pattern.push(null);
    }
  }
  return pattern;
}

function getCalendarWeeks(year: number, month: number, pattern: (ProgramDay | null)[]): CalendarDay[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Start on Monday
  let startDate = new Date(firstDay);
  const dayOfWeek = startDate.getDay();
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday = 0
  startDate.setDate(startDate.getDate() - offset);

  const weeks: CalendarDay[][] = [];
  const current = new Date(startDate);

  while (current <= lastDay || weeks.length < 5) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(current);
      const isCurrentMonth = date.getMonth() === month;
      const isToday = date.getTime() === today.getTime();
      // Map day of week to pattern
      const patternIdx = i % pattern.length;
      week.push({
        date,
        isCurrentMonth,
        isToday,
        programDay: isCurrentMonth ? pattern[patternIdx] : null,
      });
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (weeks.length >= 6) break;
  }

  return weeks;
}

// Compute sequence labels for exercises
function computeSequence(exercises: ProgramExercise[]): string[] {
  const ABC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const labels: string[] = [];
  let letter = 0;
  let num = 1;

  for (let i = 0; i < exercises.length; i++) {
    labels.push(`${ABC[letter] ?? "Z"}${num}`);
    const current = exercises[i];
    const next = exercises[i + 1];
    if (current.supersetGroup && next?.supersetGroup && current.supersetGroup === next.supersetGroup) {
      num++;
    } else {
      letter++;
      num = 1;
    }
  }
  return labels;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ProgramCalendar({ programId, clientName }: Props) {
  const [program, setProgram] = useState<ProgramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [expandedWeek, setExpandedWeek] = useState<number | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/programs/${programId}`)
      .then((r) => r.json())
      .then((data) => {
        setProgram(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [programId]);

  const changeMonth = useCallback((delta: number) => {
    setCurrentMonth((m) => {
      let newMonth = m + delta;
      let newYear = currentYear;
      if (newMonth < 0) { newMonth = 11; newYear--; }
      if (newMonth > 11) { newMonth = 0; newYear++; }
      setCurrentYear(newYear);
      setExpandedWeek(null);
      setExpandedDays(new Set());
      return newMonth;
    });
  }, [currentYear]);

  const goToday = useCallback(() => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
    setExpandedWeek(null);
    setExpandedDays(new Set());
  }, []);

  const toggleWeek = useCallback((weekIdx: number) => {
    setExpandedWeek((prev) => (prev === weekIdx ? null : weekIdx));
  }, []);

  const toggleDay = useCallback((dayKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  }, []);

  if (loading || !program) {
    return (
      <div className="text-sm text-[var(--color-slate)]">
        {loading ? "Loading calendar..." : "Program not found."}
      </div>
    );
  }

  const pattern = getDayPattern(program.days);
  const weeks = getCalendarWeeks(currentYear, currentMonth, pattern);

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-64px)]">
      {/* Program Toolbar */}
      <div className="px-6 py-3 bg-white border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="font-[family-name:var(--font-display)] font-bold text-base text-[var(--color-charcoal)]">
            {program.name}
          </h2>
          <span className="bg-[var(--color-accent)]/10 text-[var(--color-primary)] px-2.5 py-0.5 rounded-xl font-semibold text-[0.7rem] uppercase tracking-wider">
            {program.status}
          </span>
        </div>
        <div className="text-xs text-[var(--color-slate)]">{clientName}</div>
      </div>

      {/* Month Navigation */}
      <div className="px-6 py-2.5 bg-white border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <div />
        <div className="flex items-center gap-4">
          <button
            onClick={() => changeMonth(-1)}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] bg-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)] min-w-[160px] text-center">
            {MONTH_NAMES[currentMonth]} {currentYear}
          </div>
          <button
            onClick={() => changeMonth(1)}
            className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] bg-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
        <button
          onClick={goToday}
          className="text-xs font-medium text-[var(--color-primary)] cursor-pointer px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-background)]"
        >
          Today
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 bg-white border-b border-[var(--color-border)] flex-shrink-0">
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            className="py-2 text-center border-r border-[var(--color-border)] last:border-r-0 font-[family-name:var(--font-display)] font-semibold text-[0.74rem] uppercase tracking-wider text-[var(--color-slate)]"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-y-auto">
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="border-b border-[var(--color-border)]">
            {/* Date cells row */}
            <div className="grid grid-cols-7 bg-white">
              {week.map((day, dayIdx) => (
                <div
                  key={dayIdx}
                  onClick={() => toggleWeek(weekIdx)}
                  className="px-2.5 py-1.5 border-r border-[var(--color-border)] last:border-r-0 flex items-center justify-between cursor-pointer min-h-[36px] hover:bg-[#FAFBFA] transition-colors"
                >
                  <span
                    className={`font-[family-name:var(--font-display)] font-bold text-[0.92rem] ${
                      day.isToday
                        ? "bg-[var(--color-primary)] text-white w-[26px] h-[26px] rounded-full flex items-center justify-center text-[0.82rem]"
                        : day.isCurrentMonth
                          ? "text-[var(--color-charcoal)]"
                          : "text-[var(--color-border)] font-normal"
                    }`}
                  >
                    {day.date.getDate()}
                  </span>
                  {day.programDay && (
                    <span className="text-[0.66rem] font-semibold text-[var(--color-primary)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded-lg whitespace-nowrap">
                      {day.programDay.label}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Expanded week content */}
            {expandedWeek === weekIdx && (
              <div className="bg-[#FAFCFB]">
                <div className="grid grid-cols-7">
                  {week.map((day, dayIdx) => {
                    const dayKey = `${weekIdx}-${dayIdx}`;
                    const isExpanded = expandedDays.has(dayKey);
                    const pd = day.programDay;

                    if (!pd) {
                      return (
                        <div
                          key={dayIdx}
                          className="border-r border-[var(--color-border)] last:border-r-0 min-h-[40px] bg-black/[0.01]"
                        >
                          <div className="text-center py-3 text-[0.72rem] text-[var(--color-slate)] italic">
                            Rest
                          </div>
                        </div>
                      );
                    }

                    const seqLabels = computeSequence(pd.exercises);

                    return (
                      <div
                        key={dayIdx}
                        className="border-r border-[var(--color-border)] last:border-r-0 min-h-[40px]"
                      >
                        {/* Day header */}
                        <div
                          onClick={() => toggleDay(dayKey)}
                          className="px-2 py-1.5 text-[0.7rem] font-semibold text-[var(--color-primary)] border-b border-black/[0.04] cursor-pointer flex items-center justify-between hover:bg-[var(--color-primary)]/[0.03] transition-colors"
                        >
                          <Link
                            href={`/programs/${program.id}/session/${pd.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {pd.label}
                          </Link>
                          <span className="flex items-center gap-1">
                            <span className="font-normal text-[var(--color-slate)] text-[0.68rem]">
                              {pd.exercises.length} ex
                            </span>
                            <svg
                              className={`w-3 h-3 text-[var(--color-slate)] transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                            >
                              <path d="M9 18l6-6-6-6" />
                            </svg>
                          </span>
                        </div>

                        {/* Exercise list */}
                        {isExpanded && (
                          <div className="px-1.5 pb-2">
                            {pd.exercises.map((ex, exIdx) => {
                              const isSuperset = !!ex.supersetGroup;
                              const isFirstInGroup =
                                isSuperset &&
                                (exIdx === 0 ||
                                  pd.exercises[exIdx - 1]?.supersetGroup !== ex.supersetGroup);
                              const isInGroup =
                                isSuperset &&
                                !isFirstInGroup;

                              return (
                                <div
                                  key={ex.id}
                                  className={`py-1 px-1.5 border-b border-black/[0.03] last:border-b-0 hover:bg-[var(--color-primary)]/[0.025] transition-colors ${
                                    isSuperset && !isFirstInGroup ? "pl-4" : ""
                                  } ${isFirstInGroup ? "pl-4 border-l-[3px] border-l-[var(--color-accent)] rounded-tl" : ""} ${isInGroup ? "pl-4 border-l-[3px] border-l-[var(--color-accent)]" : ""}`}
                                >
                                  <div className="flex items-baseline gap-1.5">
                                    <div
                                      className={`font-[family-name:var(--font-display)] font-bold text-[0.68rem] w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        isSuperset
                                          ? "bg-[var(--color-accent)] text-[var(--color-charcoal)]"
                                          : "bg-[var(--color-primary)] text-white"
                                      }`}
                                    >
                                      {seqLabels[exIdx]}
                                    </div>
                                    <span className="font-semibold text-[0.76rem] text-[var(--color-charcoal)] leading-tight">
                                      {ex.exercise.name}
                                    </span>
                                  </div>
                                  <div className="text-[0.7rem] text-[var(--color-slate)] pl-[26px]">
                                    {ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ""}
                                    {ex.rpe ? ` · RPE ${ex.rpe}` : ""}
                                    {ex.rest ? ` · ${ex.rest} rest` : ""}
                                  </div>
                                  {ex.instructions && (
                                    <div className="text-[0.68rem] text-[var(--color-primary)] pl-[26px] italic leading-tight">
                                      {ex.instructions}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

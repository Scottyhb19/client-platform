"use client";

import { useState } from "react";
import type { SessionExercise } from "./types";
import { DEFAULT_SECTION_TITLES } from "@/lib/constants";

interface Props {
  exercise: SessionExercise;
  sequenceLabel: string;
  isSuperseted: boolean;
  isFirstInSuperset: boolean;
  isLastInSuperset: boolean;
  showSectionTitle: boolean;
  onUpdate: (updates: Partial<SessionExercise>) => void;
  onUpdateSetRow: (setNumber: number, field: "reps" | "optional", value: string) => void;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onDelete: () => void;
  onSwap: () => void;
  onChangeSectionTitle: (title: string | null) => void;
}

export function ExerciseCard({
  exercise,
  sequenceLabel,
  isSuperseted,
  isFirstInSuperset,
  isLastInSuperset,
  showSectionTitle,
  onUpdate,
  onUpdateSetRow,
  onAddSet,
  onRemoveSet,
  onDelete,
  onSwap,
  onChangeSectionTitle,
}: Props) {
  const [showTitleDropdown, setShowTitleDropdown] = useState(false);

  // Prescription summary (e.g. "4 × 10")
  const setCount = exercise.setRows.length;
  const firstReps = exercise.setRows[0]?.reps ?? exercise.reps ?? "–";
  const prescriptionSummary = `${setCount} × ${firstReps}`;

  // Card border styles for superset grouping
  let cardClasses = "bg-white border overflow-hidden";
  if (isSuperseted) {
    cardClasses += " border-[var(--color-accent)]";
    if (isFirstInSuperset) {
      cardClasses += " rounded-t-lg rounded-b-none border-b-0";
    } else if (isLastInSuperset) {
      cardClasses += " rounded-b-lg rounded-t-none border-t-2 border-t-dashed";
    } else {
      cardClasses += " rounded-none border-t-2 border-t-dashed border-b-0";
    }
  } else {
    cardClasses += " border-[var(--color-border)] rounded-lg";
  }

  const seqClasses = isSuperseted
    ? "bg-[var(--color-accent)] text-[var(--color-charcoal)]"
    : "bg-[var(--color-charcoal)] text-white";

  return (
    <div>
      {/* Section title bar */}
      {showSectionTitle && exercise.sectionTitle && (
        <div className="relative flex items-center gap-1.5 px-3.5 py-1 bg-[var(--color-background)] border border-b-0 border-[var(--color-border)] rounded-t-lg">
          <button
            className="font-[family-name:var(--font-display)] font-bold text-xs text-[var(--color-primary)] border-b border-dashed border-[var(--color-primary)]/25 hover:border-[var(--color-primary)] bg-transparent cursor-pointer p-0"
            onClick={() => setShowTitleDropdown(!showTitleDropdown)}
          >
            {exercise.sectionTitle}
          </button>
          <button
            className="text-[0.58rem] text-[var(--color-red)] cursor-pointer border-none bg-transparent p-0.5 rounded hover:bg-[var(--color-red)]/5"
            onClick={() => onChangeSectionTitle(null)}
          >
            ✕
          </button>

          {showTitleDropdown && (
            <div className="absolute top-full left-0 bg-white border border-[var(--color-border)] rounded-md shadow-lg z-20 py-1 min-w-[180px]">
              {DEFAULT_SECTION_TITLES.map((title) => (
                <button
                  key={title}
                  className="block w-full text-left px-3 py-1 text-xs cursor-pointer hover:bg-[var(--color-background)] hover:text-[var(--color-primary)] text-[var(--color-text)] bg-transparent border-none"
                  onClick={() => {
                    onChangeSectionTitle(title);
                    setShowTitleDropdown(false);
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add section title button if none set */}
      {!exercise.sectionTitle && (
        <div className="flex justify-start px-1 py-0.5">
          <button
            className="text-[0.66rem] text-[var(--color-slate)] cursor-pointer font-medium bg-transparent border-none p-0 hover:text-[var(--color-primary)]"
            onClick={() => setShowTitleDropdown(!showTitleDropdown)}
          >
            + Section
          </button>
          {showTitleDropdown && (
            <div className="absolute bg-white border border-[var(--color-border)] rounded-md shadow-lg z-20 py-1 min-w-[180px] mt-4">
              {DEFAULT_SECTION_TITLES.map((title) => (
                <button
                  key={title}
                  className="block w-full text-left px-3 py-1 text-xs cursor-pointer hover:bg-[var(--color-background)] hover:text-[var(--color-primary)] text-[var(--color-text)] bg-transparent border-none"
                  onClick={() => {
                    onChangeSectionTitle(title);
                    setShowTitleDropdown(false);
                  }}
                >
                  {title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main card */}
      <div className={cardClasses}>
        <div className="grid grid-cols-2">
          {/* LEFT: exercise info */}
          <div className="p-3 border-r border-[var(--color-border)] flex flex-col gap-1.5">
            {/* Header: sequence + name + delete */}
            <div className="flex items-center gap-2">
              <div
                className={`font-[family-name:var(--font-display)] font-black text-[0.82rem] w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${seqClasses}`}
              >
                {sequenceLabel}
              </div>
              <button
                className="flex-1 font-semibold text-[0.86rem] text-[var(--color-charcoal)] text-left bg-transparent border-none cursor-pointer font-[family-name:var(--font-body)] p-0 hover:text-[var(--color-primary)]"
                onClick={onSwap}
              >
                {exercise.name}
              </button>
              <button
                className="bg-transparent border-none text-[var(--color-border)] cursor-pointer p-0.5 flex-shrink-0 hover:text-[var(--color-red)]"
                onClick={onDelete}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Instructions */}
            <div>
              <div className="text-[0.64rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-0.5">
                Instructions
              </div>
              <textarea
                className="w-full border border-[var(--color-border)] rounded-[5px] px-2 py-1 font-[family-name:var(--font-body)] text-xs text-[var(--color-text)] bg-[var(--color-background)] resize-none min-h-[32px] outline-none focus:border-[var(--color-primary)] focus:bg-white placeholder:text-[var(--color-slate)]"
                placeholder="Coaching cues..."
                value={exercise.instructions ?? ""}
                onChange={(e) => onUpdate({ instructions: e.target.value || null })}
                rows={2}
              />
            </div>

            {/* Video thumbnail */}
            {exercise.videoUrl && (
              <a
                href={exercise.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full max-w-[120px] aspect-video bg-gradient-to-br from-[#1a2a22] to-[#2a3a32] rounded overflow-hidden relative cursor-pointer border border-[var(--color-border)] hover:border-[var(--color-primary)] mt-auto block"
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="white" opacity="0.4">
                    <polygon points="6 3 20 12 6 21" />
                  </svg>
                </div>
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-0.5 bg-black/60 text-[0.56rem] text-white/75 font-medium truncate">
                  {exercise.name}
                </div>
              </a>
            )}
          </div>

          {/* RIGHT: prescription table */}
          <div className="p-3 flex flex-col">
            {/* Summary */}
            <div className="font-[family-name:var(--font-display)] font-bold text-[0.92rem] text-[var(--color-charcoal)] mb-1.5">
              {prescriptionSummary}
            </div>

            {/* Set table */}
            <table className="w-full border-collapse mb-1">
              <thead>
                <tr>
                  <th className="text-[0.64rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider px-1.5 py-1 text-center border-b border-[var(--color-border)] w-8">
                    Set
                  </th>
                  <th className="text-[0.64rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider px-1.5 py-1 text-left border-b border-[var(--color-border)]">
                    Reps
                  </th>
                  <th className="text-[0.64rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider px-1.5 py-1 text-left border-b border-[var(--color-border)]">
                    Load / Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {exercise.setRows.map((row) => (
                  <tr key={row.setNumber}>
                    <td className="font-[family-name:var(--font-display)] font-bold text-[0.78rem] text-[var(--color-slate)] text-center w-8 py-1">
                      {row.setNumber}
                    </td>
                    <td className="py-1 px-1">
                      <input
                        className="w-full h-7 border border-[var(--color-border)] rounded text-center font-[family-name:var(--font-display)] font-bold text-[0.84rem] text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
                        value={row.reps}
                        onChange={(e) =>
                          onUpdateSetRow(row.setNumber, "reps", e.target.value)
                        }
                      />
                    </td>
                    <td className="py-1 px-1">
                      <input
                        className="w-full h-7 border border-[var(--color-border)] rounded px-1.5 font-[family-name:var(--font-body)] text-xs text-[var(--color-text)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white placeholder:text-[var(--color-border)]"
                        value={row.optional}
                        onChange={(e) =>
                          onUpdateSetRow(row.setNumber, "optional", e.target.value)
                        }
                        placeholder=""
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Add/remove set controls */}
            <div className="flex items-center justify-end gap-1.5 mt-1">
              <button
                onClick={onRemoveSet}
                className="w-[22px] h-[22px] rounded-full border border-[var(--color-border)] bg-white flex items-center justify-center cursor-pointer text-[var(--color-slate)] text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                −
              </button>
              <span className="text-[0.68rem] text-[var(--color-slate)]">Sets</span>
              <button
                onClick={onAddSet}
                className="w-[22px] h-[22px] rounded-full border border-[var(--color-border)] bg-white flex items-center justify-center cursor-pointer text-[var(--color-slate)] text-sm hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
              >
                +
              </button>
            </div>

            {/* Rest period */}
            {exercise.rest && (
              <div className="mt-auto pt-1.5 border-t border-[var(--color-border)]">
                <div className="font-[family-name:var(--font-display)] font-extrabold text-[0.72rem] text-[var(--color-charcoal)] uppercase tracking-wider">
                  Rest
                </div>
                <div className="text-[0.72rem] text-[var(--color-slate)]">{exercise.rest}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

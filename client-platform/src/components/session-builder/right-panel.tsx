"use client";

import { useState, useEffect, useCallback } from "react";
import type { NoteItem, LibraryExercise, RightPanelTab } from "./types";
import { MOVEMENT_PATTERNS } from "@/lib/constants";

interface Props {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  notes: NoteItem[];
  clientId: string;
  swapTarget: string | null;
  swapExerciseName: string | null;
  onCancelSwap: () => void;
  onSelectExercise: (exercise: LibraryExercise) => void;
}

export function RightPanel({
  activeTab,
  onTabChange,
  notes,
  swapTarget,
  swapExerciseName,
  onCancelSwap,
  onSelectExercise,
}: Props) {
  const [libraryExercises, setLibraryExercises] = useState<LibraryExercise[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activePattern, setActivePattern] = useState<string | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  // Load library exercises when tab opens
  useEffect(() => {
    if (activeTab === "library" && !libraryLoaded) {
      fetch("/api/exercises?limit=100")
        .then((r) => r.json())
        .then((data) => {
          setLibraryExercises(data);
          setLibraryLoaded(true);
        })
        .catch(console.error);
    }
  }, [activeTab, libraryLoaded]);

  const fetchFiltered = useCallback(
    (search: string, pattern: string | null) => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (pattern) params.set("pattern", pattern);
      params.set("limit", "100");

      fetch(`/api/exercises?${params}`)
        .then((r) => r.json())
        .then(setLibraryExercises)
        .catch(console.error);
    },
    []
  );

  const handleSearch = useCallback(
    (q: string) => {
      setSearchQuery(q);
      fetchFiltered(q, activePattern);
    },
    [activePattern, fetchFiltered]
  );

  const handlePatternFilter = useCallback(
    (pattern: string | null) => {
      setActivePattern(pattern);
      fetchFiltered(searchQuery, pattern);
    },
    [searchQuery, fetchFiltered]
  );

  // Separate injury flags from regular notes
  const flags = notes.filter((n) => n.isInjuryFlag);
  const regularNotes = notes.filter((n) => !n.isInjuryFlag);

  const tabs: { key: RightPanelTab; label: string }[] = [
    { key: "notes", label: "Notes" },
    { key: "reports", label: "Reports" },
    { key: "library", label: "Library" },
  ];

  return (
    <div className="w-[340px] bg-white border-l border-[var(--color-border)] flex flex-col flex-shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--color-border)] flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onTabChange(tab.key)}
            className={`flex-1 py-2.5 text-center font-[family-name:var(--font-body)] font-semibold text-[0.72rem] cursor-pointer border-none border-b-2 bg-transparent transition-colors ${
              activeTab === tab.key
                ? "text-[var(--color-primary)] border-b-[var(--color-accent)]"
                : "text-[var(--color-slate)] border-b-transparent hover:text-[var(--color-primary)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Swap banner */}
      {swapTarget && (
        <div className="bg-[var(--color-accent)]/5 border-b border-[var(--color-accent)]/10 px-4 py-1.5 text-[0.72rem] text-[var(--color-primary)] font-medium flex items-center justify-between flex-shrink-0">
          <span>
            Replacing: <strong>{swapExerciseName}</strong>
          </span>
          <button
            onClick={onCancelSwap}
            className="bg-transparent border-none text-[var(--color-slate)] text-[0.68rem] cursor-pointer px-1.5 py-0.5 rounded font-[family-name:var(--font-body)] hover:text-[var(--color-red)]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {/* NOTES TAB */}
        {activeTab === "notes" && (
          <div className="p-4">
            {/* Injury flags */}
            {flags.length > 0 && (
              <div className="mb-3.5">
                <div className="font-semibold text-[0.68rem] text-[var(--color-red)] uppercase tracking-wider mb-1.5">
                  Flags
                </div>
                {flags.map((flag) => (
                  <div
                    key={flag.id}
                    className="bg-[var(--color-red)]/5 border-l-2 border-[var(--color-red)] px-2.5 py-1.5 rounded-r-[5px] text-xs mb-1 leading-relaxed"
                  >
                    {flag.content}
                  </div>
                ))}
              </div>
            )}

            {/* Regular notes */}
            {regularNotes.length > 0 ? (
              regularNotes.map((note) => (
                <div
                  key={note.id}
                  className="border-b border-[var(--color-border)] py-2.5 last:border-b-0"
                >
                  <div className="text-[0.66rem] text-[var(--color-slate)] font-medium mb-0.5">
                    {new Date(note.createdAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </div>
                  <NoteTypeBadge type={note.type} />
                  <div className="text-xs leading-relaxed mt-1">{note.content}</div>
                </div>
              ))
            ) : (
              <div className="text-xs text-[var(--color-slate)] text-center py-8">
                No clinical notes yet.
              </div>
            )}
          </div>
        )}

        {/* REPORTS TAB */}
        {activeTab === "reports" && (
          <div className="p-4">
            <div className="text-xs text-[var(--color-slate)] text-center py-8">
              Reports will appear here.
            </div>
          </div>
        )}

        {/* LIBRARY TAB */}
        {activeTab === "library" && (
          <div className="flex flex-col h-full">
            {/* Search */}
            <div className="px-4 py-2.5 border-b border-[var(--color-border)] flex-shrink-0">
              <input
                type="text"
                placeholder="Search exercises..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full py-1.5 px-3 pl-8 border border-[var(--color-border)] rounded-md font-[family-name:var(--font-body)] text-xs bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
                autoFocus
              />
            </div>

            {/* Movement pattern filter chips */}
            <div className="px-4 py-2 border-b border-[var(--color-border)] flex-shrink-0 flex gap-1 overflow-x-auto">
              <button
                onClick={() => handlePatternFilter(null)}
                className={`whitespace-nowrap px-2.5 py-1 rounded-xl border text-[0.66rem] font-medium cursor-pointer transition-colors ${
                  !activePattern
                    ? "bg-[var(--color-charcoal)] text-white border-[var(--color-charcoal)]"
                    : "bg-white text-[var(--color-slate)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                }`}
              >
                All
              </button>
              {MOVEMENT_PATTERNS.map((mp) => (
                <button
                  key={mp.value}
                  onClick={() =>
                    handlePatternFilter(activePattern === mp.value ? null : mp.value)
                  }
                  className={`whitespace-nowrap px-2.5 py-1 rounded-xl border text-[0.66rem] font-medium cursor-pointer transition-colors ${
                    activePattern === mp.value
                      ? "bg-[var(--color-charcoal)] text-white border-[var(--color-charcoal)]"
                      : "bg-white text-[var(--color-slate)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                  }`}
                >
                  {mp.label}
                </button>
              ))}
            </div>

            {/* Exercise list */}
            <div className="flex-1 overflow-y-auto">
              {libraryExercises.map((ex) => (
                <div
                  key={ex.id}
                  className="px-4 py-2 flex items-center gap-2.5 cursor-pointer border-b border-black/[0.03] hover:bg-[var(--color-primary)]/[0.02]"
                  onClick={() => onSelectExercise(ex)}
                >
                  <div className="flex-1">
                    <div className="font-semibold text-xs text-[var(--color-charcoal)]">
                      {ex.name}
                    </div>
                    <div className="text-[0.64rem] text-[var(--color-slate)] flex gap-1.5 mt-0.5">
                      {ex.movementPattern && (
                        <span>
                          {MOVEMENT_PATTERNS.find((m) => m.value === ex.movementPattern)?.label ??
                            ex.movementPattern}
                        </span>
                      )}
                      {ex.defaultSets && ex.defaultReps && (
                        <span>
                          {ex.defaultSets}×{ex.defaultReps}
                        </span>
                      )}
                      {ex.videoUrl && (
                        <span className="text-[var(--color-accent)] font-medium">Video</span>
                      )}
                      {ex.tags?.map((tag) => (
                        <span
                          key={tag.name}
                          className="text-[0.56rem] font-semibold px-1.5 py-0 rounded-md bg-[var(--color-amber)]/10 text-[#9A7A0E]"
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button className="bg-[var(--color-charcoal)] text-white border-none rounded-[5px] px-2.5 py-1 font-[family-name:var(--font-body)] font-semibold text-[0.66rem] cursor-pointer flex-shrink-0 hover:bg-[var(--color-primary)]">
                    Add
                  </button>
                </div>
              ))}
              {libraryExercises.length === 0 && libraryLoaded && (
                <div className="text-xs text-[var(--color-slate)] text-center py-8">
                  No exercises found.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoteTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    INITIAL: "bg-[var(--color-accent)]/10 text-[var(--color-primary)]",
    PROGRESS: "bg-[var(--color-amber)]/10 text-[#9A7A0E]",
    GENERAL: "bg-[var(--color-background)] text-[var(--color-slate)]",
    DISCHARGE: "bg-[var(--color-red)]/10 text-[var(--color-red)]",
  };

  const labels: Record<string, string> = {
    INITIAL: "Initial",
    PROGRESS: "Progress",
    GENERAL: "General",
    DISCHARGE: "Discharge",
  };

  return (
    <span
      className={`text-[0.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded inline-block ${styles[type] ?? styles.GENERAL}`}
    >
      {labels[type] ?? type}
    </span>
  );
}

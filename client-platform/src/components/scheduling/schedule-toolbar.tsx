"use client";

import type { ScheduleViewMode } from "@/types/schedule";

interface Props {
  monthLabel: string;
  searchTerm: string;
  view: ScheduleViewMode;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSearchChange: (val: string) => void;
  onViewChange: (v: ScheduleViewMode) => void;
  onOpenSettings: () => void;
  onNewBooking: () => void;
}

export function ScheduleToolbar({
  monthLabel,
  searchTerm,
  view,
  onPrev,
  onNext,
  onToday,
  onSearchChange,
  onViewChange,
  onOpenSettings,
  onNewBooking,
}: Props) {
  const viewOptions: Array<{ n: ScheduleViewMode; label: string }> = [
    { n: 1, label: "Day" },
    { n: 5, label: "5-Day" },
    { n: 7, label: "Week" },
  ];

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[var(--color-border)] flex-wrap">
      <div className="flex items-center gap-2.5 flex-shrink-0">
        <button
          type="button"
          onClick={onPrev}
          className="w-7 h-7 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-[13px] text-[var(--color-slate)] hover:bg-[var(--color-card)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          aria-label="Previous"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onNext}
          className="w-7 h-7 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-[13px] text-[var(--color-slate)] hover:bg-[var(--color-card)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          aria-label="Next"
        >
          ›
        </button>
        <span className="font-[family-name:var(--font-display)] text-lg font-bold text-[var(--color-charcoal)] tracking-[0.3px] min-w-[140px]">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={onToday}
          className="bg-transparent text-[var(--color-slate)] px-2.5 py-1.5 text-xs font-semibold cursor-pointer rounded-md border-none hover:text-[var(--color-primary)] hover:bg-[var(--color-bg)] transition-colors"
        >
          Today
        </button>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 ml-auto flex-wrap">
        <div className="relative w-[220px]">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--color-slate)] pointer-events-none">
            ⌕
          </span>
          <input
            type="text"
            id="sch-search"
            placeholder="Search client..."
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-[30px] pr-7 py-1.5 border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-bg)] text-[var(--color-charcoal)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all"
            aria-label="Search client"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center text-sm text-[var(--color-slate)] cursor-pointer hover:bg-[var(--color-border)] hover:text-[var(--color-charcoal)] bg-transparent border-none"
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <div
          className="flex bg-[var(--color-bg)] border border-[var(--color-border)] rounded-md p-0.5 gap-0.5"
          role="tablist"
          aria-label="Calendar view"
        >
          {viewOptions.map((opt) => (
            <button
              key={opt.n}
              type="button"
              onClick={() => onViewChange(opt.n)}
              className={`bg-transparent border-none px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer rounded-[5px] uppercase tracking-wider transition-colors ${
                view === opt.n
                  ? "bg-[var(--color-card)] text-[var(--color-primary)] shadow-sm"
                  : "text-[var(--color-slate)] hover:text-[var(--color-charcoal)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-8 h-8 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-sm text-[var(--color-slate)] hover:bg-[var(--color-card)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors"
          aria-label="Settings"
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={onNewBooking}
          className="bg-[var(--color-primary)] text-white rounded-md px-3.5 py-1.5 text-xs font-semibold cursor-pointer border-none hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          + New Booking
        </button>
      </div>
    </div>
  );
}

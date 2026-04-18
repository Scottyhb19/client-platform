"use client";

import { useEffect, useState } from "react";
import type { ScheduleSettings } from "@/types/schedule";
import {
  SCH_END_HOUR,
  SCH_START_HOUR,
} from "@/utils/scheduleGrid";

interface Props {
  settings: ScheduleSettings;
  onClose: () => void;
  onSave: (next: ScheduleSettings) => void;
}

function hourOptions() {
  const options: { value: string; label: string }[] = [];
  for (let h = SCH_START_HOUR; h <= SCH_END_HOUR; h++) {
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    const ampm = h >= 12 && h < 24 ? "pm" : "am";
    options.push({
      value: `${String(h).padStart(2, "0")}:00`,
      label: `${h12}:00 ${ampm}`,
    });
  }
  return options;
}

export function ScheduleSettingsPanel({ settings, onClose, onSave }: Props) {
  const [start, setStart] = useState(settings.workingHoursStart);
  const [end, setEnd] = useState(settings.workingHoursEnd);
  const [defaultDur, setDefaultDur] = useState(settings.defaultDurationMinutes);
  const [granularity, setGranularity] = useState(
    settings.slotGranularityMinutes
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const [sh] = start.split(":").map(Number);
    const [eh] = end.split(":").map(Number);
    if (eh <= sh) {
      setError("Working hours end must be after start.");
      return;
    }
    onSave({
      workingHoursStart: start,
      workingHoursEnd: end,
      defaultDurationMinutes: defaultDur,
      slotGranularityMinutes: granularity,
    });
  }

  const options = hourOptions();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl border border-[var(--color-border)] shadow-xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
            Schedule Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-slate)] bg-transparent border-none cursor-pointer hover:text-[var(--color-charcoal)]"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Working hours
            </label>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-[var(--color-slate)] mt-1">
              Hours outside this range are dimmed on the grid so you don&apos;t
              book into dead time.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Default session duration
            </label>
            <select
              value={defaultDur}
              onChange={(e) => setDefaultDur(Number(e.target.value))}
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
            >
              {[15, 30, 45, 60, 75, 90, 120].map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Slot granularity
            </label>
            <div className="flex gap-2">
              {([15, 30, 60] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGranularity(g)}
                  className={`flex-1 h-10 rounded-lg border text-sm font-semibold cursor-pointer transition-colors ${
                    granularity === g
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]"
                      : "border-[var(--color-border)] bg-white text-[var(--color-slate)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {g} min
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--color-slate)] mt-1">
              Controls the smallest time increment for drag-to-create and start
              times.
            </p>
          </div>

          {error && (
            <div className="text-xs text-[var(--color-red)] font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-charcoal)] cursor-pointer hover:border-[var(--color-primary)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-4 py-2 rounded-lg text-sm font-semibold border-none bg-[var(--color-primary)] text-white cursor-pointer hover:bg-[var(--color-primary-dark)]"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

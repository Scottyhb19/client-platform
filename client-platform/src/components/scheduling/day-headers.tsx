"use client";

import { schAddDays, schDowShort, schSameDay } from "@/utils/scheduleGrid";

interface Props {
  anchor: Date;
  viewDays: number;
  today: Date;
}

export function DayHeaders({ anchor, viewDays, today }: Props) {
  return (
    <div
      className="grid border-b-2 border-[var(--color-border)] bg-[var(--color-card)] sticky top-0 z-[3]"
      style={{ gridTemplateColumns: `60px repeat(${viewDays}, 1fr)` }}
    >
      <div className="border-r border-[var(--color-border)] bg-[var(--color-bg)]" />
      {Array.from({ length: viewDays }).map((_, i) => {
        const d = schAddDays(anchor, i);
        const isToday = schSameDay(d, today);
        return (
          <div
            key={i}
            className={`py-2.5 px-2 text-center border-r border-[var(--color-border)] last:border-r-0 font-[family-name:var(--font-display)] ${
              isToday ? "bg-[var(--color-primary)]/5" : ""
            }`}
          >
            <div
              className={`text-[10px] font-bold uppercase tracking-wider ${
                isToday ? "text-[var(--color-primary)]" : "text-[var(--color-slate)]"
              }`}
            >
              {schDowShort(d)}
            </div>
            <div
              className={`text-lg font-bold mt-0.5 ${
                isToday ? "text-[var(--color-primary)]" : "text-[var(--color-charcoal)]"
              }`}
            >
              {d.getDate()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

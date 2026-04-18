"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  schAddDays,
  schDowShort,
  schFmtDate,
  schMonthShort,
  schSameDay,
  schStartOfWeek,
} from "@/utils/scheduleGrid";

interface Props {
  focus: Date;
  today: Date;
  datesWithAppts: Set<string>;
  onPickDate: (d: Date) => void;
}

const ROLODEX_DAYS = 70;
const FOCUS_INDEX = 35;

export function DateRolodex({ focus, today, datesWithAppts, onPickDate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  const cells = useMemo(() => {
    const start = schAddDays(focus, -FOCUS_INDEX);
    const weekStart = schStartOfWeek(focus);
    const weekEnd = schAddDays(weekStart, 6);

    const out: Array<{
      d: Date;
      iso: string;
      monthEdge: string | null;
      inWeek: boolean;
      isToday: boolean;
      hasAppts: boolean;
    }> = [];

    let lastMonth = -1;
    for (let i = 0; i < ROLODEX_DAYS; i++) {
      const d = schAddDays(start, i);
      const iso = schFmtDate(d);
      const monthEdge =
        d.getMonth() !== lastMonth && lastMonth !== -1
          ? schMonthShort(d)
          : null;
      lastMonth = d.getMonth();
      out.push({
        d,
        iso,
        monthEdge,
        inWeek: d >= weekStart && d <= weekEnd,
        isToday: schSameDay(d, today),
        hasAppts: datesWithAppts.has(iso),
      });
    }
    return out;
  }, [focus, today, datesWithAppts]);

  useEffect(() => {
    const wrap = scrollRef.current;
    const target = cellRefs.current.get(FOCUS_INDEX);
    if (!wrap || !target) return;
    wrap.scrollLeft =
      target.offsetLeft - wrap.clientWidth / 2 + target.clientWidth / 2;
  }, [focus]);

  function scroll(dir: 1 | -1) {
    scrollRef.current?.scrollBy({ left: dir * 180, behavior: "smooth" });
  }

  return (
    <div className="relative py-3 border-b border-[var(--color-border)] bg-gradient-to-b from-[#fafcfa] to-[var(--color-card)]">
      <button
        type="button"
        onClick={() => scroll(-1)}
        className="absolute top-0 bottom-0 left-0 w-12 flex items-center justify-center cursor-pointer z-[2] text-base text-[var(--color-slate)] hover:text-[var(--color-primary)] bg-gradient-to-r from-[var(--color-card)] from-40% to-transparent border-none"
        aria-label="Scroll rolodex left"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => scroll(1)}
        className="absolute top-0 bottom-0 right-0 w-12 flex items-center justify-center cursor-pointer z-[2] text-base text-[var(--color-slate)] hover:text-[var(--color-primary)] bg-gradient-to-l from-[var(--color-card)] from-40% to-transparent border-none"
        aria-label="Scroll rolodex right"
      >
        ›
      </button>
      <div
        ref={scrollRef}
        className="sch-rolodex flex gap-[2px] overflow-x-auto scroll-smooth px-12"
        role="listbox"
        aria-label="Date picker"
      >
        {cells.map((c, i) => (
          <button
            type="button"
            key={c.iso}
            ref={(el) => {
              if (el) cellRefs.current.set(i, el);
              else cellRefs.current.delete(i);
            }}
            onClick={() => onPickDate(c.d)}
            data-month={c.monthEdge ?? undefined}
            className={[
              "flex-shrink-0 w-11 flex flex-col items-center justify-center py-1.5 px-0.5 rounded-[10px] cursor-pointer transition-all border border-transparent relative",
              "hover:bg-[var(--color-bg)]",
              c.monthEdge && "sch-date-month-edge",
              c.inWeek && "bg-[var(--color-primary)]/[0.06]",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider leading-none font-[family-name:var(--font-display)] ${
                c.isToday
                  ? "text-[var(--color-primary)] font-bold"
                  : "text-[var(--color-slate)]"
              }`}
            >
              {schDowShort(c.d)}
            </span>
            {c.isToday ? (
              <span className="bg-[var(--color-primary)] text-white w-[26px] h-[26px] rounded-full flex items-center justify-center text-sm font-bold font-[family-name:var(--font-display)] mt-0.5">
                {c.d.getDate()}
              </span>
            ) : (
              <span
                className={`text-lg font-bold leading-[1.1] mt-[3px] font-[family-name:var(--font-display)] ${
                  c.inWeek
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-charcoal)]"
                }`}
              >
                {c.d.getDate()}
              </span>
            )}
            <span
              className={`w-1 h-1 rounded-full mt-[3px] ${
                c.hasAppts ? "bg-[var(--color-accent)]" : "bg-transparent"
              }`}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

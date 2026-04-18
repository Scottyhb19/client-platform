"use client";

import { useEffect, useRef, useState } from "react";
import type { ScheduleBooking, ScheduleSettings } from "@/types/schedule";
import {
  SCH_END_HOUR,
  SCH_SLOT_PX,
  SCH_START_HOUR,
  SCH_TOTAL_PX,
  layoutDayBookings,
  schAddDays,
  schFmtDate,
  schMinToTop,
  schSameDay,
  schTimeToMin,
} from "@/utils/scheduleGrid";
import { AppointmentCard } from "./appointment-card";
import { NowIndicator } from "./now-indicator";

interface Props {
  anchor: Date;
  viewDays: number;
  today: Date;
  bookings: ScheduleBooking[];
  searchTerm: string;
  settings: ScheduleSettings;
  onApptClick?: (booking: ScheduleBooking) => void;
  onDragCreate?: (date: Date, startMin: number, durationMin: number) => void;
}

export function TimeGrid({
  anchor,
  viewDays,
  today,
  bookings,
  searchTerm,
  settings,
  onApptClick,
  onDragCreate,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  useEffect(() => {
    if (wrapRef.current && !hasScrolled.current) {
      wrapRef.current.scrollTop = schMinToTop(schTimeToMin("07:00"));
      hasScrolled.current = true;
    }
  }, []);

  const hours = Array.from(
    { length: SCH_END_HOUR - SCH_START_HOUR },
    (_, i) => SCH_START_HOUR + i
  );

  const visibleDates = Array.from({ length: viewDays }, (_, i) =>
    schAddDays(anchor, i)
  );

  const anyApptVisible = bookings.some((b) => {
    if (!searchTerm) return true;
    const name = `${b.client.firstName} ${b.client.lastName}`.toLowerCase();
    return name.includes(searchTerm);
  });

  const showEmpty = !!searchTerm && !anyApptVisible;

  return (
    <div
      ref={wrapRef}
      className="relative overflow-auto bg-[var(--color-card)] flex-1"
    >
      {showEmpty ? (
        <div className="py-10 px-5 text-center text-sm text-[var(--color-slate)]">
          No bookings found for{" "}
          <strong className="text-[var(--color-charcoal)]">
            &ldquo;{searchTerm}&rdquo;
          </strong>{" "}
          in this view. Try a different date range or clear the search.
        </div>
      ) : (
        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `60px repeat(${viewDays}, 1fr)`,
            minHeight: `${SCH_TOTAL_PX}px`,
          }}
        >
          <div className="sch-grid-time sch-time-col border-r border-[var(--color-border)] bg-[var(--color-bg)] sticky left-0 z-[2]">
            {hours.map((h) =>
              [0, 1, 2, 3].map((q) => {
                const isHour = q === 0;
                const isHalf = q === 2;
                const label12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
                const ampm = h >= 12 ? "pm" : "am";
                return (
                  <div
                    key={`${h}-${q}`}
                    className={`sch-quarter ${isHour ? "hour" : ""} ${isHalf ? "half" : ""}`}
                    data-time={isHour ? `${label12}${ampm}` : undefined}
                  />
                );
              })
            )}
          </div>

          {visibleDates.map((d) => (
            <DayColumn
              key={d.toISOString()}
              date={d}
              isToday={schSameDay(d, today)}
              bookings={bookings.filter((b) => b.date === schFmtDate(d))}
              searchTerm={searchTerm}
              settings={settings}
              onApptClick={onApptClick}
              onDragCreate={onDragCreate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DayColumnProps {
  date: Date;
  isToday: boolean;
  bookings: ScheduleBooking[];
  searchTerm: string;
  settings: ScheduleSettings;
  onApptClick?: (booking: ScheduleBooking) => void;
  onDragCreate?: (date: Date, startMin: number, durationMin: number) => void;
}

// Snap a pixel offset to the nearest N-minute slot (in minutes since midnight).
function pxToMin(y: number, granularity: number): number {
  const minsSinceStart = Math.max(
    0,
    Math.round((y / SCH_SLOT_PX) * 15 / granularity) * granularity
  );
  return SCH_START_HOUR * 60 + minsSinceStart;
}

function DayColumn({
  date,
  isToday,
  bookings,
  searchTerm,
  settings,
  onApptClick,
  onDragCreate,
}: DayColumnProps) {
  const colRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    startMin: number;
    endMin: number;
  } | null>(null);

  const hours = Array.from(
    { length: SCH_END_HOUR - SCH_START_HOUR },
    (_, i) => SCH_START_HOUR + i
  );
  const positioned = layoutDayBookings(bookings);

  const workStartMin = schTimeToMin(settings.workingHoursStart);
  const workEndMin = schTimeToMin(settings.workingHoursEnd);
  const preWorkTop = 0;
  const preWorkHeight = schMinToTop(workStartMin);
  const postWorkTop = schMinToTop(workEndMin);
  const postWorkHeight = SCH_TOTAL_PX - postWorkTop;

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!onDragCreate) return;
    // Only start drag on background clicks — not on cards or their children.
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    if (!colRef.current) return;

    const granularity = settings.slotGranularityMinutes;
    const rect = colRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const startMin = pxToMin(y, granularity);

    e.preventDefault();
    setDrag({ startMin, endMin: startMin + granularity });

    function onMove(ev: MouseEvent) {
      if (!colRef.current) return;
      const r = colRef.current.getBoundingClientRect();
      const dy = ev.clientY - r.top;
      const newMin = pxToMin(dy, granularity);
      setDrag((prev) =>
        prev
          ? {
              ...prev,
              endMin: Math.max(newMin, prev.startMin + granularity),
            }
          : prev
      );
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag((prev) => {
        if (prev && onDragCreate) {
          const duration = prev.endMin - prev.startMin;
          if (duration >= granularity) {
            onDragCreate(date, prev.startMin, duration);
          }
        }
        return null;
      });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const dragTop = drag ? schMinToTop(drag.startMin) : 0;
  const dragHeight = drag
    ? ((drag.endMin - drag.startMin) / 15) * SCH_SLOT_PX - 1
    : 0;

  return (
    <div
      ref={colRef}
      onMouseDown={handleMouseDown}
      className={`sch-grid-body border-r border-[var(--color-border)] last:border-r-0 relative select-none ${
        isToday ? "bg-[var(--color-accent)]/[0.015]" : "bg-[var(--color-card)]"
      } ${onDragCreate ? "cursor-crosshair" : ""}`}
    >
      {preWorkHeight > 0 && (
        <div
          className="absolute left-0 right-0 bg-[var(--color-bg)]/70 pointer-events-none z-0"
          style={{ top: `${preWorkTop}px`, height: `${preWorkHeight}px` }}
          aria-hidden="true"
        />
      )}
      {postWorkHeight > 0 && (
        <div
          className="absolute left-0 right-0 bg-[var(--color-bg)]/70 pointer-events-none z-0"
          style={{ top: `${postWorkTop}px`, height: `${postWorkHeight}px` }}
          aria-hidden="true"
        />
      )}

      {hours.map((h) =>
        [0, 1, 2, 3].map((q) => {
          const isHour = q === 0;
          const isHalf = q === 2;
          return (
            <div
              key={`${h}-${q}`}
              className={`sch-quarter ${isHour ? "hour" : ""} ${isHalf ? "half" : ""}`}
            />
          );
        })
      )}

      {isToday && <NowIndicator />}

      {positioned.map((p) => {
        const name =
          `${p.booking.client.firstName} ${p.booking.client.lastName}`.toLowerCase();
        const matches = !searchTerm || name.includes(searchTerm);
        const dimmed = !!searchTerm && !matches;
        const highlighted = !!searchTerm && matches;
        return (
          <AppointmentCard
            key={p.booking.id}
            booking={p.booking}
            top={p.top}
            height={p.height}
            column={p.column}
            columnCount={p.columnCount}
            dimmed={dimmed}
            highlighted={highlighted}
            onClick={onApptClick}
          />
        );
      })}

      {drag && (
        <div
          className="absolute left-[3px] right-[3px] rounded-md bg-[var(--color-accent)]/30 border-l-[3px] border-l-[var(--color-accent)] pointer-events-none z-[2]"
          style={{ top: `${dragTop}px`, height: `${dragHeight}px` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

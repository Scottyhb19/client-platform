"use client";

import { useEffect, useRef } from "react";
import type { ScheduleBooking } from "@/types/schedule";
import {
  SCH_END_HOUR,
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
  onApptClick?: (booking: ScheduleBooking) => void;
}

export function TimeGrid({
  anchor,
  viewDays,
  today,
  bookings,
  searchTerm,
  onApptClick,
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
              onApptClick={onApptClick}
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
  onApptClick?: (booking: ScheduleBooking) => void;
}

function DayColumn({
  isToday,
  bookings,
  searchTerm,
  onApptClick,
}: DayColumnProps) {
  const hours = Array.from(
    { length: SCH_END_HOUR - SCH_START_HOUR },
    (_, i) => SCH_START_HOUR + i
  );
  const positioned = layoutDayBookings(bookings);

  return (
    <div
      className={`sch-grid-body border-r border-[var(--color-border)] last:border-r-0 relative ${
        isToday ? "bg-[var(--color-accent)]/[0.015]" : "bg-[var(--color-card)]"
      }`}
    >
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
    </div>
  );
}

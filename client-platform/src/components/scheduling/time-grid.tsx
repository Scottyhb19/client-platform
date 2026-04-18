"use client";

import { useEffect, useRef, useState } from "react";
import type { ScheduleBooking, ScheduleSettings } from "@/types/schedule";
import {
  SCH_END_HOUR,
  SCH_SLOT_PX,
  SCH_START_HOUR,
  SCH_TOTAL_MINUTES,
  SCH_TOTAL_PX,
  layoutDayBookings,
  schAddDays,
  schFmtDate,
  schMinToTop,
  schSameDay,
  schTimeToMin,
} from "@/utils/scheduleGrid";
import { AppointmentCard, type InteractionType } from "./appointment-card";
import { NowIndicator } from "./now-indicator";

const DRAG_PX_THRESHOLD = 3;

export interface ApptUpdatePatch {
  date: string;
  startTime: string;
  durationMinutes: number;
}

interface Props {
  anchor: Date;
  viewDays: number;
  today: Date;
  bookings: ScheduleBooking[];
  searchTerm: string;
  settings: ScheduleSettings;
  onApptClick?: (booking: ScheduleBooking) => void;
  onApptUpdate?: (bookingId: string, patch: ApptUpdatePatch) => void;
  onDragCreate?: (date: Date, startMin: number, durationMin: number) => void;
}

type ApptInteraction =
  | {
      type: "move";
      bookingId: string;
      origDateIso: string;
      origStartMin: number;
      origDur: number;
      startClientY: number;
      startClientX: number;
      currentDateIso: string;
      currentStartMin: number;
      moved: boolean;
    }
  | {
      type: "resize-bottom";
      bookingId: string;
      dateIso: string;
      origStartMin: number;
      origDur: number;
      startClientY: number;
      currentDur: number;
      moved: boolean;
    };

function snap(mins: number, granularity: number): number {
  return Math.round(mins / granularity) * granularity;
}

function clampStartMin(mins: number, dur: number): number {
  const minStart = SCH_START_HOUR * 60;
  const maxStart = SCH_START_HOUR * 60 + SCH_TOTAL_MINUTES - dur;
  return Math.min(Math.max(mins, minStart), maxStart);
}

function clampDur(dur: number, startMin: number, granularity: number): number {
  const maxDur =
    SCH_START_HOUR * 60 + SCH_TOTAL_MINUTES - startMin;
  return Math.min(Math.max(dur, granularity), maxDur);
}

function minutesToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function TimeGrid({
  anchor,
  viewDays,
  today,
  bookings,
  searchTerm,
  settings,
  onApptClick,
  onApptUpdate,
  onDragCreate,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const [interaction, setInteraction] = useState<ApptInteraction | null>(null);

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
  const visibleIsoSet = new Set(visibleDates.map(schFmtDate));

  const anyApptVisible = bookings.some((b) => {
    if (!searchTerm) return true;
    const name = `${b.client.firstName} ${b.client.lastName}`.toLowerCase();
    return name.includes(searchTerm);
  });

  const showEmpty = !!searchTerm && !anyApptVisible;

  // Live interaction ghost — the booking being dragged/resized, overlaid.
  function handleInteractionStart(
    booking: ScheduleBooking,
    type: InteractionType,
    e: React.MouseEvent
  ) {
    if (!onApptUpdate) return;
    e.preventDefault();
    const granularity = settings.slotGranularityMinutes;

    if (type === "move") {
      setInteraction({
        type: "move",
        bookingId: booking.id,
        origDateIso: booking.date,
        origStartMin: schTimeToMin(booking.startTime),
        origDur: booking.durationMinutes,
        startClientY: e.clientY,
        startClientX: e.clientX,
        currentDateIso: booking.date,
        currentStartMin: schTimeToMin(booking.startTime),
        moved: false,
      });
    } else {
      setInteraction({
        type: "resize-bottom",
        bookingId: booking.id,
        dateIso: booking.date,
        origStartMin: schTimeToMin(booking.startTime),
        origDur: booking.durationMinutes,
        startClientY: e.clientY,
        currentDur: booking.durationMinutes,
        moved: false,
      });
    }

    function onMove(ev: MouseEvent) {
      const dy = ev.clientY - e.clientY;
      const dxPx = ev.clientX - e.clientX;
      const movedEnough =
        Math.abs(dy) > DRAG_PX_THRESHOLD || Math.abs(dxPx) > DRAG_PX_THRESHOLD;

      const deltaMin = snap((dy / SCH_SLOT_PX) * 15, granularity);

      setInteraction((prev) => {
        if (!prev) return prev;
        if (prev.type === "move") {
          let destIso = prev.origDateIso;
          const dayEl = document
            .elementFromPoint(ev.clientX, ev.clientY)
            ?.closest<HTMLElement>("[data-sch-day]");
          if (dayEl?.dataset.schDay) destIso = dayEl.dataset.schDay;

          const newStart = clampStartMin(
            prev.origStartMin + deltaMin,
            prev.origDur
          );
          return {
            ...prev,
            currentDateIso: destIso,
            currentStartMin: newStart,
            moved: prev.moved || movedEnough,
          };
        }
        const newDur = clampDur(
          prev.origDur + deltaMin,
          prev.origStartMin,
          granularity
        );
        return {
          ...prev,
          currentDur: newDur,
          moved: prev.moved || movedEnough,
        };
      });
    }

    function onUp(ev: MouseEvent) {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setInteraction((prev) => {
        if (!prev) return null;
        if (!prev.moved) {
          // No drag happened — treat as click (AppointmentCard handles onClick).
          return null;
        }
        // Commit the update. Swallow the click that follows.
        ev.preventDefault();
        if (prev.type === "move" && onApptUpdate) {
          if (
            prev.currentDateIso !== prev.origDateIso ||
            prev.currentStartMin !== prev.origStartMin
          ) {
            onApptUpdate(prev.bookingId, {
              date: prev.currentDateIso,
              startTime: minutesToHHMM(prev.currentStartMin),
              durationMinutes: prev.origDur,
            });
          }
        } else if (prev.type === "resize-bottom" && onApptUpdate) {
          if (prev.currentDur !== prev.origDur) {
            onApptUpdate(prev.bookingId, {
              date: prev.dateIso,
              startTime: minutesToHHMM(prev.origStartMin),
              durationMinutes: prev.currentDur,
            });
          }
        }
        return null;
      });
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Block click-to-edit when the mouseup ended a drag.
  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      if (interaction?.moved) {
        e.stopPropagation();
        e.preventDefault();
      }
    }
    window.addEventListener("click", onClickCapture, true);
    return () => window.removeEventListener("click", onClickCapture, true);
  }, [interaction]);

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

          {visibleDates.map((d) => {
            const iso = schFmtDate(d);
            return (
              <DayColumn
                key={iso}
                date={d}
                dateIso={iso}
                isToday={schSameDay(d, today)}
                bookings={bookings.filter((b) => b.date === iso)}
                searchTerm={searchTerm}
                settings={settings}
                interaction={interaction}
                onApptClick={onApptClick}
                onInteractionStart={onApptUpdate ? handleInteractionStart : undefined}
                onDragCreate={onDragCreate}
              />
            );
          })}
        </div>
      )}

      {interaction && interaction.moved && visibleIsoSet.has(
        interaction.type === "move"
          ? interaction.currentDateIso
          : interaction.dateIso
      ) ? (
        <InteractionGhost
          interaction={interaction}
          bookings={bookings}
          anchor={anchor}
          viewDays={viewDays}
        />
      ) : null}
    </div>
  );
}

interface DayColumnProps {
  date: Date;
  dateIso: string;
  isToday: boolean;
  bookings: ScheduleBooking[];
  searchTerm: string;
  settings: ScheduleSettings;
  interaction: ApptInteraction | null;
  onApptClick?: (booking: ScheduleBooking) => void;
  onInteractionStart?: (
    booking: ScheduleBooking,
    type: InteractionType,
    e: React.MouseEvent
  ) => void;
  onDragCreate?: (date: Date, startMin: number, durationMin: number) => void;
}

function pxToMin(y: number, granularity: number): number {
  const minsSinceStart = Math.max(
    0,
    Math.round(((y / SCH_SLOT_PX) * 15) / granularity) * granularity
  );
  return SCH_START_HOUR * 60 + minsSinceStart;
}

function DayColumn({
  date,
  dateIso,
  isToday,
  bookings,
  searchTerm,
  settings,
  interaction,
  onApptClick,
  onInteractionStart,
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
  const preWorkHeight = schMinToTop(workStartMin);
  const postWorkTop = schMinToTop(workEndMin);
  const postWorkHeight = SCH_TOTAL_PX - postWorkTop;

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!onDragCreate) return;
    const target = e.target as HTMLElement;
    // Don't trigger background drag when starting on a card or resize handle.
    if (target.closest("[data-sch-appt]")) return;
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
      data-sch-day={dateIso}
      onMouseDown={handleMouseDown}
      className={`sch-grid-body border-r border-[var(--color-border)] last:border-r-0 relative select-none ${
        isToday ? "bg-[var(--color-accent)]/[0.015]" : "bg-[var(--color-card)]"
      } ${onDragCreate ? "cursor-crosshair" : ""}`}
    >
      {preWorkHeight > 0 && (
        <div
          className="absolute left-0 right-0 bg-[var(--color-bg)]/70 pointer-events-none z-0"
          style={{ top: `0px`, height: `${preWorkHeight}px` }}
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
        const isInteracting = interaction?.bookingId === p.booking.id;
        return (
          <div key={p.booking.id} data-sch-appt>
            <AppointmentCard
              booking={p.booking}
              top={p.top}
              height={p.height}
              column={p.column}
              columnCount={p.columnCount}
              dimmed={dimmed}
              highlighted={highlighted}
              isInteracting={isInteracting}
              onClick={onApptClick}
              onInteractionStart={onInteractionStart}
            />
          </div>
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

interface GhostProps {
  interaction: ApptInteraction;
  bookings: ScheduleBooking[];
  anchor: Date;
  viewDays: number;
}

function InteractionGhost({
  interaction,
  bookings,
  anchor,
  viewDays,
}: GhostProps) {
  const booking = bookings.find((b) => b.id === interaction.bookingId);
  if (!booking) return null;

  const targetIso =
    interaction.type === "move" ? interaction.currentDateIso : interaction.dateIso;
  const targetStartMin =
    interaction.type === "move"
      ? interaction.currentStartMin
      : interaction.origStartMin;
  const targetDur =
    interaction.type === "resize-bottom"
      ? interaction.currentDur
      : interaction.origDur;

  const targetDayIndex = Array.from({ length: viewDays }, (_, i) =>
    schFmtDate(schAddDays(anchor, i))
  ).indexOf(targetIso);

  if (targetDayIndex < 0) return null;

  const top = schMinToTop(targetStartMin);
  const height = (targetDur / 15) * SCH_SLOT_PX - 2;

  return (
    <div
      className="absolute pointer-events-none rounded-md bg-[var(--color-primary)]/80 border-l-[3px] border-l-[var(--color-primary-dark)] shadow-lg z-[4] text-white text-[10px] font-semibold px-1.5 py-1"
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(60px + (100% - 60px) * ${targetDayIndex} / ${viewDays} + 3px)`,
        width: `calc((100% - 60px) / ${viewDays} - 6px)`,
      }}
      aria-hidden="true"
    >
      <div className="truncate">
        {booking.client.firstName} {booking.client.lastName}
      </div>
      <div className="opacity-80">
        {minutesToHHMM(targetStartMin)} · {targetDur} min
      </div>
    </div>
  );
}


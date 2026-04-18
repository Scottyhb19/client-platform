"use client";

import type { ScheduleBooking } from "@/types/schedule";
import {
  SCH_SLOT_PX,
  schMinutesToLabel,
  schTimeToMin,
  schTypeClass,
} from "@/utils/scheduleGrid";

export type InteractionType = "move" | "resize-bottom";

interface Props {
  booking: ScheduleBooking;
  top: number;
  height: number;
  column: number;
  columnCount: number;
  dimmed: boolean;
  highlighted: boolean;
  isInteracting?: boolean;
  onClick?: (booking: ScheduleBooking) => void;
  onInteractionStart?: (
    booking: ScheduleBooking,
    type: InteractionType,
    e: React.MouseEvent
  ) => void;
}

export function AppointmentCard({
  booking,
  top,
  height,
  column,
  columnCount,
  dimmed,
  highlighted,
  isInteracting,
  onClick,
  onInteractionStart,
}: Props) {
  const startMin = schTimeToMin(booking.startTime);
  const endMin = startMin + booking.durationMinutes;
  const tooltip = `${booking.client.firstName} ${booking.client.lastName} \u2014 ${booking.type ?? "Session"}\n${schMinutesToLabel(startMin)} \u2013 ${schMinutesToLabel(endMin)}`;
  const typeClass = schTypeClass(booking.type);
  const widthPct = 100 / columnCount;

  const classes = [
    "absolute rounded-md pl-1.5 pr-1.5 py-1 text-[11px] font-semibold overflow-hidden transition-shadow text-white shadow-sm border-l-[3px] select-none",
    onInteractionStart ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
    `sch-appt-${typeClass.replace("type-", "")}`,
    booking.cancelled && "sch-appt-cancelled",
    dimmed && "opacity-20 grayscale",
    highlighted && "ring-2 ring-[var(--color-accent)]",
    isInteracting ? "opacity-40 z-[1]" : "z-[1] hover:shadow-md hover:z-[2]",
  ]
    .filter(Boolean)
    .join(" ");

  const canShowTime = height >= 36;

  function handleBodyMouseDown(e: React.MouseEvent) {
    if (!onInteractionStart) return;
    // Don't start drag if the user clicked on the resize handle (it'll handle its own mousedown)
    const target = e.target as HTMLElement;
    if (target.dataset.resizeHandle) return;
    onInteractionStart(booking, "move", e);
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    if (!onInteractionStart) return;
    e.stopPropagation();
    onInteractionStart(booking, "resize-bottom", e);
  }

  function handleClick(e: React.MouseEvent) {
    // If the parent handled an interaction (drag/resize), it'll call preventDefault on mouseup.
    // A plain click with no movement falls through here.
    if (e.defaultPrevented) return;
    onClick?.(booking);
  }

  return (
    <div
      className={classes}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${column * widthPct}% + 3px)`,
        width: `calc(${widthPct}% - 6px)`,
        minHeight: `${SCH_SLOT_PX * 2 - 2}px`,
      }}
      title={tooltip}
      onMouseDown={handleBodyMouseDown}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      <div className="font-bold text-[11px] leading-tight truncate text-left pointer-events-none">
        {booking.client.firstName} {booking.client.lastName}
      </div>
      <div className="text-[10px] opacity-85 font-medium leading-tight truncate text-left pointer-events-none">
        {booking.type ?? "Session"}
      </div>
      {canShowTime && (
        <div className="text-[9px] opacity-70 font-medium mt-0.5 text-left pointer-events-none">
          {schMinutesToLabel(startMin)}
        </div>
      )}
      {onInteractionStart && (
        <div
          data-resize-handle="bottom"
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 right-0 bottom-0 h-[6px] cursor-ns-resize hover:bg-white/25"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

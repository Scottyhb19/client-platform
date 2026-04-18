"use client";

import type { ScheduleBooking } from "@/types/schedule";
import {
  SCH_SLOT_PX,
  schMinutesToLabel,
  schTimeToMin,
  schTypeClass,
} from "@/utils/scheduleGrid";

interface Props {
  booking: ScheduleBooking;
  top: number;
  height: number;
  column: number;
  columnCount: number;
  dimmed: boolean;
  highlighted: boolean;
  onClick?: (booking: ScheduleBooking) => void;
}

export function AppointmentCard({
  booking,
  top,
  height,
  column,
  columnCount,
  dimmed,
  highlighted,
  onClick,
}: Props) {
  const startMin = schTimeToMin(booking.startTime);
  const endMin = startMin + booking.durationMinutes;
  const tooltip = `${booking.client.firstName} ${booking.client.lastName} \u2014 ${booking.type ?? "Session"}\n${schMinutesToLabel(startMin)} \u2013 ${schMinutesToLabel(endMin)}`;
  const typeClass = schTypeClass(booking.type);
  const widthPct = 100 / columnCount;

  const classes = [
    "absolute rounded-md pl-1.5 pr-1.5 py-1 text-[11px] font-semibold cursor-pointer overflow-hidden transition-all text-white shadow-sm border-l-[3px] z-[1]",
    `sch-appt-${typeClass.replace("type-", "")}`,
    booking.cancelled && "sch-appt-cancelled",
    dimmed && "opacity-20 grayscale",
    highlighted && "ring-2 ring-[var(--color-accent)] z-[2]",
    "hover:-translate-y-[1px] hover:shadow-md hover:z-[2]",
  ]
    .filter(Boolean)
    .join(" ");

  const canShowTime = height >= 36;

  return (
    <button
      type="button"
      className={classes}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        left: `calc(${column * widthPct}% + 3px)`,
        width: `calc(${widthPct}% - 6px)`,
        minHeight: `${SCH_SLOT_PX * 2 - 2}px`,
      }}
      title={tooltip}
      onClick={() => onClick?.(booking)}
    >
      <div className="font-bold text-[11px] leading-tight truncate text-left">
        {booking.client.firstName} {booking.client.lastName}
      </div>
      <div className="text-[10px] opacity-85 font-medium leading-tight truncate text-left">
        {booking.type ?? "Session"}
      </div>
      {canShowTime && (
        <div className="text-[9px] opacity-70 font-medium mt-0.5 text-left">
          {schMinutesToLabel(startMin)}
        </div>
      )}
    </button>
  );
}

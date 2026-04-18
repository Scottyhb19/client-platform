import type { Booking, BookingStatus } from "@/generated/prisma/client";

export const DEFAULT_TIMEZONE = "Australia/Sydney";

export interface BookingDTO {
  id: string;
  clientId: string;
  practitionerId: string;
  client: { firstName: string; lastName: string };
  startTimeIso: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  type: string | null;
  status: BookingStatus;
  cancelled: boolean;
  notes: string | null;
}

type BookingWithClient = Booking & {
  client: { firstName: string; lastName: string };
};

function getTzParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const map = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: map.get("year") ?? "",
    month: map.get("month") ?? "",
    day: map.get("day") ?? "",
    hour: (map.get("hour") ?? "00").replace("24", "00"),
    minute: map.get("minute") ?? "00",
  };
}

export function toBookingDTO(
  booking: BookingWithClient,
  timeZone: string = DEFAULT_TIMEZONE
): BookingDTO {
  const start = booking.startTime;
  const end = new Date(start.getTime() + booking.durationMinutes * 60_000);

  const s = getTzParts(start, timeZone);
  const e = getTzParts(end, timeZone);

  return {
    id: booking.id,
    clientId: booking.clientId,
    practitionerId: booking.practitionerId,
    client: booking.client,
    startTimeIso: start.toISOString(),
    date: `${s.year}-${s.month}-${s.day}`,
    startTime: `${s.hour}:${s.minute}`,
    endTime: `${e.hour}:${e.minute}`,
    durationMinutes: booking.durationMinutes,
    type: booking.type,
    status: booking.status,
    cancelled: booking.status === "CANCELLED",
    notes: booking.notes,
  };
}

export function dateTimeInZone(
  dateStr: string,
  timeStr: string,
  timeZone: string = DEFAULT_TIMEZONE
): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);

  const utcGuess = Date.UTC(y, m - 1, d, hh, mm);
  const guess = new Date(utcGuess);
  const parts = getTzParts(guess, timeZone);
  const asLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute)
  );
  const offset = utcGuess - asLocal;
  return new Date(utcGuess + offset);
}

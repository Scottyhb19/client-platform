// Pure, side-effect-free helpers for the schedule grid.
// No DOM access, no state, no `new Date()` on its own — callers supply time.
// Keep these deterministic: every input must map to exactly one output.

export const SCH_START_HOUR = 5;
export const SCH_END_HOUR = 20;
export const SCH_SLOT_PX = 12;

export const SCH_TOTAL_MINUTES = (SCH_END_HOUR - SCH_START_HOUR) * 60;
export const SCH_TOTAL_PX = (SCH_TOTAL_MINUTES / 15) * SCH_SLOT_PX;

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function schTimeToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function schMinToTop(mins: number): number {
  return ((mins - SCH_START_HOUR * 60) / 15) * SCH_SLOT_PX;
}

export function schFmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function schAddDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

export function schStartOfWeek(d: Date): Date {
  const nd = new Date(d);
  const day = nd.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  nd.setDate(nd.getDate() + diff);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

export function schSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function schDowShort(d: Date): string {
  return DOW_SHORT[d.getDay()];
}

export function schMonthShort(d: Date): string {
  return MONTH_SHORT[d.getMonth()];
}

export function schMonthLong(d: Date): string {
  return MONTH_LONG[d.getMonth()];
}

export function schFmt12Hour(hour: number, minute: number): string {
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const ampm = hour >= 12 ? "pm" : "am";
  return `${h12}:${String(minute).padStart(2, "0")}${ampm}`;
}

export function schMinutesToLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return schFmt12Hour(h, m);
}

const TYPE_CLASS_MAP: Record<string, string> = {
  review: "type-review",
  assessment: "type-assessment",
  "initial assessment": "type-initial",
  "new client": "type-initial",
  telehealth: "type-telehealth",
  handover: "type-handover",
  "vald test": "type-test",
};

export function schTypeClass(type: string | null | undefined): string {
  if (!type) return "type-review";
  return TYPE_CLASS_MAP[type.toLowerCase()] ?? "type-review";
}

export interface PositionedBooking<T> {
  booking: T;
  top: number;
  height: number;
  column: number;
  columnCount: number;
}

interface HasTimeSpan {
  startTime: string;
  durationMinutes: number;
}

// Lay out overlapping bookings in side-by-side columns.
// Two bookings "overlap" when their time ranges intersect. The columns are
// computed greedily per cluster: the first free column is reused, and the
// cluster's column count is propagated to every member so each card knows
// how wide to render.
export function layoutDayBookings<T extends HasTimeSpan>(
  bookings: T[]
): PositionedBooking<T>[] {
  const sorted = [...bookings].sort((a, b) => {
    const sa = schTimeToMin(a.startTime);
    const sb = schTimeToMin(b.startTime);
    if (sa !== sb) return sa - sb;
    return b.durationMinutes - a.durationMinutes;
  });

  const placements: Array<{
    booking: T;
    startMin: number;
    endMin: number;
    column: number;
    cluster: number;
  }> = [];
  const clusters: { column: number; endMin: number }[][] = [];
  let currentCluster: { column: number; endMin: number }[] = [];
  let currentClusterEnd = -1;
  let clusterIndex = -1;

  for (const b of sorted) {
    const startMin = schTimeToMin(b.startTime);
    const endMin = startMin + b.durationMinutes;

    if (startMin >= currentClusterEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      currentClusterEnd = endMin;
      clusterIndex = clusters.length;
    } else {
      currentClusterEnd = Math.max(currentClusterEnd, endMin);
    }

    let column = 0;
    while (
      currentCluster.some((c) => c.column === column && c.endMin > startMin)
    ) {
      column++;
    }
    currentCluster.push({ column, endMin });

    placements.push({
      booking: b,
      startMin,
      endMin,
      column,
      cluster: clusterIndex,
    });
  }
  clusters.push(currentCluster);

  const columnCounts = clusters.map((c) =>
    c.reduce((max, p) => Math.max(max, p.column + 1), 0)
  );

  return placements.map((p) => ({
    booking: p.booking,
    top: schMinToTop(p.startMin),
    height: ((p.endMin - p.startMin) / 15) * SCH_SLOT_PX - 2,
    column: p.column,
    columnCount: columnCounts[p.cluster] ?? 1,
  }));
}

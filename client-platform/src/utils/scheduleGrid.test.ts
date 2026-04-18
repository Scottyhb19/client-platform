import { describe, expect, it } from "vitest";
import {
  SCH_SLOT_PX,
  SCH_START_HOUR,
  layoutDayBookings,
  schAddDays,
  schDowShort,
  schFmtDate,
  schMinToTop,
  schMonthLong,
  schMonthShort,
  schSameDay,
  schStartOfWeek,
  schTimeToMin,
  schTypeClass,
} from "./scheduleGrid";

describe("schTimeToMin", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(schTimeToMin("00:00")).toBe(0);
    expect(schTimeToMin("01:00")).toBe(60);
    expect(schTimeToMin("08:30")).toBe(510);
    expect(schTimeToMin("12:45")).toBe(765);
    expect(schTimeToMin("23:59")).toBe(1439);
  });
});

describe("schMinToTop", () => {
  it("returns 0 for the start hour", () => {
    expect(schMinToTop(SCH_START_HOUR * 60)).toBe(0);
  });

  it("returns SCH_SLOT_PX for the first 15 minutes past start", () => {
    expect(schMinToTop(SCH_START_HOUR * 60 + 15)).toBe(SCH_SLOT_PX);
  });

  it("returns 48px per hour", () => {
    expect(schMinToTop((SCH_START_HOUR + 1) * 60)).toBe(48);
  });

  it("is linear in minutes", () => {
    const a = schMinToTop(SCH_START_HOUR * 60 + 30);
    const b = schMinToTop(SCH_START_HOUR * 60 + 60);
    expect(b - a).toBe(a);
  });
});

describe("schStartOfWeek", () => {
  it("returns the Monday of the week for a Wednesday", () => {
    const wed = new Date(2026, 3, 15);
    const mon = schStartOfWeek(wed);
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(13);
    expect(mon.getMonth()).toBe(3);
    expect(mon.getFullYear()).toBe(2026);
  });

  it("returns the Monday of the week for a Sunday (previous Monday)", () => {
    const sun = new Date(2026, 3, 19);
    const mon = schStartOfWeek(sun);
    expect(mon.getDay()).toBe(1);
    expect(mon.getDate()).toBe(13);
  });

  it("is idempotent on a Monday", () => {
    const mon = new Date(2026, 3, 13);
    expect(schStartOfWeek(mon).getDate()).toBe(13);
  });

  it("crosses month boundaries", () => {
    const wed = new Date(2026, 4, 6);
    const mon = schStartOfWeek(wed);
    expect(mon.getMonth()).toBe(4);
    expect(mon.getDate()).toBe(4);
  });

  it("does not mutate input", () => {
    const d = new Date(2026, 3, 15);
    schStartOfWeek(d);
    expect(d.getDate()).toBe(15);
  });
});

describe("schAddDays", () => {
  it("adds positive days", () => {
    const d = new Date(2026, 3, 15);
    expect(schAddDays(d, 2).getDate()).toBe(17);
  });

  it("subtracts days", () => {
    const d = new Date(2026, 3, 15);
    expect(schAddDays(d, -3).getDate()).toBe(12);
  });

  it("handles month rollover", () => {
    const d = new Date(2026, 3, 30);
    const r = schAddDays(d, 2);
    expect(r.getMonth()).toBe(4);
    expect(r.getDate()).toBe(2);
  });

  it("does not mutate input", () => {
    const d = new Date(2026, 3, 15);
    schAddDays(d, 5);
    expect(d.getDate()).toBe(15);
  });
});

describe("schFmtDate", () => {
  it("returns YYYY-MM-DD", () => {
    expect(schFmtDate(new Date(2026, 3, 15))).toBe("2026-04-15");
  });

  it("zero-pads month and day", () => {
    expect(schFmtDate(new Date(2026, 0, 1))).toBe("2026-01-01");
  });
});

describe("schSameDay", () => {
  it("returns true for same Y/M/D", () => {
    expect(
      schSameDay(new Date(2026, 3, 15, 8), new Date(2026, 3, 15, 14))
    ).toBe(true);
  });

  it("returns false for different days", () => {
    expect(
      schSameDay(new Date(2026, 3, 15), new Date(2026, 3, 16))
    ).toBe(false);
  });
});

describe("schDowShort / schMonthShort / schMonthLong", () => {
  it("formats expected labels", () => {
    const d = new Date(2026, 3, 15);
    expect(schDowShort(d)).toBe("Wed");
    expect(schMonthShort(d)).toBe("Apr");
    expect(schMonthLong(d)).toBe("April");
  });
});

describe("schTypeClass", () => {
  it("maps types to CSS class names", () => {
    expect(schTypeClass("Review")).toBe("type-review");
    expect(schTypeClass("Initial Assessment")).toBe("type-initial");
    expect(schTypeClass("New Client")).toBe("type-initial");
    expect(schTypeClass("Assessment")).toBe("type-assessment");
    expect(schTypeClass("Telehealth")).toBe("type-telehealth");
    expect(schTypeClass("Handover")).toBe("type-handover");
    expect(schTypeClass("VALD Test")).toBe("type-test");
  });

  it("falls back to type-review for unknown and null", () => {
    expect(schTypeClass("Whatever")).toBe("type-review");
    expect(schTypeClass(null)).toBe("type-review");
    expect(schTypeClass(undefined)).toBe("type-review");
  });
});

describe("layoutDayBookings", () => {
  it("places non-overlapping bookings in column 0 with columnCount 1", () => {
    const result = layoutDayBookings([
      { startTime: "08:00", durationMinutes: 60 },
      { startTime: "10:00", durationMinutes: 30 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].column).toBe(0);
    expect(result[0].columnCount).toBe(1);
    expect(result[1].column).toBe(0);
    expect(result[1].columnCount).toBe(1);
  });

  it("places two overlapping bookings side by side", () => {
    const result = layoutDayBookings([
      { startTime: "08:00", durationMinutes: 60 },
      { startTime: "08:30", durationMinutes: 60 },
    ]);
    expect(result).toHaveLength(2);
    const columns = result.map((r) => r.column).sort();
    expect(columns).toEqual([0, 1]);
    expect(result.every((r) => r.columnCount === 2)).toBe(true);
  });

  it("computes correct top and height", () => {
    const [{ top, height }] = layoutDayBookings([
      { startTime: "06:00", durationMinutes: 60 },
    ]);
    expect(top).toBe(schMinToTop(360));
    expect(height).toBe((60 / 15) * SCH_SLOT_PX - 2);
  });

  it("reuses column 0 after an earlier booking ends", () => {
    const result = layoutDayBookings([
      { startTime: "08:00", durationMinutes: 60 },
      { startTime: "08:30", durationMinutes: 60 },
      { startTime: "10:00", durationMinutes: 30 },
    ]);
    const third = result.find((r) => r.booking.startTime === "10:00");
    expect(third?.column).toBe(0);
    expect(third?.columnCount).toBe(1);
  });

  it("does not mutate input", () => {
    const input = [
      { startTime: "08:30", durationMinutes: 60 },
      { startTime: "08:00", durationMinutes: 60 },
    ];
    const snapshot = JSON.stringify(input);
    layoutDayBookings(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

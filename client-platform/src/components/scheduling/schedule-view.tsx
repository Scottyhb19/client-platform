"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ScheduleBooking,
  ScheduleViewMode,
} from "@/types/schedule";
import {
  schAddDays,
  schFmtDate,
  schMonthLong,
  schMonthShort,
  schStartOfWeek,
} from "@/utils/scheduleGrid";
import { ScheduleToolbar } from "./schedule-toolbar";
import { DateRolodex } from "./date-rolodex";
import { DayHeaders } from "./day-headers";
import { TimeGrid } from "./time-grid";

function anchorFor(focus: Date, view: ScheduleViewMode): Date {
  return view === 1 ? new Date(focus) : schStartOfWeek(focus);
}

function monthLabelFor(anchor: Date, view: ScheduleViewMode): string {
  const last = schAddDays(anchor, view - 1);
  if (anchor.getMonth() === last.getMonth()) {
    return `${schMonthLong(anchor)} ${anchor.getFullYear()}`;
  }
  return `${schMonthShort(anchor)}\u2013${schMonthShort(last)} ${last.getFullYear()}`;
}

export function ScheduleView() {
  const [focus, setFocus] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [today] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [view, setView] = useState<ScheduleViewMode>(5);
  const [searchTerm, setSearchTerm] = useState("");
  const [bookings, setBookings] = useState<ScheduleBooking[]>([]);
  const [loading, setLoading] = useState(true);

  const anchor = useMemo(() => anchorFor(focus, view), [focus, view]);
  const monthLabel = useMemo(() => monthLabelFor(anchor, view), [anchor, view]);

  // Fetch bookings for the rolodex range (70 days centered on focus).
  // That covers the visible grid too, so one request per focus change.
  useEffect(() => {
    const from = schAddDays(focus, -35);
    const to = schAddDays(focus, 36);
    const fromStr = schFmtDate(from);
    const toStr = schFmtDate(to);

    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const res = await fetch(`/api/bookings?from=${fromStr}&to=${toStr}`);
        if (!res.ok) throw new Error("Failed to load bookings");
        const data: ScheduleBooking[] = await res.json();
        if (!cancelled) setBookings(data);
      } catch (err) {
        if (!cancelled) {
          console.error(err);
          setBookings([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [focus]);

  const datesWithAppts = useMemo(() => {
    const set = new Set<string>();
    for (const b of bookings) set.add(b.date);
    return set;
  }, [bookings]);

  const shift = useCallback(
    (dir: 1 | -1) => {
      const step = view === 1 ? 1 : view;
      setFocus((f) => schAddDays(f, dir * step));
    },
    [view]
  );

  const handleApptClick = useCallback((booking: ScheduleBooking) => {
    console.log("Appointment clicked:", booking);
  }, []);

  return (
    <div className="-m-8 bg-[var(--color-card)] border border-[var(--color-border)] rounded-none flex flex-col h-[calc(100vh-0px)]">
      <ScheduleToolbar
        monthLabel={monthLabel}
        searchTerm={searchTerm}
        view={view}
        onPrev={() => shift(-1)}
        onNext={() => shift(1)}
        onToday={() => setFocus(new Date(today))}
        onSearchChange={setSearchTerm}
        onViewChange={setView}
        onOpenSettings={() => alert("Schedule settings \u2014 coming soon.")}
        onNewBooking={() => alert("New booking \u2014 coming soon.")}
      />
      <DateRolodex
        focus={focus}
        today={today}
        datesWithAppts={datesWithAppts}
        onPickDate={(d) => {
          const copy = new Date(d);
          copy.setHours(0, 0, 0, 0);
          setFocus(copy);
        }}
      />
      <DayHeaders anchor={anchor} viewDays={view} today={today} />
      {loading && bookings.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-slate)]">
          Loading schedule...
        </div>
      ) : (
        <TimeGrid
          anchor={anchor}
          viewDays={view}
          today={today}
          bookings={bookings}
          searchTerm={searchTerm.trim().toLowerCase()}
          onApptClick={handleApptClick}
        />
      )}
    </div>
  );
}

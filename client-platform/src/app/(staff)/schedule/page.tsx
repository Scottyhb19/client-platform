"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Booking {
  id: string;
  clientId: string;
  client: { firstName: string; lastName: string };
  date: string;
  startTime: string;
  endTime: string;
  type: string | null;
  status: string;
  notes: string | null;
}

const HOURS = Array.from({ length: 13 }, (_, i) => i + 6); // 6am to 6pm
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getWeekDates(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  const day = start.getDay();
  const offset = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - offset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

export default function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekDates = getWeekDates(baseDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekLabel = `${weekDates[0].toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${weekDates[6].toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // Fetch bookings for each day of the week
        const allBookings: Booking[] = [];
        for (const date of weekDates) {
          const dateStr = date.toISOString().split("T")[0];
          const res = await fetch(`/api/bookings?date=${dateStr}`);
          if (res.ok) {
            const data = await res.json();
            allBookings.push(...data);
          }
        }
        setBookings(allBookings);
      } catch (err) {
        console.error("Failed to load bookings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  const goToday = useCallback(() => setWeekOffset(0), []);

  // Map bookings to grid positions
  function getBookingsForDateHour(date: Date, hour: number): Booking[] {
    const dateStr = date.toISOString().split("T")[0];
    return bookings.filter((b) => {
      const bDate = new Date(b.date).toISOString().split("T")[0];
      if (bDate !== dateStr) return false;
      const bHour = parseInt(b.startTime.split(":")[0]);
      return bHour === hour;
    });
  }

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="px-6 py-3 bg-white border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <h1 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
          Schedule
        </h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset((w) => w - 1)}
              className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] bg-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)] min-w-[180px] text-center">
              {weekLabel}
            </span>
            <button
              onClick={() => setWeekOffset((w) => w + 1)}
              className="w-8 h-8 rounded-lg border border-[var(--color-border)] flex items-center justify-center cursor-pointer text-[var(--color-slate)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] bg-white"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <button
            onClick={goToday}
            className="text-xs font-medium text-[var(--color-primary)] cursor-pointer px-2.5 py-1 rounded-md border border-[var(--color-border)] bg-white hover:bg-[var(--color-background)]"
          >
            Today
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] bg-white border-b border-[var(--color-border)] flex-shrink-0">
        <div className="border-r border-[var(--color-border)]" />
        {weekDates.map((date, i) => {
          const isToday = date.getTime() === today.getTime();
          return (
            <div
              key={i}
              className="py-2 text-center border-r border-[var(--color-border)] last:border-r-0"
            >
              <div className="text-[0.66rem] font-semibold text-[var(--color-slate)] uppercase tracking-wider">
                {DAY_NAMES[i]}
              </div>
              <div
                className={`font-[family-name:var(--font-display)] font-bold text-sm mt-0.5 ${
                  isToday
                    ? "text-white bg-[var(--color-primary)] w-7 h-7 rounded-full flex items-center justify-center mx-auto"
                    : "text-[var(--color-charcoal)]"
                }`}
              >
                {date.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-sm text-[var(--color-slate)] text-center py-8">
            Loading schedule...
          </div>
        ) : (
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {HOURS.map((hour) => (
              <div key={hour} className="contents">
                {/* Time label */}
                <div className="border-r border-b border-[var(--color-border)] py-3 pr-2 text-right text-[0.68rem] font-medium text-[var(--color-slate)] bg-white">
                  {hour === 0
                    ? "12 AM"
                    : hour < 12
                      ? `${hour} AM`
                      : hour === 12
                        ? "12 PM"
                        : `${hour - 12} PM`}
                </div>

                {/* Day cells */}
                {weekDates.map((date, dayIdx) => {
                  const dayBookings = getBookingsForDateHour(date, hour);
                  return (
                    <div
                      key={dayIdx}
                      className="border-r border-b border-[var(--color-border)] last:border-r-0 min-h-[48px] p-0.5 bg-white hover:bg-[var(--color-background)]/50 transition-colors"
                    >
                      {dayBookings.map((booking) => (
                        <Link
                          key={booking.id}
                          href={`/clients/${booking.clientId}`}
                          className="block bg-[var(--color-primary)]/10 border-l-[3px] border-l-[var(--color-primary)] rounded-r px-1.5 py-1 mb-0.5 hover:bg-[var(--color-primary)]/15 transition-colors"
                        >
                          <div className="font-semibold text-[0.68rem] text-[var(--color-charcoal)] truncate">
                            {booking.client.firstName} {booking.client.lastName}
                          </div>
                          <div className="text-[0.6rem] text-[var(--color-slate)]">
                            {booking.startTime} – {booking.endTime}
                          </div>
                        </Link>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

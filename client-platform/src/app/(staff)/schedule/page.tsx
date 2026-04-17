"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Client {
  id: string;
  firstName: string;
  lastName: string;
}

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

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export default function SchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState<{
    date: Date;
    hour: number;
  } | null>(null);

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekDates = getWeekDates(baseDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekLabel = `${weekDates[0].toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${weekDates[6].toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  // Load clients once for the create modal
  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setClients)
      .catch(() => {});
  }, []);

  const goToday = useCallback(() => setWeekOffset(0), []);

  function getBookingsForDateHour(date: Date, hour: number): Booking[] {
    const dateStr = date.toISOString().split("T")[0];
    return bookings.filter((b) => {
      const bDate = new Date(b.date).toISOString().split("T")[0];
      if (bDate !== dateStr) return false;
      const bHour = parseInt(b.startTime.split(":")[0]);
      return bHour === hour;
    });
  }

  function handleCellClick(date: Date, hour: number) {
    // Only open create modal if no existing booking in this slot
    const existing = getBookingsForDateHour(date, hour);
    if (existing.length === 0) {
      setShowCreate({ date, hour });
    }
  }

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="px-6 py-3 bg-white border-b border-[var(--color-border)] flex items-center justify-between flex-shrink-0">
        <h1 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
          Schedule
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowCreate({ date: new Date(), hour: 9 })}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-lg font-semibold text-xs border-none cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            + New Booking
          </button>
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
                  {formatHour(hour)}
                </div>

                {/* Day cells */}
                {weekDates.map((date, dayIdx) => {
                  const dayBookings = getBookingsForDateHour(date, hour);
                  return (
                    <div
                      key={dayIdx}
                      onClick={() => handleCellClick(date, hour)}
                      className="border-r border-b border-[var(--color-border)] last:border-r-0 min-h-[48px] p-0.5 bg-white hover:bg-[var(--color-accent)]/[0.04] transition-colors cursor-pointer group"
                    >
                      {dayBookings.length > 0 ? (
                        dayBookings.map((booking) => (
                          <Link
                            key={booking.id}
                            href={`/clients/${booking.clientId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block bg-[var(--color-primary)]/10 border-l-[3px] border-l-[var(--color-primary)] rounded-r px-1.5 py-1 mb-0.5 hover:bg-[var(--color-primary)]/15 transition-colors"
                          >
                            <div className="font-semibold text-[0.68rem] text-[var(--color-charcoal)] truncate">
                              {booking.client.firstName}{" "}
                              {booking.client.lastName}
                            </div>
                            <div className="text-[0.6rem] text-[var(--color-slate)]">
                              {booking.startTime} – {booking.endTime}
                            </div>
                          </Link>
                        ))
                      ) : (
                        <div className="h-full w-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <span className="text-[0.6rem] text-[var(--color-accent)] font-semibold">
                            + Book
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create booking modal */}
      {showCreate && (
        <CreateBookingModal
          clients={clients}
          initialDate={showCreate.date}
          initialHour={showCreate.hour}
          onClose={() => setShowCreate(null)}
          onCreated={() => {
            setShowCreate(null);
            loadBookings();
          }}
        />
      )}
    </div>
  );
}

function CreateBookingModal({
  clients,
  initialDate,
  initialHour,
  onClose,
  onCreated,
}: {
  clients: Client[];
  initialDate: Date;
  initialHour: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const dateStr = initialDate.toISOString().split("T")[0];
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [date, setDate] = useState(dateStr);
  const [startTime, setStartTime] = useState(`${pad2(initialHour)}:00`);
  const [endTime, setEndTime] = useState(`${pad2(initialHour + 1)}:00`);
  const [type, setType] = useState("Session");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId || !date || !startTime || !endTime) {
      setError("Client, date, and times are required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          date,
          startTime,
          endTime,
          type: type || null,
          notes: notes || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create booking");
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-[var(--color-border)] shadow-xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
            New Booking
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-slate)] bg-transparent border-none cursor-pointer hover:text-[var(--color-charcoal)]"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Client */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Client
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
            />
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
                End Time
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Appointment Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
            >
              <option value="Session">Session</option>
              <option value="Initial Assessment">Initial Assessment</option>
              <option value="Review">Review</option>
              <option value="Telehealth">Telehealth</option>
              <option value="Group Session">Group Session</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any notes for this appointment..."
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white resize-none placeholder:text-[var(--color-slate)]"
            />
          </div>

          {error && (
            <div className="text-xs text-[var(--color-red)] font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-charcoal)] cursor-pointer hover:border-[var(--color-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold border-none bg-[var(--color-primary)] text-white cursor-pointer disabled:opacity-50 hover:bg-[var(--color-primary-dark)] transition-colors"
          >
            {saving ? "Booking..." : "Create Booking"}
          </button>
        </div>
      </form>
    </div>
  );
}

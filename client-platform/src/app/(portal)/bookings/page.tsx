"use client";

import { useState, useEffect } from "react";

interface Booking {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  type: string | null;
  status: string;
  notes: string | null;
  practitioner?: { firstName: string; lastName: string };
}

export default function PortalBookingsPage() {
  const [upcoming, setUpcoming] = useState<Booking[]>([]);
  const [past, setPast] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // For now fetch all bookings for the test client
        const res = await fetch("/api/bookings?clientId=test-client");
        if (!res.ok) throw new Error("Failed to load bookings");
        const bookings: Booking[] = await res.json();

        const now = new Date();
        const upcomingBookings: Booking[] = [];
        const pastBookings: Booking[] = [];

        for (const b of bookings) {
          const bookingDate = new Date(b.date);
          if (bookingDate >= new Date(now.toDateString())) {
            upcomingBookings.push(b);
          } else {
            pastBookings.push(b);
          }
        }

        setUpcoming(upcomingBookings);
        setPast(pastBookings);
      } catch (err) {
        console.error("Failed to load bookings:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-sm text-[var(--color-slate)]">
        Loading bookings...
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="bg-[var(--color-charcoal)] px-5 pt-6 pb-5 text-white -mx-4 -mt-4">
        <div className="text-xs text-white/40 mb-0.5">Your appointments</div>
        <h1 className="font-[family-name:var(--font-display)] font-bold text-xl text-white">
          My Bookings
        </h1>
      </div>

      <div className="pt-4 px-1">
        {/* Upcoming */}
        <div className="mb-6">
          <h2 className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)] mb-2 px-1">
            Upcoming
          </h2>
          {upcoming.length > 0 ? (
            <div className="space-y-2">
              {upcoming.map((b) => (
                <BookingCard key={b.id} booking={b} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[var(--color-border)] px-5 py-8 text-center">
              <div className="text-2xl mb-2">📅</div>
              <div className="text-sm text-[var(--color-slate)]">
                No upcoming appointments.
              </div>
              <div className="text-xs text-[var(--color-slate)] mt-1">
                Your EP will schedule your next session.
              </div>
            </div>
          )}
        </div>

        {/* Past */}
        {past.length > 0 && (
          <div>
            <h2 className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-slate)] mb-2 px-1">
              Past
            </h2>
            <div className="space-y-2">
              {past.map((b) => (
                <BookingCard key={b.id} booking={b} isPast />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BookingCard({
  booking,
  isPast,
}: {
  booking: Booking;
  isPast?: boolean;
}) {
  const date = new Date(booking.date);
  const dayName = date.toLocaleDateString("en-AU", { weekday: "short" });
  const dayNum = date.getDate();
  const month = date.toLocaleDateString("en-AU", { month: "short" });

  const statusColors: Record<string, string> = {
    CONFIRMED: "bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
    PENDING: "bg-[var(--color-amber)]/10 text-[#9A7A0E]",
    CANCELLED: "bg-[var(--color-red)]/10 text-[var(--color-red)]",
    COMPLETED: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
  };

  return (
    <div
      className={`bg-white rounded-2xl border border-[var(--color-border)] px-4 py-3.5 flex items-center gap-3.5 ${isPast ? "opacity-60" : ""}`}
    >
      {/* Date block */}
      <div className="flex flex-col items-center w-11 flex-shrink-0">
        <div className="text-[0.6rem] font-semibold text-[var(--color-slate)] uppercase">
          {dayName}
        </div>
        <div className="font-[family-name:var(--font-display)] font-black text-xl text-[var(--color-charcoal)] leading-none">
          {dayNum}
        </div>
        <div className="text-[0.6rem] text-[var(--color-slate)]">{month}</div>
      </div>

      {/* Divider */}
      <div className="w-px h-10 bg-[var(--color-border)]" />

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-[var(--color-charcoal)]">
          {booking.type || "Session"}
        </div>
        <div className="text-xs text-[var(--color-slate)] mt-0.5">
          {booking.startTime} – {booking.endTime}
          {booking.practitioner &&
            ` · ${booking.practitioner.firstName} ${booking.practitioner.lastName}`}
        </div>
      </div>

      {/* Status badge */}
      <span
        className={`text-[0.6rem] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
          statusColors[booking.status] ?? "bg-gray-100 text-gray-500"
        }`}
      >
        {booking.status}
      </span>
    </div>
  );
}

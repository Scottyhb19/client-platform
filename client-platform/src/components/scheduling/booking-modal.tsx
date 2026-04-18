"use client";

import { useEffect, useState } from "react";
import type { ScheduleBooking } from "@/types/schedule";
import { schFmtDate } from "@/utils/scheduleGrid";

interface ClientOption {
  id: string;
  firstName: string;
  lastName: string;
}

export interface BookingModalDraft {
  date: string;
  startTime: string;
  durationMinutes: number;
  clientId?: string;
  type?: string;
  notes?: string;
}

interface Props {
  mode: "create" | "edit";
  booking?: ScheduleBooking;
  draft?: BookingModalDraft;
  onClose: () => void;
  onSaved: () => void;
}

const APPOINTMENT_TYPES = [
  "Review",
  "Initial Assessment",
  "Assessment",
  "Telehealth",
  "Handover",
  "VALD Test",
  "New Client",
  "Session",
];

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120];

function defaultDraft(): BookingModalDraft {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
  const hh = String(next.getHours()).padStart(2, "0");
  const mm = String(next.getMinutes()).padStart(2, "0");
  return {
    date: schFmtDate(now),
    startTime: `${hh}:${mm}`,
    durationMinutes: 60,
  };
}

export function BookingModal({
  mode,
  booking,
  draft,
  onClose,
  onSaved,
}: Props) {
  const initial: BookingModalDraft =
    mode === "edit" && booking
      ? {
          date: booking.date,
          startTime: booking.startTime,
          durationMinutes: booking.durationMinutes,
          clientId: booking.clientId,
          type: booking.type ?? "",
          notes: booking.notes ?? "",
        }
      : { ...defaultDraft(), ...draft };

  const [date, setDate] = useState(initial.date);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [durationMinutes, setDurationMinutes] = useState(
    initial.durationMinutes
  );
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [type, setType] = useState(initial.type ?? "Review");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then((data: ClientOption[]) => {
        setClients(data);
        if (!clientId && data[0]) setClientId(data[0].id);
      })
      .catch(() => setError("Could not load clients"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!clientId) {
      setError("Please select a client.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        clientId,
        date,
        startTime,
        durationMinutes,
        type: type || null,
        notes: notes || null,
      };

      if (mode === "edit" && booking) {
        const res = await fetch(`/api/bookings/${booking.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to save booking");
        }
      } else {
        const res = await fetch("/api/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Failed to create booking");
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!booking) return;
    if (!confirm("Delete this booking? This cannot be undone.")) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${booking.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete booking");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <form
        onSubmit={handleSave}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl border border-[var(--color-border)] shadow-xl w-full max-w-md mx-4 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] font-bold text-lg text-[var(--color-charcoal)]">
            {mode === "edit" ? "Edit Booking" : "New Booking"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-slate)] bg-transparent border-none cursor-pointer hover:text-[var(--color-charcoal)]"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Client
            </label>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              required
            >
              <option value="" disabled>
                Select a client...
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <div>
              <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
                Start
              </label>
              <input
                type="time"
                step={900}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
                Dur
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
              >
                {DURATION_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white"
            >
              {APPOINTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any notes for this appointment..."
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-charcoal)] bg-[var(--color-bg)] outline-none focus:border-[var(--color-primary)] focus:bg-white resize-none placeholder:text-[var(--color-slate)]"
            />
          </div>

          {error && (
            <div className="text-xs text-[var(--color-red)] font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--color-border)] flex items-center justify-between gap-2">
          {mode === "edit" && booking ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="text-xs font-semibold text-[var(--color-red)] bg-transparent border-none cursor-pointer disabled:opacity-50 hover:underline"
            >
              {deleting ? "Deleting..." : "Delete booking"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-charcoal)] cursor-pointer hover:border-[var(--color-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || deleting}
              className="px-4 py-2 rounded-lg text-sm font-semibold border-none bg-[var(--color-primary)] text-white cursor-pointer disabled:opacity-50 hover:bg-[var(--color-primary-dark)]"
            >
              {saving ? "Saving..." : mode === "edit" ? "Save" : "Create Booking"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

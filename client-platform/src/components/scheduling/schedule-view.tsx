"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ScheduleBooking,
  ScheduleSettings,
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
import { TimeGrid, type ApptUpdatePatch } from "./time-grid";
import { BookingModal, type BookingModalDraft } from "./booking-modal";
import { ScheduleSettingsPanel } from "./schedule-settings-panel";

const DEFAULT_SETTINGS: ScheduleSettings = {
  workingHoursStart: "06:00",
  workingHoursEnd: "19:00",
  defaultDurationMinutes: 60,
  slotGranularityMinutes: 15,
};

type ModalState =
  | { open: false }
  | { open: true; mode: "create"; draft: BookingModalDraft }
  | { open: true; mode: "edit"; booking: ScheduleBooking };

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
  const [modal, setModal] = useState<ModalState>({ open: false });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ScheduleSettings>(DEFAULT_SETTINGS);
  const [refreshToken, setRefreshToken] = useState(0);

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
  }, [focus, refreshToken]);

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (modal.open) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "/" && !isTyping) {
        e.preventDefault();
        const input = document.getElementById("sch-search");
        (input as HTMLInputElement | null)?.focus();
        return;
      }
      if (isTyping) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        shift(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        shift(1);
      } else if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setFocus(new Date(today));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shift, today, modal.open]);

  const handleApptClick = useCallback((booking: ScheduleBooking) => {
    setModal({ open: true, mode: "edit", booking });
  }, []);

  const handleNewBooking = useCallback(() => {
    setModal({
      open: true,
      mode: "create",
      draft: {
        date: schFmtDate(focus),
        startTime: settings.workingHoursStart,
        durationMinutes: settings.defaultDurationMinutes,
      },
    });
  }, [focus, settings]);

  const handleDragCreate = useCallback(
    (date: Date, startMin: number, durationMin: number) => {
      const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
      const mm = String(startMin % 60).padStart(2, "0");
      setModal({
        open: true,
        mode: "create",
        draft: {
          date: schFmtDate(date),
          startTime: `${hh}:${mm}`,
          durationMinutes: durationMin,
        },
      });
    },
    []
  );

  const handleModalSaved = useCallback(() => {
    setModal({ open: false });
    setRefreshToken((t) => t + 1);
  }, []);

  const handleApptUpdate = useCallback(
    async (bookingId: string, patch: ApptUpdatePatch) => {
      // Optimistic update so the card jumps to the new slot immediately.
      setBookings((prev) =>
        prev.map((b) => {
          if (b.id !== bookingId) return b;
          const [hh, mm] = patch.startTime.split(":").map(Number);
          const endMin = hh * 60 + mm + patch.durationMinutes;
          const endHH = String(Math.floor(endMin / 60)).padStart(2, "0");
          const endMM = String(endMin % 60).padStart(2, "0");
          return {
            ...b,
            date: patch.date,
            startTime: patch.startTime,
            endTime: `${endHH}:${endMM}`,
            durationMinutes: patch.durationMinutes,
          };
        })
      );
      try {
        const res = await fetch(`/api/bookings/${bookingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error("Failed to update booking");
        // Re-sync with server in case the DB canonicalised the values.
        setRefreshToken((t) => t + 1);
      } catch (err) {
        console.error(err);
        // Revert optimistic change.
        setRefreshToken((t) => t + 1);
      }
    },
    []
  );

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
        onOpenSettings={() => setSettingsOpen(true)}
        onNewBooking={handleNewBooking}
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
          settings={settings}
          onApptClick={handleApptClick}
          onApptUpdate={handleApptUpdate}
          onDragCreate={handleDragCreate}
        />
      )}
      {modal.open && modal.mode === "create" && (
        <BookingModal
          mode="create"
          draft={modal.draft}
          onClose={() => setModal({ open: false })}
          onSaved={handleModalSaved}
        />
      )}
      {modal.open && modal.mode === "edit" && (
        <BookingModal
          mode="edit"
          booking={modal.booking}
          onClose={() => setModal({ open: false })}
          onSaved={handleModalSaved}
        />
      )}
      {settingsOpen && (
        <ScheduleSettingsPanel
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(next) => {
            setSettings(next);
            setSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}

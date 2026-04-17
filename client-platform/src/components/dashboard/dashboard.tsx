"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface StatData {
  activeClients: number;
  todaySessions: number;
  unreviewed: number;
  programsEnding: number;
}

interface AttentionItem {
  id: string;
  name: string;
  initials: string;
  reason: string;
  tag: "flag" | "overdue" | "ending" | "new";
  tagLabel: string;
}

interface SessionItem {
  id: string;
  clientId: string;
  clientName: string;
  time: string;
  detail: string;
  status: string;
}

export function Dashboard() {
  const [stats, setStats] = useState<StatData>({
    activeClients: 0,
    todaySessions: 0,
    unreviewed: 0,
    programsEnding: 0,
  });
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Fetch clients
        const clientsRes = await fetch("/api/clients");
        const clients = clientsRes.ok ? await clientsRes.json() : [];
        const activeClients = clients.filter(
          (c: { isActive: boolean }) => c.isActive
        );

        // Fetch today's bookings
        const today = new Date().toISOString().split("T")[0];
        const bookingsRes = await fetch(`/api/bookings?date=${today}`);
        const bookings = bookingsRes.ok ? await bookingsRes.json() : [];

        // Count unreviewed injury flags from clinical notes
        let unreviewedCount = 0;
        for (const client of activeClients) {
          try {
            const notesRes = await fetch(`/api/notes?clientId=${client.id}`);
            if (notesRes.ok) {
              const notes = await notesRes.json();
              unreviewedCount += notes.filter(
                (n: { isInjuryFlag: boolean }) => n.isInjuryFlag
              ).length;
            }
          } catch {
            // Skip if notes fail for a client
          }
        }

        // Count programs ending within 14 days
        let endingCount = 0;
        try {
          const progsRes = await fetch("/api/programs");
          if (progsRes.ok) {
            const programs = await progsRes.json();
            const twoWeeks = new Date();
            twoWeeks.setDate(twoWeeks.getDate() + 14);
            endingCount = programs.filter(
              (p: { endDate: string | null; status: string }) =>
                p.endDate &&
                new Date(p.endDate) <= twoWeeks &&
                p.status === "ACTIVE"
            ).length;
          }
        } catch {
          // Skip if programs fail
        }

        setStats({
          activeClients: activeClients.length,
          todaySessions: bookings.length,
          unreviewed: unreviewedCount,
          programsEnding: endingCount,
        });

        // Build attention items from clients with injury flags
        const attentionItems: AttentionItem[] = [];
        for (const client of activeClients) {
          if (client.injuries) {
            attentionItems.push({
              id: client.id,
              name: `${client.firstName} ${client.lastName}`,
              initials: `${client.firstName[0]}${client.lastName[0]}`,
              reason: client.injuries,
              tag: "flag",
              tagLabel: "Flag",
            });
          }
        }
        setAttention(attentionItems);

        // Build session items
        const sessionItems: SessionItem[] = bookings.map(
          (b: {
            id: string;
            clientId: string;
            client?: { firstName: string; lastName: string };
            startTime: string;
            type: string | null;
            status: string;
          }) => ({
            id: b.id,
            clientId: b.clientId,
            clientName: b.client
              ? `${b.client.firstName} ${b.client.lastName}`
              : "Client",
            time: b.startTime,
            detail: b.type || "Session",
            status: b.status,
          })
        );
        setSessions(sessionItems);
      } catch (err) {
        console.error("Dashboard load error:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 17
        ? "Good afternoon"
        : "Good evening";
  const dateStr = now.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (loading) {
    return (
      <div className="text-sm text-[var(--color-slate)]">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-5">
        <div className="text-sm text-[var(--color-slate)]">{greeting}</div>
        <h1 className="font-[family-name:var(--font-display)] font-extrabold text-2xl text-[var(--color-charcoal)]">
          Dashboard
        </h1>
        <div className="text-xs text-[var(--color-slate)] mt-0.5">
          {dateStr}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <StatCard
          value={stats.activeClients}
          label="Active Clients"
          variant="highlight"
        />
        <StatCard
          value={stats.todaySessions}
          label="Today's Sessions"
          subtitle={
            sessions.length > 0 ? `Next at ${sessions[0].time}` : undefined
          }
        />
        <StatCard
          value={stats.programsEnding}
          label="Programs Ending"
          subtitle={stats.programsEnding > 0 ? "Within 14 days" : undefined}
          variant={stats.programsEnding > 0 ? "warning" : undefined}
        />
        <StatCard
          value={stats.unreviewed}
          label="Unreviewed Flags"
          variant={stats.unreviewed > 0 ? "alert" : undefined}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[1fr_380px] gap-4 items-start">
        {/* Needs Attention */}
        <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)]">
              Needs Attention
            </h2>
            {attention.length > 0 && (
              <span className="text-[0.66rem] font-semibold text-white bg-[var(--color-red)] px-2 py-0.5 rounded-full">
                {attention.length}
              </span>
            )}
          </div>

          {attention.length > 0 ? (
            attention.map((item) => (
              <Link
                key={item.id}
                href={`/clients/${item.id}`}
                className="flex items-center gap-2.5 px-4 py-2.5 border-b border-black/[0.04] last:border-b-0 hover:bg-[var(--color-primary)]/[0.015] transition-colors"
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-[family-name:var(--font-display)] font-bold text-xs text-white flex-shrink-0 ${
                    item.tag === "flag"
                      ? "bg-gradient-to-br from-[#8B2020] to-[var(--color-red)]"
                      : item.tag === "overdue"
                        ? "bg-gradient-to-br from-[#9A7A0E] to-[var(--color-amber)]"
                        : "bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)]"
                  }`}
                >
                  {item.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[0.8rem] text-[var(--color-charcoal)]">
                    {item.name}
                  </div>
                  <div className="text-[0.7rem] text-[var(--color-slate)] truncate">
                    {item.reason}
                  </div>
                </div>
                <span
                  className={`text-[0.6rem] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${
                    item.tag === "flag"
                      ? "bg-[var(--color-red)]/10 text-[var(--color-red)]"
                      : item.tag === "overdue"
                        ? "bg-[var(--color-amber)]/10 text-[#9A7A0E]"
                        : item.tag === "ending"
                          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                          : "bg-[var(--color-accent)]/10 text-[var(--color-accent)]"
                  }`}
                >
                  {item.tagLabel}
                </span>
              </Link>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-xs text-[var(--color-slate)]">
              No clients need attention right now.
            </div>
          )}
        </div>

        {/* Today's Sessions */}
        <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] font-bold text-sm text-[var(--color-charcoal)]">
              Today&apos;s Sessions
            </h2>
            {sessions.length > 0 && (
              <span className="text-[0.66rem] font-semibold text-white bg-[var(--color-accent)] px-2 py-0.5 rounded-full">
                {sessions.length}
              </span>
            )}
          </div>

          {sessions.length > 0 ? (
            sessions.map((session) => (
              <Link
                key={session.id}
                href={`/clients/${session.clientId}`}
                className="flex items-center gap-2.5 px-4 py-2.5 border-b border-black/[0.04] last:border-b-0 hover:bg-[var(--color-primary)]/[0.015] transition-colors"
              >
                <div className="font-[family-name:var(--font-display)] font-bold text-[0.78rem] text-[var(--color-primary)] w-[52px] flex-shrink-0">
                  {session.time}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[0.8rem] text-[var(--color-charcoal)]">
                    {session.clientName}
                  </div>
                  <div className="text-[0.68rem] text-[var(--color-slate)]">
                    {session.detail}
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-xs text-[var(--color-slate)]">
              No sessions scheduled for today.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  subtitle,
  variant,
}: {
  value: number;
  label: string;
  subtitle?: string;
  variant?: "highlight" | "warning" | "alert";
}) {
  const valueColor =
    variant === "highlight"
      ? "text-[var(--color-primary)]"
      : variant === "warning"
        ? "text-[var(--color-amber)]"
        : variant === "alert"
          ? "text-[var(--color-red)]"
          : "text-[var(--color-charcoal)]";

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl px-4 py-4 hover:shadow-sm transition-shadow cursor-pointer">
      <div
        className={`font-[family-name:var(--font-display)] font-black text-3xl leading-none ${valueColor}`}
      >
        {value}
      </div>
      <div className="text-[0.72rem] text-[var(--color-slate)] font-medium mt-1">
        {label}
      </div>
      {subtitle && (
        <div className="text-[0.66rem] text-[var(--color-slate)] mt-1.5">
          {subtitle}
        </div>
      )}
    </div>
  );
}

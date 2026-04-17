"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface ProgramDay {
  id: string;
  label: string;
  sortOrder: number;
  exercises: {
    id: string;
    exercise: { name: string };
  }[];
}

interface Program {
  id: string;
  name: string;
  type: string;
  status: string;
  startDate: string | null;
  createdAt: string;
  client: { firstName: string; lastName: string };
  days: ProgramDay[];
}

interface Client {
  id: string;
  firstName: string;
  lastName: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-[var(--color-accent)]/10 text-[var(--color-accent)]",
  DRAFT: "bg-[var(--color-amber)]/10 text-[#9A7A0E]",
  ARCHIVED: "bg-[var(--color-slate)]/10 text-[var(--color-slate)]",
};

const TYPE_LABELS: Record<string, string> = {
  HOME_GYM: "Home / Gym",
  IN_CLINIC: "In-Clinic",
};

export default function ProgramsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "DRAFT" | "ARCHIVED">("ALL");

  const loadPrograms = useCallback(async () => {
    try {
      const res = await fetch("/api/programs");
      if (res.ok) setPrograms(await res.json());
    } catch (err) {
      console.error("Failed to load programs:", err);
    }
  }, []);

  useEffect(() => {
    async function init() {
      await loadPrograms();
      try {
        const clientsRes = await fetch("/api/clients");
        if (clientsRes.ok) setClients(await clientsRes.json());
      } catch {
        // Skip
      }
      setLoading(false);
    }
    init();
  }, [loadPrograms]);

  const filtered = filter === "ALL"
    ? programs
    : programs.filter((p) => p.status === filter);

  if (loading) {
    return (
      <div className="text-sm text-[var(--color-slate)]">
        Loading programs...
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="font-[family-name:var(--font-display)] font-extrabold text-2xl text-[var(--color-charcoal)]">
            Programs
          </h1>
          <div className="text-xs text-[var(--color-slate)] mt-0.5">
            {programs.length} program{programs.length !== 1 ? "s" : ""} total
          </div>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-semibold text-sm border-none cursor-pointer hover:bg-[var(--color-primary-dark)] transition-colors"
        >
          + New Program
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {(["ALL", "ACTIVE", "DRAFT", "ARCHIVED"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
              filter === s
                ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                : "bg-white text-[var(--color-slate)] border-[var(--color-border)] hover:border-[var(--color-primary)]"
            }`}
          >
            {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {/* Program cards */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((program) => (
            <ProgramCard key={program.id} program={program} onUpdate={loadPrograms} />
          ))}
        </div>
      ) : (
        <div className="bg-white border border-[var(--color-border)] rounded-xl px-8 py-12 text-center">
          <div className="text-[var(--color-slate)] text-sm">
            {filter === "ALL"
              ? "No programs yet. Create one to get started."
              : `No ${filter.toLowerCase()} programs.`}
          </div>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <CreateProgramModal
          clients={clients}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadPrograms();
          }}
        />
      )}
    </div>
  );
}

function ProgramCard({
  program,
  onUpdate,
}: {
  program: Program;
  onUpdate: () => void;
}) {
  const totalExercises = program.days.reduce(
    (sum, d) => sum + d.exercises.length,
    0
  );
  const startDate = program.startDate
    ? new Date(program.startDate).toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  async function updateStatus(status: string) {
    await fetch(`/api/programs/${program.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    onUpdate();
  }

  async function deleteProgram() {
    if (!confirm(`Archive "${program.name}"? It can be restored later.`)) return;
    await fetch(`/api/programs/${program.id}`, { method: "DELETE" });
    onUpdate();
  }

  return (
    <div className="bg-white border border-[var(--color-border)] rounded-xl overflow-hidden hover:shadow-sm transition-shadow">
      {/* Card header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--color-border)]">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-[family-name:var(--font-display)] font-bold text-base text-[var(--color-charcoal)] truncate">
              {program.name}
            </h3>
            <div className="text-xs text-[var(--color-slate)] mt-0.5">
              {program.client.firstName} {program.client.lastName}
            </div>
          </div>
          <span
            className={`text-[0.6rem] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${
              STATUS_COLORS[program.status] ?? "bg-gray-100 text-gray-500"
            }`}
          >
            {program.status}
          </span>
        </div>
      </div>

      {/* Card body */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-3 text-xs text-[var(--color-slate)] mb-3">
          <span>{TYPE_LABELS[program.type] ?? program.type}</span>
          <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border)]" />
          <span>
            {program.days.length} day{program.days.length !== 1 ? "s" : ""}
          </span>
          <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border)]" />
          <span>
            {totalExercises} exercise{totalExercises !== 1 ? "s" : ""}
          </span>
        </div>

        {startDate && (
          <div className="text-[0.68rem] text-[var(--color-slate)] mb-3">
            Started {startDate}
          </div>
        )}

        {/* Day pills */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {program.days.map((day) => (
            <Link
              key={day.id}
              href={`/programs/${program.id}/session/${day.id}`}
              className="text-[0.68rem] font-medium px-2.5 py-1 rounded-lg bg-[var(--color-background)] text-[var(--color-charcoal)] border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors no-underline"
            >
              {day.label}{" "}
              <span className="text-[var(--color-slate)]">
                ({day.exercises.length})
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Card footer actions */}
      <div className="px-4 py-2.5 border-t border-[var(--color-border)] flex items-center gap-2">
        {program.status === "DRAFT" && (
          <button
            onClick={() => updateStatus("ACTIVE")}
            className="text-[0.68rem] font-semibold text-[var(--color-accent)] bg-transparent border-none cursor-pointer hover:underline"
          >
            Activate
          </button>
        )}
        {program.status === "ACTIVE" && (
          <button
            onClick={() => updateStatus("DRAFT")}
            className="text-[0.68rem] font-semibold text-[var(--color-slate)] bg-transparent border-none cursor-pointer hover:underline"
          >
            Set to Draft
          </button>
        )}
        <Link
          href={`/clients/${program.client ? "test-client" : ""}`}
          className="text-[0.68rem] font-semibold text-[var(--color-primary)] no-underline hover:underline ml-auto"
        >
          View Client
        </Link>
        <button
          onClick={deleteProgram}
          className="text-[0.68rem] font-semibold text-[var(--color-red)] bg-transparent border-none cursor-pointer hover:underline"
        >
          Archive
        </button>
      </div>
    </div>
  );
}

function CreateProgramModal({
  clients,
  onClose,
  onCreated,
}: {
  clients: Client[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [type, setType] = useState("HOME_GYM");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !clientId) {
      setError("Program name and client are required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          name: name.trim(),
          type,
          startDate: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create program");
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
            New Program
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
          {/* Client select */}
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

          {/* Program name */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Program Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gym Program - Phase 1"
              className="w-full h-10 border border-[var(--color-border)] rounded-lg px-3 text-sm text-[var(--color-charcoal)] bg-[var(--color-background)] outline-none focus:border-[var(--color-primary)] focus:bg-white placeholder:text-[var(--color-slate)]"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs font-semibold text-[var(--color-slate)] uppercase tracking-wider mb-1">
              Type
            </label>
            <div className="flex gap-2">
              {(["HOME_GYM", "IN_CLINIC"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border cursor-pointer transition-colors ${
                    type === t
                      ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                      : "bg-white text-[var(--color-charcoal)] border-[var(--color-border)] hover:border-[var(--color-primary)]"
                  }`}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-xs text-[var(--color-red)] font-medium">
              {error}
            </div>
          )}

          <div className="text-xs text-[var(--color-slate)]">
            Creates the program with Day A, Day B, and Day C by default. You can
            add or remove days from the session builder.
          </div>
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
            {saving ? "Creating..." : "Create Program"}
          </button>
        </div>
      </form>
    </div>
  );
}

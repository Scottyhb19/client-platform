"use client";

import { useState } from "react";

type Note = {
  id: string;
  type: string;
  title: string | null;
  content: string;
  isInjuryFlag: boolean;
  isPinned: boolean;
  createdAt: string;
  author: { firstName: string; lastName: string };
};

const noteTypeLabels: Record<string, string> = {
  INITIAL_ASSESSMENT: "Initial Assessment",
  PROGRESS_NOTE: "Progress Note",
  INJURY_FLAG: "Injury Flag",
  CONTRAINDICATION: "Contraindication",
  DISCHARGE: "Discharge",
  GENERAL: "General",
};

export function ClinicalNotes({
  clientId,
  initialNotes,
}: {
  clientId: string;
  initialNotes: Note[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [showForm, setShowForm] = useState(false);
  const [newType, setNewType] = useState("GENERAL");
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newIsInjuryFlag, setNewIsInjuryFlag] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!newContent.trim()) return;
    setSaving(true);

    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        authorId: "placeholder-user", // TODO: from auth session
        type: newType,
        title: newTitle || null,
        content: newContent,
        isInjuryFlag: newIsInjuryFlag,
      }),
    });

    if (res.ok) {
      const note = await res.json();
      setNotes([note, ...notes]);
      setShowForm(false);
      setNewType("GENERAL");
      setNewTitle("");
      setNewContent("");
      setNewIsInjuryFlag(false);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setNotes(notes.filter((n) => n.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--color-charcoal)]">
          Clinical Notes
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs font-medium text-[var(--color-primary)] hover:underline"
        >
          + Add Note
        </button>
      </div>

      {/* New note form */}
      {showForm && (
        <div className="mb-4 rounded-xl border border-[var(--color-primary)]/20 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-primary)]"
            >
              {Object.entries(noteTypeLabels).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Title (optional)"
              className="rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-xs outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={4}
            placeholder="Write your note..."
            className="mb-3 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] resize-none"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-[var(--color-slate)]">
              <input
                type="checkbox"
                checked={newIsInjuryFlag}
                onChange={(e) => setNewIsInjuryFlag(e.target.checked)}
                className="rounded border-[var(--color-border)]"
              />
              Flag as injury
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-slate)] hover:bg-[var(--color-bg)]"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !newContent.trim()}
                className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notes list */}
      {notes.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-6 text-center">
          <p className="text-xs text-[var(--color-slate)]">
            No clinical notes yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-xl border bg-white p-4 ${
                note.isInjuryFlag
                  ? "border-[var(--color-red)]/30"
                  : "border-[var(--color-border)]"
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  {note.isPinned && (
                    <span className="text-[10px] text-[var(--color-amber)]">
                      Pinned
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      note.isInjuryFlag
                        ? "bg-[var(--color-red)]/10 text-[var(--color-red)]"
                        : "bg-[var(--color-bg)] text-[var(--color-slate)]"
                    }`}
                  >
                    {noteTypeLabels[note.type] || note.type}
                  </span>
                  {note.title && (
                    <span className="text-xs font-semibold text-[var(--color-charcoal)]">
                      {note.title}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="rounded p-1 text-[var(--color-slate)] hover:text-[var(--color-red)]"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-[var(--color-charcoal)] whitespace-pre-wrap">
                {note.content}
              </p>
              <p className="mt-2 text-[10px] text-[var(--color-slate)]">
                {note.author.firstName} {note.author.lastName} ·{" "}
                {new Date(note.createdAt).toLocaleDateString("en-AU", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

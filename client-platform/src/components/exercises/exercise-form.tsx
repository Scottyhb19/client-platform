"use client";

import { useState } from "react";
import { MOVEMENT_PATTERNS, PRESCRIPTION_METRICS } from "@/lib/constants";

type Tag = { id: string; name: string };

type ExerciseFormProps = {
  exercise?: {
    id: string;
    name: string;
    movementPattern: string;
    videoUrl: string | null;
    instructions: string | null;
    defaultSets: number | null;
    defaultReps: string | null;
    defaultRest: string | null;
    defaultRpe: number | null;
    defaultMetric: string | null;
    defaultLoad: string | null;
    tags: Tag[];
  } | null;
  tags: Tag[];
  onClose: () => void;
};

export function ExerciseForm({ exercise, tags, onClose }: ExerciseFormProps) {
  const isEditing = !!exercise;

  const [name, setName] = useState(exercise?.name ?? "");
  const [movementPattern, setMovementPattern] = useState(
    exercise?.movementPattern ?? "OTHER"
  );
  const [videoUrl, setVideoUrl] = useState(exercise?.videoUrl ?? "");
  const [instructions, setInstructions] = useState(
    exercise?.instructions ?? ""
  );
  const [defaultSets, setDefaultSets] = useState(
    exercise?.defaultSets?.toString() ?? ""
  );
  const [defaultReps, setDefaultReps] = useState(exercise?.defaultReps ?? "");
  const [defaultRest, setDefaultRest] = useState(exercise?.defaultRest ?? "");
  const [defaultRpe, setDefaultRpe] = useState(
    exercise?.defaultRpe?.toString() ?? ""
  );
  const [defaultMetric, setDefaultMetric] = useState(
    exercise?.defaultMetric ?? "kg"
  );
  const [defaultLoad, setDefaultLoad] = useState(exercise?.defaultLoad ?? "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    exercise?.tags.map((t) => t.id) ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function toggleTag(id: string) {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Exercise name is required");
      return;
    }
    setSaving(true);
    setError("");

    const payload = {
      name,
      movementPattern,
      videoUrl: videoUrl || null,
      instructions: instructions || null,
      defaultSets: defaultSets ? parseInt(defaultSets) : null,
      defaultReps: defaultReps || null,
      defaultRest: defaultRest || null,
      defaultRpe: defaultRpe ? parseInt(defaultRpe) : null,
      defaultMetric: defaultMetric || null,
      defaultLoad: defaultLoad || null,
      tagIds: selectedTagIds,
    };

    const url = isEditing
      ? `/api/exercises/${exercise.id}`
      : "/api/exercises";
    const method = isEditing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Something went wrong");
      setSaving(false);
      return;
    }

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <h2 className="text-lg font-bold text-[var(--color-charcoal)] font-[family-name:var(--font-display)]">
            {isEditing ? "Edit Exercise" : "New Exercise"}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--color-slate)] hover:bg-[var(--color-bg)]"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <p className="text-sm text-[var(--color-red)]">{error}</p>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-slate)] mb-1">
              Exercise Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
              autoFocus
            />
          </div>

          {/* Movement Pattern */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-slate)] mb-1">
              Movement Pattern
            </label>
            <select
              value={movementPattern}
              onChange={(e) => setMovementPattern(e.target.value)}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
            >
              {MOVEMENT_PATTERNS.map((mp) => (
                <option key={mp.value} value={mp.value}>
                  {mp.label}
                </option>
              ))}
            </select>
          </div>

          {/* Default Prescription */}
          <fieldset>
            <legend className="text-xs font-medium text-[var(--color-slate)] mb-2">
              Default Prescription
            </legend>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] text-[var(--color-slate)] mb-0.5">
                  Sets
                </label>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={defaultSets}
                  onChange={(e) => setDefaultSets(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--color-slate)] mb-0.5">
                  Reps
                </label>
                <input
                  type="text"
                  placeholder="e.g. 8-12"
                  value={defaultReps}
                  onChange={(e) => setDefaultReps(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--color-slate)] mb-0.5">
                  Rest
                </label>
                <input
                  type="text"
                  placeholder="e.g. 60s"
                  value={defaultRest}
                  onChange={(e) => setDefaultRest(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2">
              <div>
                <label className="block text-[10px] text-[var(--color-slate)] mb-0.5">
                  Metric
                </label>
                <select
                  value={defaultMetric}
                  onChange={(e) => setDefaultMetric(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                >
                  {PRESCRIPTION_METRICS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-[var(--color-slate)] mb-0.5">
                  Load
                </label>
                <input
                  type="text"
                  placeholder="e.g. 40"
                  value={defaultLoad}
                  onChange={(e) => setDefaultLoad(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--color-slate)] mb-0.5">
                  RPE (1-10)
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={defaultRpe}
                  onChange={(e) => setDefaultRpe(e.target.value)}
                  className="w-full rounded-lg border border-[var(--color-border)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>
            </div>
          </fieldset>

          {/* Video URL */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-slate)] mb-1">
              YouTube Video URL
            </label>
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-xs font-medium text-[var(--color-slate)] mb-1">
              Coaching Instructions
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              placeholder="Cues, common errors, contraindications..."
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)] resize-none"
            />
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-slate)] mb-2">
                Tags
              </label>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      selectedTagIds.includes(tag.id)
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-[var(--color-bg)] text-[var(--color-slate)] hover:bg-[var(--color-border)]"
                    }`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-slate)] hover:bg-[var(--color-bg)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-primary-dark)] transition-colors disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Create Exercise"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { MOVEMENT_PATTERNS } from "@/lib/constants";
import { ExerciseCard } from "./exercise-card";
import { ExerciseForm } from "./exercise-form";

type Tag = { id: string; name: string };
type Exercise = {
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
  usageCount: number;
  tags: Tag[];
};

export function ExerciseLibrary() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [search, setSearch] = useState("");
  const [activePattern, setActivePattern] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchExercises = useCallback(async () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (activePattern) params.set("pattern", activePattern);
    if (activeTag) params.set("tag", activeTag);

    const res = await fetch(`/api/exercises?${params}`);
    if (res.ok) setExercises(await res.json());
    setLoading(false);
  }, [search, activePattern, activeTag]);

  const fetchTags = useCallback(async () => {
    const res = await fetch("/api/tags");
    if (res.ok) setTags(await res.json());
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    const timer = setTimeout(fetchExercises, 200);
    return () => clearTimeout(timer);
  }, [fetchExercises]);

  function handleEdit(exercise: Exercise) {
    setEditingExercise(exercise);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/exercises/${id}`, { method: "DELETE" });
    fetchExercises();
  }

  function handleFormClose() {
    setShowForm(false);
    setEditingExercise(null);
    fetchExercises();
  }

  return (
    <div>
      {/* Search bar */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search exercises..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm text-[var(--color-charcoal)] placeholder-[var(--color-slate)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
        />
      </div>

      {/* Movement pattern filter chips */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={() => setActivePattern(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !activePattern
              ? "bg-[var(--color-primary)] text-white"
              : "bg-white text-[var(--color-slate)] border border-[var(--color-border)] hover:bg-[var(--color-bg)]"
          }`}
        >
          All
        </button>
        {MOVEMENT_PATTERNS.map((mp) => (
          <button
            key={mp.value}
            onClick={() =>
              setActivePattern(activePattern === mp.value ? null : mp.value)
            }
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activePattern === mp.value
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white text-[var(--color-slate)] border border-[var(--color-border)] hover:bg-[var(--color-bg)]"
            }`}
          >
            {mp.label}
          </button>
        ))}
      </div>

      {/* Tag filter chips */}
      {tags.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag.id}
              onClick={() =>
                setActiveTag(activeTag === tag.name ? null : tag.name)
              }
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTag === tag.name
                  ? "bg-[var(--color-accent)] text-white"
                  : "bg-white text-[var(--color-slate)] border border-[var(--color-border)] hover:bg-[var(--color-bg)]"
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {/* Exercise list */}
      {loading ? (
        <p className="text-sm text-[var(--color-slate)]">Loading...</p>
      ) : exercises.length === 0 ? (
        <div className="rounded-xl border border-[var(--color-border)] bg-white p-8 text-center">
          <p className="text-[var(--color-slate)]">
            {search || activePattern || activeTag
              ? "No exercises match your filters."
              : "No exercises yet. Create your first one."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {exercises.map((exercise) => (
            <ExerciseCard
              key={exercise.id}
              exercise={exercise}
              onEdit={() => handleEdit(exercise)}
              onDelete={() => handleDelete(exercise.id)}
            />
          ))}
        </div>
      )}

      {/* + Create New Exercise button */}
      <button
        onClick={() => {
          setEditingExercise(null);
          setShowForm(true);
        }}
        className="mt-4 w-full rounded-xl border-2 border-dashed border-[var(--color-border)] bg-white py-3 text-sm font-medium text-[var(--color-primary)] hover:border-[var(--color-primary)] hover:bg-[var(--color-bg)] transition-colors"
      >
        + Create New Exercise
      </button>

      {/* Create/Edit form modal */}
      {showForm && (
        <ExerciseForm
          exercise={editingExercise}
          tags={tags}
          onClose={handleFormClose}
        />
      )}
    </div>
  );
}

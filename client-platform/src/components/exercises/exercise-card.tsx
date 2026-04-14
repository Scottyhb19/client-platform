"use client";

type Tag = { id: string; name: string };

type ExerciseCardProps = {
  exercise: {
    id: string;
    name: string;
    movementPattern: string;
    videoUrl: string | null;
    defaultSets: number | null;
    defaultReps: string | null;
    defaultRest: string | null;
    defaultRpe: number | null;
    defaultMetric: string | null;
    defaultLoad: string | null;
    usageCount: number;
    tags: Tag[];
  };
  onEdit: () => void;
  onDelete: () => void;
};

const patternLabels: Record<string, string> = {
  PUSH: "Push",
  PULL: "Pull",
  SQUAT: "Squat",
  HINGE: "Hinge",
  CARRY: "Carry",
  CORE: "Core",
  ISOMETRIC: "Isometric",
  OTHER: "Other",
};

export function ExerciseCard({ exercise, onEdit, onDelete }: ExerciseCardProps) {
  const prescription = [
    exercise.defaultSets && `${exercise.defaultSets} sets`,
    exercise.defaultReps && `${exercise.defaultReps} reps`,
    exercise.defaultLoad &&
      exercise.defaultMetric &&
      `${exercise.defaultLoad} ${exercise.defaultMetric}`,
    exercise.defaultRest && `${exercise.defaultRest} rest`,
    exercise.defaultRpe && `RPE ${exercise.defaultRpe}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center gap-4 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
      {/* Video indicator */}
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          exercise.videoUrl
            ? "bg-[var(--color-primary)] text-white"
            : "bg-[var(--color-bg)] text-[var(--color-slate)]"
        }`}
      >
        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z" />
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--color-charcoal)] truncate">
            {exercise.name}
          </h3>
          <span className="shrink-0 rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-slate)]">
            {patternLabels[exercise.movementPattern] || exercise.movementPattern}
          </span>
        </div>

        {prescription && (
          <p className="mt-0.5 text-xs text-[var(--color-slate)]">
            {prescription}
          </p>
        )}

        {exercise.tags.length > 0 && (
          <div className="mt-1 flex gap-1">
            {exercise.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]"
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="rounded-lg p-2 text-[var(--color-slate)] hover:bg-[var(--color-bg)] hover:text-[var(--color-charcoal)] transition-colors"
          title="Edit"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg p-2 text-[var(--color-slate)] hover:bg-red-50 hover:text-[var(--color-red)] transition-colors"
          title="Delete"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
        </button>
      </div>
    </div>
  );
}

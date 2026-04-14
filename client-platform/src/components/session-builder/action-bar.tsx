"use client";

interface Props {
  isSupersetted: boolean;
  onToggleSuperset: () => void;
  onAddExercise: () => void;
}

export function ActionBar({ isSupersetted, onToggleSuperset, onAddExercise }: Props) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 my-0.5">
      <button
        onClick={onToggleSuperset}
        className={`font-[family-name:var(--font-body)] text-[0.68rem] font-semibold cursor-pointer py-0.5 px-2.5 rounded border border-transparent bg-transparent transition-all flex items-center gap-1 ${
          isSupersetted
            ? "text-[var(--color-red)] hover:bg-[var(--color-red)]/5 hover:border-[var(--color-red)]"
            : "text-[var(--color-accent)] hover:bg-[var(--color-accent)]/5 hover:border-[var(--color-accent)]"
        }`}
      >
        {isSupersetted ? "Ungroup" : "Superset"}
      </button>
      <span className="w-[3px] h-[3px] rounded-full bg-[var(--color-border)]" />
      <button
        onClick={onAddExercise}
        className="font-[family-name:var(--font-body)] text-[0.68rem] font-semibold text-[var(--color-slate)] cursor-pointer py-0.5 px-2.5 rounded border border-transparent bg-transparent transition-all hover:text-[var(--color-primary)] hover:border-[var(--color-border)] hover:bg-white flex items-center gap-1"
      >
        + Add Exercise
      </button>
    </div>
  );
}

import { ExerciseLibrary } from "@/components/exercises/exercise-library";

export default function ExercisesPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-charcoal)] font-[family-name:var(--font-display)]">
          Exercise Library
        </h1>
      </div>
      <ExerciseLibrary />
    </div>
  );
}

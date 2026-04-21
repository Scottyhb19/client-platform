export type NewExerciseState = {
  error: string | null
  fieldErrors: Partial<Record<'name', string>>
}

export const initialNewExerciseState: NewExerciseState = {
  error: null,
  fieldErrors: {},
}

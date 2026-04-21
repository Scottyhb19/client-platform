export type NewProgramState = {
  error: string | null
  fieldErrors: Partial<
    Record<'name' | 'duration_weeks' | 'days_per_week' | 'start_date', string>
  >
}

export const initialNewProgramState: NewProgramState = {
  error: null,
  fieldErrors: {},
}

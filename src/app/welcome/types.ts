export type WelcomeState = {
  error: string | null
  fieldErrors: Partial<Record<'password' | 'confirm', string>>
}

export const initialWelcomeState: WelcomeState = {
  error: null,
  fieldErrors: {},
}

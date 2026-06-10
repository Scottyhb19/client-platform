export type WelcomeState = {
  error: string | null
  // Set when the error's recovery requires an affordance the form itself
  // can't provide — 'sign-out' renders a sign-out escape under the form
  // (the account-mismatch case tells the user to sign out, so the page
  // must make that possible in place).
  recovery?: 'sign-out'
  fieldErrors: Partial<Record<'password' | 'confirm', string>>
}

export const initialWelcomeState: WelcomeState = {
  error: null,
  fieldErrors: {},
}

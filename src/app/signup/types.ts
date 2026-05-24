export type SignupState = {
  error: string | null
  email: string
}

export const initialSignupState: SignupState = {
  error: null,
  email: '',
}

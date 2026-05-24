export type SignupState = {
  status?: 'entering' | 'check-email'
  error: string | null
  email: string
}

export const initialSignupState: SignupState = {
  status: 'entering',
  error: null,
  email: '',
}

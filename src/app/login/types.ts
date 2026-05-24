export type LoginState = {
  error: string | null
  email: string
}

export const initialLoginState: LoginState = {
  error: null,
  email: '',
}

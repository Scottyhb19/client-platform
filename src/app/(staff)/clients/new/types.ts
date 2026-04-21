export type InviteClientState = {
  error: string | null
  fieldErrors: Partial<Record<'first_name' | 'last_name' | 'email', string>>
}

export const initialInviteClientState: InviteClientState = {
  error: null,
  fieldErrors: {},
}

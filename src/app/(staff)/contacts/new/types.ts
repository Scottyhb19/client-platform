export type NewContactState = {
  error: string | null
  fieldErrors: Partial<Record<'name' | 'contact_group', string>>
}

export const initialNewContactState: NewContactState = {
  error: null,
  fieldErrors: {},
}

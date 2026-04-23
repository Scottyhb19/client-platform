/**
 * Shared state shape for the settings forms. Lives in its own file (not
 * in actions.ts) because Next.js 16 requires every export of a
 * 'use server' file to be an async function — types and constants must
 * be colocated elsewhere.
 */

export type SettingsState = {
  error: string | null
  success: boolean
}

export const initialSettingsState: SettingsState = {
  error: null,
  success: false,
}

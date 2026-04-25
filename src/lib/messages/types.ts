/**
 * Hand-written types for the messaging tables.
 *
 * Mirrors supabase/migrations/20260425100000_messages.sql. These exist because
 * src/types/database.ts is generated from the live schema via
 * `npm run supabase:types`, which has not been re-run since this migration
 * landed. Keep these in sync with the migration until the next gen-types pass
 * folds them into the canonical types.
 */

export type SenderRole = 'staff' | 'client'

export interface MessageThreadRow {
  id: string
  organization_id: string
  client_id: string
  last_message_at: string | null
  last_message_preview: string | null
  last_message_sender_role: SenderRole | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface MessageRow {
  id: string
  thread_id: string
  organization_id: string
  sender_user_id: string
  sender_role: SenderRole
  body: string
  read_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export const MESSAGE_BODY_MAX = 1000

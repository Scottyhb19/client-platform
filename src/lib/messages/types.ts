/**
 * Convenience types for the messaging tables.
 *
 * Row shapes are aliased from the generated database types so they stay in
 * sync automatically — re-running `npm run supabase:types` propagates any
 * column change here. The constants and the SenderRole literal type live
 * here because they're domain-level values not derivable from the schema.
 */

import type { Database } from '@/types/database'

export type SenderRole = 'staff' | 'client'

export type MessageThreadRow = Database['public']['Tables']['message_threads']['Row']
export type MessageRow = Database['public']['Tables']['messages']['Row']

export const MESSAGE_BODY_MAX = 1000

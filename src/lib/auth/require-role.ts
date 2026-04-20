import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export type UserRole = 'owner' | 'staff' | 'client'

export interface AuthContext {
  userId: string
  email: string
  role: UserRole
  organizationId: string
}

/**
 * Server-Component / Server-Action helper. Confirms the caller is signed in
 * AND holds one of the allowed roles in their active organization.
 *
 * This is a UX gate — RLS is the security boundary. A bug here cannot leak
 * data; it just means the wrong screen renders.
 *
 * Usage:
 *   export default async function StaffDashboard() {
 *     const { userId, organizationId } = await requireRole(['owner', 'staff'])
 *     ...
 *   }
 */
export async function requireRole(allowed: UserRole[]): Promise<AuthContext> {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Read the JWT custom claims via our Postgres helpers.
  // RPC over Supabase auth claims to keep the source-of-truth in the DB.
  const [{ data: orgId }, { data: role }] = await Promise.all([
    supabase.rpc('user_organization_id'),
    supabase.rpc('user_role'),
  ])

  // No active org yet — user just signed up but hasn't completed onboarding.
  if (!orgId || !role) {
    redirect('/onboarding/org')
  }

  if (!allowed.includes(role as UserRole)) {
    redirect('/unauthorized')
  }

  return {
    userId: user.id,
    email: user.email ?? '',
    role: role as UserRole,
    organizationId: orgId as string,
  }
}

/**
 * Lighter helper: just confirms an auth session exists.
 * Used in routes that don't need role/org context yet.
 */
export async function requireAuth() {
  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return { userId: user.id, email: user.email ?? '' }
}

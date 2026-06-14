import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PRACTICE_TIMEZONE } from '@/lib/constants'
import { isValidTimeZone, todayIsoInTimeZone } from '@/lib/dates'
import { PORTAL_TZ_COOKIE } from './portal-helpers'

// Server-only: imports next/headers. Never import this from a 'use client'
// module — import PORTAL_TZ_COOKIE from ./portal-helpers there instead.

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

/**
 * Resolve the timezone the portal should treat as "today" for this request.
 *
 * Section 7 / Q2: follow the device (so "today" auto-adjusts when the client
 * travels), with the org timezone as the server-side fallback and
 * PRACTICE_TIMEZONE as the backstop. Order:
 *   1. the `portal_tz` cookie (device IANA zone, set by TimezoneSync) —
 *      client-set, so validated before use;
 *   2. the caller's organization.timezone (a client can SELECT its own org
 *      row under RLS — the booking flow already does);
 *   3. PRACTICE_TIMEZONE.
 *
 * The org row is only queried when the cookie is absent/invalid — i.e. the
 * first load before TimezoneSync has written the cookie — so the steady
 * state pays no extra query.
 */
export async function resolvePortalTimeZone(
  supabase: ServerClient,
): Promise<string> {
  const cookieTz = (await cookies()).get(PORTAL_TZ_COOKIE)?.value
  if (isValidTimeZone(cookieTz)) return cookieTz

  const { data: org } = await supabase
    .from('organizations')
    .select('timezone')
    .maybeSingle()
  const orgTz = org?.timezone
  if (isValidTimeZone(orgTz)) return orgTz

  return PRACTICE_TIMEZONE
}

/** The resolved timezone plus today's ISO `YYYY-MM-DD` in it. */
export async function resolvePortalToday(
  supabase: ServerClient,
): Promise<{ tz: string; todayIso: string }> {
  const tz = await resolvePortalTimeZone(supabase)
  return { tz, todayIso: todayIsoInTimeZone(tz) }
}

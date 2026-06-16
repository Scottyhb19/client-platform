// Public, unauthenticated .ics calendar feed (Section 9 P2-15 B).
//
// SECURITY: this route is NOT the service-role route — the health route stays
// the only unauthenticated service-role route. This handler uses an ANON client
// and calls the anon-EXECUTE calendar_feed_events RPC, which is the security
// boundary: it validates the token in-body and RETURNS only de-identified
// columns (type / kind / time / location). No client name, no notes, no client
// id can reach this serialiser — the RPC cannot return them. An unknown or
// revoked token yields an empty calendar, never an error and never PHI.

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

export const dynamic = 'force-dynamic'

type FeedEvent = {
  appointment_type: string
  kind: string
  start_at: string
  end_at: string
  location: string | null
}

/** Escape per RFC 5545 text rules (backslash, semicolon, comma, newline). */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTC instant → iCalendar basic format YYYYMMDDTHHMMSSZ. */
function toIcsUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Deterministic, de-identified UID (djb2 over start|end|type). The feed is
 * re-fetched whole on each poll, so the UID only needs to be stable + unique
 * within one feed — it carries no client identifier.
 */
function uidFor(e: FeedEvent): string {
  const key = `${e.start_at}|${e.end_at}|${e.appointment_type}`
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0
  return `odyssey-${h.toString(16)}@odysseyhq.com.au`
}

function buildIcs(events: FeedEvent[]): string {
  const dtstamp = toIcsUtc(new Date().toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OdysseyHQ//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Odyssey schedule',
  ]
  for (const e of events) {
    // SUMMARY is the session type only — never a client name. Unavailable
    // blocks are labelled as such; notes are deliberately omitted entirely.
    const summary =
      e.kind === 'unavailable'
        ? `${e.appointment_type} (unavailable)`
        : e.appointment_type
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uidFor(e)}`)
    lines.push(`DTSTAMP:${dtstamp}`)
    lines.push(`DTSTART:${toIcsUtc(e.start_at)}`)
    lines.push(`DTEND:${toIcsUtc(e.end_at)}`)
    lines.push(`SUMMARY:${icsEscape(summary)}`)
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  const { data, error } = await supabase.rpc('calendar_feed_events', {
    p_token: token,
  })

  if (error) {
    return new Response('Calendar feed unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const ics = buildIcs((data ?? []) as FeedEvent[])

  return new Response(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="odyssey-schedule.ics"',
      // No caching — keeps revocation effective on the calendar app's next poll
      // and avoids any intermediary caching the (token-bearing) response.
      'Cache-Control': 'no-store',
    },
  })
}

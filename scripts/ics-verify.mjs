// ============================================================================
// ics-verify.mjs
// ============================================================================
// Section 9 (Scheduling) — P2-15 (B) .ics serialiser check.
//
// The DB layer already guarantees PHI exclusion: calendar_feed_events RETURNS
// only type/kind/time/location (pgTAP 32), so the serialiser never even
// receives a client name or notes. This proves the OTHER half — that the
// VCALENDAR output is well-formed and carries no client-bearing fields
// (no DESCRIPTION, no ATTENDEE/ORGANIZER), labels unavailable blocks, and
// escapes RFC 5545 text correctly.
//
//   node scripts/ics-verify.mjs
//
// The helpers below MIRROR src/app/api/calendar/[token]/route.ts — keep in sync.
// ============================================================================

function icsEscape(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

function toIcsUtc(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function uidFor(e) {
  const key = `${e.start_at}|${e.end_at}|${e.appointment_type}`
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0
  return `odyssey-${h.toString(16)}@odysseyhq.com.au`
}

function buildIcs(events) {
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

let pass = 0
let fail = 0
function check(label, cond) {
  if (cond) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}`)
  }
}

const events = [
  {
    appointment_type: 'Initial assessment',
    kind: 'appointment',
    start_at: '2026-06-18T01:00:00.000Z', // 11:00 AEST
    end_at: '2026-06-18T02:00:00.000Z',
    location: 'Studio A, Level 2',
  },
  {
    appointment_type: 'Admin',
    kind: 'unavailable',
    start_at: '2026-06-18T04:00:00.000Z',
    end_at: '2026-06-18T05:00:00.000Z',
    location: null,
  },
]

const ics = buildIcs(events)

check('starts with BEGIN:VCALENDAR', ics.startsWith('BEGIN:VCALENDAR\r\n'))
check('ends with END:VCALENDAR', ics.trimEnd().endsWith('END:VCALENDAR'))
check('two VEVENT blocks', (ics.match(/BEGIN:VEVENT/g) || []).length === 2)
check('appointment SUMMARY is the type', ics.includes('SUMMARY:Initial assessment'))
check(
  'unavailable block is labelled',
  ics.includes('SUMMARY:Admin (unavailable)'),
)
check('NO DESCRIPTION line (notes never serialised)', !ics.includes('DESCRIPTION'))
check('NO ATTENDEE line (no client)', !ics.includes('ATTENDEE'))
check('NO ORGANIZER line (no client)', !ics.includes('ORGANIZER'))
check('DTSTART in UTC basic format', /DTSTART:\d{8}T\d{6}Z/.test(ics))
check('comma in LOCATION is escaped', ics.includes('LOCATION:Studio A\\, Level 2'))
check('CRLF line endings', ics.includes('\r\n') && !/[^\r]\n/.test(ics))
check(
  'UID is deterministic for the same event',
  uidFor(events[0]) === uidFor(events[0]),
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

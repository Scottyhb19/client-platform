/**
 * "Current block" resolution — gap doc P1-8 / §4 Q3 (docs/polish/programs.md):
 *   1. The program containing today.
 *   2. Else the most recent past program.
 *   3. Else null.
 *
 * Lifted out of the program-calendar page (P1-5, program-calendar polish
 * pass 2026-06-12) so the client-profile Program tab can use the same rule —
 * its previous `.maybeSingle()` active-program query ERRORS the moment a
 * client has two active blocks (back-to-back blocks are first-class since
 * D-PROG-002).
 *
 * Callers pass blocks sorted ascending by start_date with non-null
 * start_date/duration_weeks (filter before calling). `todayIso` comes from
 * `todayIsoInPracticeTz()` — never a UTC-derived date (P0-2).
 */

export interface BlockLike {
  start_date: string // ISO 'YYYY-MM-DD'
  duration_weeks: number
}

export function resolveCurrentBlock<T extends BlockLike>(
  blocks: T[],
  todayIso: string,
): T | null {
  if (blocks.length === 0) return null

  for (const b of blocks) {
    const end = addDaysIso(b.start_date, b.duration_weeks * 7)
    if (todayIso >= b.start_date && todayIso < end) return b
  }

  // Most recent past (ascending input; iterate from the end).
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]!
    if (b.start_date <= todayIso) return b
  }

  return null
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

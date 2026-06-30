import { describe, it, expect } from 'vitest'
import { removalActionForAppointment } from './appointment-removal'

// RO-6 regression: the bug that triggered the schedule round-three reopen was
// the popover routing a null-client appointment to the unavailable-only RPC.
// That routing decision now lives in removalActionForAppointment(); these tests
// exercise it directly (pgTAP 49 only proves the two server RPCs, not the route).
describe('removalActionForAppointment — RO-6 removal routing', () => {
  it('archives a real appointment whose client was deleted (null client join)', () => {
    // The exact defect: an orphaned appointment must NOT go to the unavailable
    // path just because its client join came back null.
    expect(removalActionForAppointment({ kind: 'appointment', client: null })).toBe(
      'archive',
    )
  })

  it('archives a normal appointment that still has a client', () => {
    expect(
      removalActionForAppointment({ kind: 'appointment', client: { id: 'c1' } }),
    ).toBe('archive')
  })

  it('routes a genuine unavailable block to the unavailable removal path', () => {
    expect(
      removalActionForAppointment({ kind: 'unavailable', client: null }),
    ).toBe('remove-unavailable')
  })
})

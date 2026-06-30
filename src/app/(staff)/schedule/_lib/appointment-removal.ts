/**
 * RO-6 removal routing — kept dependency-free (no React/Next imports) so it can
 * be unit-tested directly without loading the popover's module graph.
 */

export type AppointmentKind = 'appointment' | 'unavailable'

/**
 * Which removal path the popover "Remove" should take for a no-client card.
 *
 * The discriminator is the row's KIND, never the presence of a client object.
 * A `kind='appointment'` row whose client was soft-deleted arrives with
 * `client=null` (RLS hides the deleted client), but it is still a real
 * appointment and must ARCHIVE. RO-6 regressed exactly here: routing on
 * client-absence sent the orphan to the `kind='unavailable'`-scoped RPC, which
 * raised `no_data_found` and left the row stuck ("won't delete").
 *
 * `client` is part of the signature ONLY to make that independence explicit and
 * testable — it is deliberately ignored. The two server destinations this picks
 * are additionally locked by pgTAP `49`.
 */
export function removalActionForAppointment(appt: {
  kind: AppointmentKind
  client: unknown | null
}): 'archive' | 'remove-unavailable' {
  return appt.kind === 'unavailable' ? 'remove-unavailable' : 'archive'
}

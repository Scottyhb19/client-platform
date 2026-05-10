/**
 * PortalFramingBlock — the EP's framing text rendered above a test card's
 * charts. Voice per design system §02 and brief §6.4: quiet, factual,
 * clinician's notepad. Drawn from the most recent live publication for
 * this test (per Phase E sign-off Q3).
 *
 * The text is undated by design — the chart's date axis carries time;
 * "EP commented N days ago" would be noise the client doesn't need.
 */

interface Props {
  text: string
}

export function PortalFramingBlock({ text }: Props) {
  return <p className="portal-framing-block">{text}</p>
}

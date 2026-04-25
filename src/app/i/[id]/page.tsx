import {
  AuthAlert,
  AuthEyebrow,
  AuthHeading,
  AuthShell,
  AuthSubtitle,
} from '@/components/auth/AuthShell'
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'
import { ContinueGate } from './_components/ContinueGate'

export const dynamic = 'force-dynamic'

/**
 * Click-through gate for invite emails.
 *
 * Email contains a link to /i/<id> (this route). When the human clicks it
 * we look up the matching invite_tokens row and either render an error or
 * a "Continue to your portal" button. The button — not an auto-redirect —
 * is what defeats Gmail's link prefetch: a prefetcher hits THIS page,
 * sees no Location header, and stops. The Supabase verify URL only fires
 * when a real human taps the button.
 *
 * Auth: this route is public (clients clicking invite emails aren't signed
 * in yet). The lookup uses the service-role client because invite_tokens
 * RLS denies all authenticated access by design — the action_link inside
 * is a secret. Don't add an `authenticated` SELECT policy without
 * understanding what that exposes.
 */
export default async function InviteGatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Cheap pre-check: bad UUID shape → don't even query.
  if (!isUuid(id)) return <ErrorShell reason="not_found" />

  const admin = createSupabaseServiceRoleClient()

  // Service-role select; RLS denies authenticated.
  const { data: token, error } = await admin
    .from('invite_tokens')
    .select(
      'id, organization_id, client_id, action_link, expires_at, consumed_at',
    )
    .eq('id', id)
    .maybeSingle()

  if (error || !token) return <ErrorShell reason="not_found" />

  if (token.consumed_at !== null) return <ErrorShell reason="consumed" />
  if (new Date(token.expires_at).getTime() < Date.now()) {
    return <ErrorShell reason="expired" />
  }

  // Greet by name when we can. Service-role bypasses RLS so this works
  // pre-auth. Both the client name and the practice name are non-secret
  // by themselves — fine to render in HTML.
  const [{ data: client }, { data: org }] = await Promise.all([
    admin
      .from('clients')
      .select('first_name, last_name')
      .eq('id', token.client_id)
      .maybeSingle(),
    admin
      .from('organizations')
      .select('name')
      .eq('id', token.organization_id)
      .maybeSingle(),
  ])

  return (
    <AuthShell>
      <AuthEyebrow>{org?.name ?? 'Your practice'}</AuthEyebrow>
      <AuthHeading>
        {client?.first_name
          ? `One tap, ${client.first_name}.`
          : 'One tap to continue.'}
      </AuthHeading>
      <AuthSubtitle>
        Tap below to open your portal. We&rsquo;ll set you up with a password
        and add the app to your home screen on the next screen.
      </AuthSubtitle>
      <ContinueGate actionLink={token.action_link} />
    </AuthShell>
  )
}

function ErrorShell({
  reason,
}: {
  reason: 'not_found' | 'consumed' | 'expired'
}) {
  const messages: Record<typeof reason, string> = {
    not_found:
      "This invite link isn't valid. Ask your practitioner to resend it.",
    consumed:
      'This invite link has already been used. If you didn’t sign in, ask your practitioner to resend.',
    expired:
      'This invite link has expired. Ask your practitioner to resend it — they expire after 8 hours.',
  }
  return (
    <AuthShell>
      <AuthEyebrow>Invite link</AuthEyebrow>
      <AuthHeading>Link unavailable.</AuthHeading>
      <AuthAlert>{messages[reason]}</AuthAlert>
    </AuthShell>
  )
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s,
  )
}

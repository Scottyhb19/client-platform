'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { WelcomeState } from './types'

/**
 * Accept-invite action. Called from /welcome after the magic-link
 * callback has established a session for the user.
 *
 * Order matters:
 *   1. Set the password so the user can log in via email/password next
 *      time (Supabase auth sessions expire; they can't rely on the OTP).
 *   2. Call client_accept_invite RPC (SECURITY DEFINER) to:
 *        - verify the caller's email matches the invited clients row,
 *        - link clients.user_id = auth.uid(),
 *        - create the user_organization_roles 'client' row.
 *   3. Force a session refresh so the JWT picks up the new role/org
 *      claims from the Custom Access Token Hook.
 *   4. Redirect to /portal.
 */
export async function setPasswordAndAcceptAction(
  _prev: WelcomeState,
  formData: FormData,
): Promise<WelcomeState> {
  const clientId = (formData.get('client_id') ?? '').toString()
  const password = (formData.get('password') ?? '').toString()
  const confirm = (formData.get('confirm') ?? '').toString()

  const fieldErrors: WelcomeState['fieldErrors'] = {}
  if (password.length < 12) {
    fieldErrors.password = 'At least 12 characters, please.'
  }
  if (password !== confirm) {
    fieldErrors.confirm = "Passwords don't match."
  }
  if (!clientId) {
    return { error: 'Missing invite context. Ask for a fresh invite.', fieldErrors: {} }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors }
  }

  const supabase = await createSupabaseServerClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      error:
        'Your invite link expired. Ask your EP to resend it.',
      fieldErrors: {},
    }
  }

  // 1. Set password
  const { error: pwErr } = await supabase.auth.updateUser({ password })
  if (pwErr) {
    return { error: `Couldn't set password: ${pwErr.message}`, fieldErrors: {} }
  }

  // 2. Accept the invite via the SECURITY DEFINER function.
  const { error: acceptErr } = await supabase.rpc('client_accept_invite', {
    p_client_id: clientId,
  })
  if (acceptErr) {
    return {
      error: `Couldn't link your account: ${acceptErr.message}`,
      fieldErrors: {},
    }
  }

  // 3. Refresh the session so the JWT picks up role='client' + org_id.
  //    (updateUser above already returns a fresh session, but the
  //    custom-access-token hook runs on every issuance, so we're
  //    belt-and-braces here.)
  await supabase.auth.refreshSession()

  // 4. Nudge the install before they reach the portal. The install screen
  //    detects the platform and serves iOS Safari instructions, an Android
  //    one-tap install, or a "open this on your phone" desktop fallback.
  //    Already-installed clients (display-mode: standalone) auto-bounce
  //    through to /portal so it never feels like an extra step on return.
  redirect('/welcome/install')
}

// SECURITY BOUNDARY — DO NOT MODIFY WITHOUT RE-SCOPING. This file is the only
// unauthenticated route in the codebase that uses the Supabase service-role
// client. The service-role key bypasses all Row Level Security. This file
// performs exactly one query: a HEAD/count read against the organizations
// table that returns zero rows and no application data, used solely as a
// connectivity check. No other Supabase call may be added to this file. If
// health-check logic needs to grow beyond a connectivity check, factor the
// additional logic into a module called from this file with its own client
// and its own security review — do not extend this file inline. Violating
// this contract by adding queries that return row data, or by adding queries
// against tables containing client or clinical information, would expose the
// entire database to unauthenticated public access. If the organizations
// table is ever renamed or removed, update the query in this file as part of
// the same schema change.

import { NextResponse } from 'next/server'
import { createSupabaseServiceRoleClient } from '@/lib/supabase/server'
import { missingRequiredEnv } from '@/lib/env/required-env'
import { captureException } from '@/lib/observability/sentry'
import pkg from '../../../../package.json' with { type: 'json' }

export async function GET() {
  const version = pkg.version
  const timestamp = new Date().toISOString()

  // Config check (2026-06-10 incident): reports the NAMES of required env
  // vars that are unset — never values. Names are already public in the
  // repo's secrets-inventory; exposing which are missing trades a sliver
  // of recon surface for catching a misconfigured deploy on the first
  // post-deploy probe instead of at a user's sign-in.
  const missingEnv = missingRequiredEnv()
  const configOk = missingEnv.length === 0

  let dbOk = true
  try {
    const supabase = createSupabaseServiceRoleClient()
    const { error } = await supabase
      .from('organizations')
      .select('id', { head: true, count: 'exact' })
      .limit(1)
    if (error) throw error
  } catch (e) {
    captureException(e)
    dbOk = false
  }

  const healthy = dbOk && configOk
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      version,
      db: dbOk ? 'ok' : 'fail',
      config: configOk ? 'ok' : 'missing required env',
      ...(configOk ? {} : { missing_env: missingEnv }),
      timestamp,
    },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

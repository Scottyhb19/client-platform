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
import { captureException } from '@/lib/observability/sentry'
import pkg from '../../../../package.json' with { type: 'json' }

export async function GET() {
  const version = pkg.version
  const timestamp = new Date().toISOString()

  try {
    const supabase = createSupabaseServiceRoleClient()
    const { error } = await supabase
      .from('organizations')
      .select('id', { head: true, count: 'exact' })
      .limit(1)
    if (error) throw error

    return NextResponse.json(
      { status: 'ok', version, db: 'ok', timestamp },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    captureException(e)
    return NextResponse.json(
      {
        status: 'degraded',
        version,
        db: 'fail',
        error: 'database health check failed',
        timestamp,
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

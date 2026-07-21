import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Shared harness plumbing. Reads .env.local (the staging-default file) and
 * refuses to run against anything but the staging project — the harness
 * writes nothing itself, but the refusal keeps a misconfigured machine from
 * even probing production.
 */
export function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#') || !l.includes('=')) continue
    const i = l.indexOf('=')
    out[l.slice(0, i).trim()] = l.slice(i + 1).trim()
  }
  const stagingRef = out.STAGING_PROJECT_REF
  if (!stagingRef || !out.NEXT_PUBLIC_SUPABASE_URL?.includes(stagingRef)) {
    throw new Error(
      'Harness refused: .env.local default keys do not resolve to the staging project.',
    )
  }
  if (!out.STAGING_DEV_LOGIN_EMAIL || !out.STAGING_DEV_LOGIN_PASSWORD) {
    throw new Error(
      'Harness refused: STAGING_DEV_LOGIN_* missing — run `node scripts/seed-staging.mjs` first.',
    )
  }
  return out
}

/** Service-role staging client for fixture lookups (read-only usage). */
export function stagingAdmin() {
  const env = loadEnv()
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

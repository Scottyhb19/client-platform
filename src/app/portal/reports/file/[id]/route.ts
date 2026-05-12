import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Legacy report file resolver. Looks up the row through the RLS-scoped
 * Supabase client, asks Storage for a short-lived signed URL, and
 * 307-redirects the browser to it. The signed URL is generated per
 * request — it never lands in HTML, and the link the client tapped
 * never expires from their view (the handler regenerates each hit).
 *
 * Auth gate is handled by proxy.ts middleware — by the time we get
 * here, the request has a session. RLS on `reports` is the security
 * boundary; the explicit is_published / deleted_at filters here are
 * defense in depth.
 *
 * Every failure mode collapses to a 404 (no leak of whether the row
 * is missing, hidden, or its file is gone).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const supabase = await createSupabaseServerClient()

  const { data: row } = await supabase
    .from('reports')
    .select('storage_bucket, storage_path')
    .eq('id', id)
    .eq('is_published', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (!row) {
    return new NextResponse('Not found', { status: 404 })
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, 60)

  if (signErr || !signed) {
    return new NextResponse('Not found', { status: 404 })
  }

  const response = NextResponse.redirect(signed.signedUrl, { status: 307 })
  response.headers.set('Cache-Control', 'no-store')
  return response
}

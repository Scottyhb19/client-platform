import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16 renamed this file convention from `middleware` to `proxy`.
// The exported function name is `proxy` now; same request/response shape.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on all routes EXCEPT:
     * - _next/static (build output)
     * - _next/image (image optimization)
     * - favicon, common image types
     * - api/auth callbacks already handled by Supabase
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}

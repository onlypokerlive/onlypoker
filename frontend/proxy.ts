import { updateSession } from '@/lib/supabase/proxy'
import { type NextRequest } from 'next/server'

// Next.js 16 renamed the root `middleware` convention to `proxy`.
// This refreshes the Supabase auth session cookie on every matched request.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

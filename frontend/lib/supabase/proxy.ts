import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  // Depending on the Supabase "Site URL" / redirect config, Google can return
  // the user to any path (commonly `/`) with the OAuth `?code=` still attached.
  // Only /auth/callback exchanges that code for a session, so forward any stray
  // code there. This makes login work regardless of the exact redirect target.
  const code = request.nextUrl.searchParams.get('code')
  if (code && request.nextUrl.pathname !== '/auth/callback') {
    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto')
    const base = forwardedHost
      ? `${forwardedProto ?? 'https'}://${forwardedHost}`
      : request.nextUrl.origin

    const callbackUrl = new URL('/auth/callback', base)
    callbackUrl.searchParams.set('code', code)
    // Preserve where the user was headed (defaults to the current path).
    const next = request.nextUrl.searchParams.get('next')
    callbackUrl.searchParams.set(
      'next',
      next ?? (request.nextUrl.pathname === '/' ? '/' : request.nextUrl.pathname),
    )
    return NextResponse.redirect(callbackUrl)
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Secure cookies in production; not in dev, so localhost still works.
      cookieOptions: { secure: process.env.NODE_ENV === 'production' },
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run code between createServerClient and
  // supabase.auth.getUser(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getUser() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  // We only refresh the session here; auth is optional across the app, so
  // pages that need a signed-in user render their own sign-in prompt instead
  // of being force-redirected (guests can still play, host, and join).
  await supabase.auth.getUser()

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  return supabaseResponse
}

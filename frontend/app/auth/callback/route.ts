import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  // Behind the v0 preview / production proxy, request.nextUrl.origin is the
  // internal localhost address. Rebuild the public origin from the forwarded
  // headers so the post-login redirect lands on the real host, not localhost.
  // The forwarded headers only exist behind a proxy, so a truly local request
  // (no x-forwarded-host) safely falls back to origin.
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const publicOrigin = forwardedHost
    ? `${forwardedProto ?? 'https'}://${forwardedHost}`
    : origin

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${publicOrigin}${next}`)
    }
  }

  return NextResponse.redirect(`${publicOrigin}/auth/error`)
}

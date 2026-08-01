import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono, Playfair_Display } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-playfair',
})

const deploymentHost =
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  process.env.VERCEL_URL ??
  'http://localhost:3000'
const metadataBase = new URL(
  deploymentHost.startsWith('http') ? deploymentHost : `https://${deploymentHost}`,
)

export const metadata: Metadata = {
  metadataBase,
  title: 'Felt & Gold — Private Texas Hold’em',
  description:
    'Set up a private No-Limit Texas Hold’em table and invite your friends with one link. No account or download needed.',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#1b2a24',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`dark bg-background ${geistSans.variable} ${geistMono.variable} ${playfair.variable}`}
    >
      <body className="font-sans antialiased">
        <a
          href="#main-content"
          className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xl transition-transform focus:translate-y-0"
        >
          Skip to main content
        </a>
        {children}
        {/* Nothing was rendering these. Every `toast.error` the app has ever
            raised — a rejected action, a lost connection, a seat that closed
            — went nowhere, which reads as the tap not registering. Mounted
            here so it covers every route rather than only the table. */}
        <Toaster />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    // DEV-ONLY proxy. In the local sandbox the Python (FastAPI) backend runs as
    // a separate process on port 8000 and we proxy /api/* to it. This is gated
    // behind POKER_DEV_PROXY so it is NEVER active in production: on Vercel the
    // root vercel.json (experimentalServices) routes /api to the backend
    // service before Next.js is reached, so no rewrite is needed or wanted.
    if (process.env.POKER_DEV_PROXY !== "1") return []
    const backend = process.env.POKER_BACKEND_URL || "http://127.0.0.1:8000"
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }]
  },
}

export default nextConfig

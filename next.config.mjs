// In local/sandbox dev, the Python (FastAPI) poker backend runs as a separate
// process. We proxy /api/* to it. In production on Vercel, vercel.json's
// experimentalServices routes /api to the backend before Next sees it, so this
// rewrite is only exercised in dev.
const BACKEND_URL = process.env.POKER_BACKEND_URL || "http://127.0.0.1:8000"

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/:path*`,
      },
    ]
  },
}

export default nextConfig

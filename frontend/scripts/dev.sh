#!/usr/bin/env bash
# Runs the FastAPI backend and the Next.js dev server side by side.
#
# `package.json` points `npm run dev` here. Next proxies /api/* to the backend
# on port 8000 (see next.config.mjs, gated behind POKER_DEV_PROXY). Without
# Upstash credentials the backend keeps rooms in memory, so this needs no
# external services — see backend/devstore.py.
set -euo pipefail

frontend="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend="$(cd "$frontend/.." && pwd)/backend"
port="${POKER_BACKEND_PORT:-8000}"

if [ ! -x "$backend/.venv/bin/python" ]; then
  echo "→ Creating the backend virtualenv…"
  if command -v uv >/dev/null 2>&1; then
    (cd "$backend" && uv venv .venv && uv pip install --python .venv/bin/python \
      "fastapi[standard]>=0.128.1" "pokerkit>=0.6.0" "upstash-redis>=1.2.0")
  else
    python3 -m venv "$backend/.venv"
    "$backend/.venv/bin/pip" install --quiet --upgrade pip
    "$backend/.venv/bin/pip" install --quiet \
      "fastapi[standard]>=0.128.1" "pokerkit>=0.6.0" "upstash-redis>=1.2.0"
  fi
fi

echo "→ Backend on http://127.0.0.1:$port"
(cd "$backend" && exec .venv/bin/python -m uvicorn main:asgi_app --port "$port" --reload) &
backend_pid=$!

# Take the dev server down with the backend, however this script exits.
cleanup() {
  kill "$backend_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "→ Frontend on http://localhost:3000"
cd "$frontend"
POKER_DEV_PROXY=1 POKER_BACKEND_URL="http://127.0.0.1:$port" exec npx next dev

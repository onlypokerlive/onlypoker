#!/usr/bin/env bash
# Dev launcher for the multi-service poker app.
#
# Starts the Python (FastAPI + pokerkit) backend and the Next.js frontend
# together so a single `pnpm dev` boots the whole stack. Next.js proxies
# /api/* to the backend (see next.config.mjs).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
BACKEND_PORT="${POKER_BACKEND_PORT:-8000}"

# Load local env (Upstash Redis credentials, etc.) if present.
if [ -f "$ROOT/.env.development.local" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env.development.local"
  set +a
fi

# --- Ensure the Python environment exists -------------------------------- #
cd "$BACKEND"
if [ ! -d ".venv" ]; then
  echo "[dev] creating Python venv..."
  uv venv >/dev/null 2>&1 || python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
if ! python -c "import pokerkit, fastapi, upstash_redis" >/dev/null 2>&1; then
  echo "[dev] installing Python dependencies..."
  uv pip install -e . >/dev/null 2>&1 || pip install -e . >/dev/null 2>&1
fi

# --- Start the backend --------------------------------------------------- #
echo "[dev] starting FastAPI backend on :$BACKEND_PORT"
uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT" &
BACKEND_PID=$!

# Make sure the backend is torn down with the dev server.
cleanup() {
  kill "$BACKEND_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- Start the frontend (foreground) ------------------------------------- #
cd "$ROOT"
echo "[dev] starting Next.js frontend on :3000"
exec pnpm exec next dev

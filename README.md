# onlypoker

Private No-Limit Texas Hold'em sit & go tables. Create a table, share one link,
and play from your phones — no accounts, no downloads.

## How a game runs

- **Blinds climb on a clock.** The host picks the opening blinds and how long a
  level lasts. Blinds move up one rung of the ladder each level; a level that
  expires mid-hand takes effect on the next deal.
- **Every decision has a shot clock.** 20 seconds by default. Running out checks
  when checking is free, and folds otherwise, so one player looking away never
  stalls the table.
- **Hole cards stay face down.** You hold a control to look at your hand, and it
  hides again the moment you let go, switch apps, or the next hand is dealt —
  nobody reads your cards over your shoulder.
- **Last player with chips wins**, and the final standings list who went out and
  when.

Both clocks are enforced by the server, so every phone agrees on the time and a
closed tab cannot dodge the shot clock.

## Layout

| Path        | What it is                                                        |
| ----------- | ----------------------------------------------------------------- |
| `frontend/` | Next.js app (App Router, Tailwind v4). Talks to `/api/*`.          |
| `backend/`  | FastAPI service wrapping the `pokerkit` engine. Mounted at `/api`. |

Game state lives in Upstash Redis: each request unpickles the pokerkit state,
applies at most one action, and writes it back, which keeps the engine
authoritative and works on serverless.

## Running it locally

```bash
cd frontend && npm run dev
```

That starts both processes: the Python backend on port 8000 and Next.js on
3000, with `/api/*` proxied to the backend. It creates the backend virtualenv on
first run (needs `uv`, or falls back to `python3 -m venv`).

Without Upstash credentials the backend keeps rooms in memory (see
`backend/devstore.py`), so local development needs no external services. Rooms
disappear when the process restarts.

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

Covers the blind ladder, every clock the table runs on, per-player card
redaction, who is allowed to do what, the chip ledger, and the tournament
endgame.

```bash
cd frontend && pnpm test && pnpm exec tsc --noEmit && pnpm lint
```

Bet sizing, the events derived from polling, the card-by-card runout, and the
components where getting a condition wrong shows somebody something they should
not see. `pnpm lint` is green; the React Compiler rules are left as warnings on
purpose — see the note in `frontend/eslint.config.mjs`.

## Deploying

`vercel.json` describes two Vercel services: `frontend/` and `backend/`
(entrypoint `main:asgi_app`). Requests to `/api/*` go to the backend with the
prefix intact, which is why the FastAPI app is mounted under `/api`.

**The backend needs `KV_REST_API_URL` and `KV_REST_API_TOKEN`** (the Upstash
integration sets both). Without them a deployed backend refuses to boot rather
than falling back to the in-memory store: every serverless invocation would get
its own empty copy, so players would watch rooms appear and disappear at random
instead of seeing one clear error.

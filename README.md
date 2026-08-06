# onlypoker

Private No-Limit Texas Hold'em sit & go tables. Create a table, share one link,
and play from your phones — no accounts, no downloads.

## How a game runs

- **The rules are agreed in the lobby.** Making a table asks for a name, a
  password and who you are. What kind of night it is — stakes, pace, antes,
  house rules, doors — is set afterwards, with the people it applies to already
  in the room, off four formats and a sheet for the night that wants one thing
  changed. The host can change it until the first hand is dealt and not after.
- **Blinds climb on a clock.** The host picks the opening blinds, how long a
  level lasts, and how far the blinds go up when they go up — gentle, standard
  or beast. Blinds move one rung of that ladder each level; a level that
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

The table remains accountless. The host receives a one-time recovery code that,
together with the room password, can move host authority to a new device. A host
can also hand control directly to a seated player. Recovery rotates both the
host credential and backup code; the old device and old code stop working.

## Table talk

Every private room has bounded text chat. Seated players can send; spectators
who entered through the room password can read but never receive a composer.
Authors are resolved from the existing `X-Player-Token` capability — the send
API accepts no player ID or display name.

Chat is deliberately separate from the serialized PokerKit room value under
`holdem:chat:{roomId}`. The newest 100 messages are retained, each with a
server-generated stable ID and server timestamp. Room and chat expiries move
together on every fenced write, so both keep the same rolling 24-hour room
lifetime. Per-seat rolling limits allow five messages per 10 seconds and 20 per
minute; retry IDs make a lost POST response return the original message rather
than duplicate it.

The client uses the existing HTTP/serverless model: 4-second polling while the
sheet is closed, 1.6-second polling while open, and no WebSocket service. The
newest message briefly appears in a fixed closed-state preview while its unread
badge remains durable. Neither that preview nor the portal sheet participates
in the poker table's `100svh` height calculation. Details and the API/privacy
contract are in [`docs/chat.md`](docs/chat.md).

## Layout

| Path        | What it is                                                        |
| ----------- | ----------------------------------------------------------------- |
| `frontend/` | Next.js app (App Router, Tailwind v4). Talks to `/api/*`.          |
| `backend/`  | FastAPI service wrapping the `pokerkit` engine. Mounted at `/api`. |

Game state lives in Upstash Redis: each game request unpickles the PokerKit
state, applies at most one action, and writes it back, which keeps the engine
authoritative and works on serverless. Bounded chat has its own Redis document
and never enters or rewrites that serialized game value.

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
cd backend && uv run --with pytest --frozen pytest tests/ -q
```

Covers the blind ladder, every clock the table runs on, per-player card
redaction, who is allowed to do what, the chip ledger, the tournament endgame,
and chat authentication/privacy/retention/lifecycle behavior.

```bash
cd frontend && pnpm test && pnpm exec tsc --noEmit && pnpm lint
```

Bet sizing, the events derived from polling, the card-by-card runout, chat sheet
focus/unread/safe-text behavior, and the components where getting a condition
wrong shows somebody something they should not see. `pnpm lint` is green; the
React Compiler rules are left as warnings on purpose — see the note in
`frontend/eslint.config.mjs`.

```bash
cd frontend && pnpm test:e2e
```

The Playwright journey starts isolated frontend/backend ports plus a test-only
signed-out Supabase stub. It checks compact-phone creation, host and guest play
through results and next-table actions, accountless host recovery and handoff,
expired-invite recovery, fixed table geometry, and player/spectator chat in
Chrome. It does not stub or claim coverage of OAuth/account flows.

## Growth measurement and invitations

Production uses Vercel Analytics custom events for the complete creation,
invitation, join, start, finish, results-share, and guest-to-host funnel. Both
success milestones and privacy-safe attempt/failure outcomes are recorded so a
conversion drop can be distinguished from validation, authentication, network,
or share cancellation friction. Event properties are limited to roles, sources,
methods, phases, viewport bands, booleans, coarse failure categories, and counts;
room codes, player IDs/names, passwords, recovery codes, tokens, cards, action
amounts, and game state are never sent as custom properties. Guest-to-host
attribution is stored only on that device and expires after 30 days. The event
dictionary, hypotheses, experiments, and moderated-test protocol live in
[`docs/ux-validation-plan.md`](docs/ux-validation-plan.md).

Room invitation pages and Open Graph images use the public
`GET /api/rooms/:roomId/preview` projection. It exposes only the table name,
phase, seat count, capacity, blinds, and hand count. Set `NEXT_PUBLIC_SITE_URL`
when a deployment needs invitation metadata to use a custom canonical origin;
Vercel deployment URLs are detected automatically.

## Deploying

`vercel.json` describes two Vercel services: `frontend/` and `backend/`
(entrypoint `main:asgi_app`). Requests to `/api/*` go to the backend with the
prefix intact, which is why the FastAPI app is mounted under `/api`.

**The backend needs `KV_REST_API_URL` and `KV_REST_API_TOKEN`** (the Upstash
integration sets both). Without them a deployed backend refuses to boot rather
than falling back to the in-memory store: every serverless invocation would get
its own empty copy, so players would watch rooms appear and disappear at random
instead of seeing one clear error.

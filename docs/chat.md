# Text chat v1

OnlyPoker table talk is a private, room-scoped text channel built on the same
capability and HTTP polling model as the poker table. It does not introduce a
WebSocket service or put conversational data into the serialized PokerKit room.

## Access and author identity

Both routes require `X-Player-Token`:

- `GET /api/rooms/{roomId}/chat` accepts a current player capability or the
  shared watch capability issued after the room password is verified.
- `POST /api/rooms/{roomId}/chat` accepts only a capability that currently
  resolves to a seated player. Watch capabilities are read-only; kicked tokens
  retain the room's existing `410 Gone` behavior.

The POST body is intentionally limited to:

```json
{
  "text": "Nice river",
  "requestId": "a-client-generated-retry-id"
}
```

Extra author-shaped fields are rejected. The server resolves the player record
from the secret capability, snapshots that record's name, generates the public
message ID, and supplies the timestamp. `requestId` is scoped to that resolved
author and only deduplicates a lost-response retry; it never becomes the public
message ID.

The public response contains:

```json
{
  "messages": [
    {
      "id": "server-generated-stable-id",
      "authorName": "Alex",
      "text": "Nice river",
      "createdAt": 1700000000000,
      "isMine": false
    }
  ],
  "canSend": false,
  "serverTime": 1700000000100
}
```

`isMine` is projected for the current viewer so the client does not need an
author player ID. The response contains no capability, request ID, room player
ID, card, board, action, stack, or PokerKit state.
Successful reads carry `Cache-Control: private, no-store` and vary on the
player-token header; the browser request also bypasses its HTTP cache. A
viewer-relative snapshot is therefore not reusable across capabilities.

## Storage, expiry, and concurrency

Chat is one bounded JSON document at `holdem:chat:{roomId}`. Its internal
messages contain the resolved author ID/name, text, stable ID, timestamp, and
retry ID. Internal per-player timestamp windows support rate limiting. Neither
internal field set is returned directly.

- Only the newest 100 messages are retained.
- Empty and unsupported-control-character messages are rejected; text is
  normalized and limited to 280 characters.
- One seat may send at most five messages in a rolling 10 seconds and 20 in a
  rolling minute. A rejection is `429` with `Retry-After`.
- Rate entries older than one minute are pruned, so historical players do not
  make the document grow without bound.

A send takes the existing room lease for a short room-read/chat-read/chat-write
section. That makes capability resolution linearizable with leave, kick, and
host-token rotation and prevents concurrent JSON appends from losing a message.
It never deserializes PokerKit and never writes the room JSON value.

The fenced Redis Lua write stores chat and renews the room key to the same
24-hour expiry atomically. A fenced room save likewise renews an existing chat
key. The local development store mirrors those two changes inside its atomic
compare-set method. A chat cannot be written if its room key has expired.
Room creation clears the separate chat key before returning a new capability,
so even a forced reuse of a rare colliding room code cannot inherit an earlier
room's conversation.

## Client behavior

The room header owns a compact table-talk trigger and unread badge. The chat
controller polls every four seconds while closed and every 1.6 seconds while
open, skips hidden-tab polls, and uses the successful POST snapshot immediately.
The first successful snapshot establishes an unread baseline; later stable IDs
are counted until the sheet opens. The latest read ID is kept locally per room.

When a later closed poll detects a new final stable ID, a fixed `rail slip`
shows the server-authored display name and a two-line preview of that newest
message for six seconds. Retained history never triggers a preview on initial
load. Hover or keyboard focus pauses the timer; dismissing the slip preserves
the unread badge, while activating it opens the sheet and marks the snapshot
read. Hiding the page clears the transient slip without clearing unread state.

The sheet is portaled to `document.body` and fixed over the app. On phones it is
a bottom sheet; at wider sizes it is a right sheet. It therefore does not add a
row, resize the table, move the fixed own-player zone, or make the page scroll.
The root viewport opts into `viewport-fit=cover`, and the composer pads against
the reported bottom safe area. The sheet also includes a Tab trap,
Escape/backdrop close, initial focus inside the dialog, and trigger-focus
restoration. Spectators get the same log with an explicit read-only footer.

Message text is rendered in both the preview and sheet as a React text node with
preserved whitespace and word breaking. There is no `dangerouslySetInnerHTML`
or HTML/Markdown parser.

## Verification

```bash
cd backend
uv run --with pytest --frozen pytest tests/test_chat.py -q

cd ../frontend
pnpm exec vitest run components/chat-sheet.test.tsx
pnpm exec playwright test e2e/chat.spec.ts --project=chromium
```

The backend slice covers capability-derived authors, spoof rejection,
player/spectator/removed access, privacy projection, text bounds, stable retry
IDs, separate storage, concurrent sends, both rate windows, 100-message
retention, and synchronized expiry. Component tests cover focus/read-only/safe
rendering/unread/preview behavior. The browser journey uses the real FastAPI
backend and separate player/spectator contexts, and asserts that neither the
closed preview nor open sheet changes the fixed table geometry; it also checks
the preview's mobile dismiss target.

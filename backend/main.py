"""Texas Hold'em backend.

FastAPI service that runs the pokerkit engine and stores all room / game state
in Upstash Redis. The frontend talks to this via ``/api/*``.

Vercel's ``services`` model routes ``/api/*`` to this backend WITHOUT stripping
the prefix, so the whole app is mounted under ``/api`` (see ``asgi_app`` at the
bottom of this file). Individual routes are declared without the prefix; the
mount adds it. The entrypoint referenced by ``vercel.json`` and the local dev
launcher is ``main:asgi_app``.

Tournament (sit & go) rules layered on top of the engine:
  * blinds climb through a fixed ladder, one level every N minutes;
  * every decision has a shot clock, and expiring it auto-checks or auto-folds;
  * a player with no chips is out, and the last one standing wins.

Both clocks are enforced lazily: there is no background worker in a serverless
runtime, so every incoming request first fast-forwards the room to "now".
"""

from __future__ import annotations

import asyncio
import contextvars
import hashlib
import hmac
import json
import math
import os
import secrets
import time
import unicodedata
from typing import Any

import fastapi
import fastapi.middleware.cors
import fastapi.responses
from pydantic import BaseModel, ConfigDict, Field

import poker

app = fastapi.FastAPI(title="Texas Hold'em Poker")

app.add_middleware(
    fastapi.middleware.cors.CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The Upstash integration exposes Vercel-style KV_* variables. Fall back to the
# canonical Upstash names if present.
_REDIS_URL = os.environ.get("KV_REST_API_URL") or os.environ.get(
    "UPSTASH_REDIS_REST_URL", ""
)
_REDIS_TOKEN = os.environ.get("KV_REST_API_TOKEN") or os.environ.get(
    "UPSTASH_REDIS_REST_TOKEN", ""
)

if _REDIS_URL:
    from upstash_redis.asyncio import Redis

    redis = Redis(url=_REDIS_URL, token=_REDIS_TOKEN)
elif os.environ.get("VERCEL"):
    # Deployed without a store. The in-memory fallback would "work" here — each
    # serverless invocation would start with an empty one — and players would
    # see rooms vanish at random instead of a clear error. Refuse to start.
    raise RuntimeError(
        "No Upstash credentials found. Set KV_REST_API_URL and KV_REST_API_TOKEN "
        "(or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) on the backend "
        "service, otherwise every request lands on a different empty store."
    )
else:
    # Local development only: keep rooms in this process. See devstore.py —
    # single worker, wiped on restart.
    import devstore

    redis = devstore.LocalStore()
    print(
        "[holdem] No Upstash credentials — using the in-memory dev store. "
        "Rooms are lost when this process restarts."
    )

ROOM_TTL = 60 * 60 * 24  # 24h
MAX_SEATS = 9
AUTH_WINDOW_SECONDS = 10 * 60
AUTH_MAX_FAILURES = 8
CHAT_MAX_MESSAGES = 100
CHAT_MAX_CHARACTERS = 280
CHAT_BURST_MESSAGES = 5
CHAT_BURST_SECONDS = 10
CHAT_WINDOW_MESSAGES = 20
CHAT_WINDOW_SECONDS = 60

# Blind ladders expressed as multipliers of the table's opening blinds, so the
# host only picks the starting stakes and how long a level lasts. The ratio the
# host chose between small and big blind is preserved at every level.
#
# Three of them, because "how long is this going to take" is not the same
# question as "how long is a level". A level length says how often the blinds
# move; the ladder says how far. A table that wants a short night and one that
# wants a long one were both being handed the same climb, and the only lever was
# the clock — which is why a five-minute level felt identical to a ten-minute
# one with twice the hands.
#
# Integers on purpose. A ×1.5 rung reads well in a spec and produces 7.5/15 at
# 5/10 stakes, and a blind nobody can make out of the chips in front of them is
# a rule the table has to house-rule its way around. Every rung here lands on a
# number you can stack.
BLIND_LADDERS: dict[str, tuple[int, ...]] = {
    # Doubles about every four levels. A deep stack stays deep for a while.
    "gentle": (1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40),
    # Doubles about every two. The one every table here has played until now,
    # and still the default: changing it under existing rooms is not a feature.
    "standard": (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128),
    # Doubles every level to start with. Made to end.
    "beast": (1, 2, 4, 8, 16, 24, 40, 64, 100, 160, 250, 400, 640, 1000),
}
DEFAULT_BLIND_LADDER = "standard"

# Grace added to the shot clock before auto-acting, so a decision sent right on
# the buzzer is not lost to network latency.
TIMEOUT_GRACE = 1.5
# How long the all-in players have to say whether they want a second board.
# Short: nobody is deciding anything about the hand any more, the chips are
# already in, and the whole table is sitting waiting for the cards. Somebody who
# walks off to the kitchen must not hold it up — an unanswered offer runs once,
# which is what happens if nobody agrees anyway.
RUNOUT_SECONDS = 12
# Whether the table deals the next hand on its own. Kept as a number of seconds
# because that is what it used to be and old rooms have it stored; what it means
# now is only on (non-zero) or off (0). How long the pause actually lasts is
# `_handover_seconds`.
AUTO_DEAL_SECONDS = 8
# How long the table sits between hands.
#
# Not one number, which is what it was and what made the pace wrong in both
# directions at once. The pause exists to be *read*, and how much there is to
# read swings by a factor of four between a hand everybody folded — which is
# most hands — and an all-in run out on two boards. A flat eight seconds made
# the ordinary hand feel like waiting for a bus and still cut off the one hand
# an hour worth watching.
#
# The figures are **not** the pace the big rooms settle on, and that was the
# mistake in the first pass. An online room is optimising hands per hour for
# people playing four tables at once; this is one table, once, with friends in
# the room, and the end of a hand is the part they talk over. Twice that pace,
# and it still comes to less than half the flat eight seconds this started with
# on the hands where nothing happened.
#
# Five for the hand nobody showed, which is most hands.
#
# It was seven, and the argument for seven was that the winner still has a
# decision open — one card, both, or neither. That argument is sound and it is
# the wrong size: the decision is *offered* for as long as the pause lasts, but
# what a pot won by folding actually contains is one line of text and the chips
# landing, and both are over inside two seconds. The other five were spent
# waiting for a table that had nothing left to say, forty times a night.
#
# Five and not four, and the two seconds of the difference are not attention —
# they are **the wire**. This clock starts here, and the winner's phone finds
# out the hand is over on its next poll, up to 1.2s later (`POLL_MS`), plus the
# round trip. Four seconds on this side is under three on theirs, and what has
# to fit in it is two taps on two cards and a button. The pause a player gets
# is the pause minus how long it took to reach them.
#
# The other exception is below and it is not a guess about attention either: a
# table playing the 7-2 has real money riding on that decision, and it is a
# decision that cannot be made anywhere else.
HANDOVER_FOLD_SECONDS = 5
# Where the bluff pays. Room-level and set by the host at the start of the
# night, so leaking nothing about the hand that just ended — unlike who is
# holding what, which is why `_seven_deuce_pending` is answered per viewer.
HANDOVER_SEVEN_DEUCE_SECONDS = 3
HANDOVER_SHOWDOWN_SECONDS = 9
# An all-in board is dealt out card by card on the client (`use-runout`), and
# that reveal has to finish with time left over to take in who won.
#
# It buys more than the cards now. The hands go face up *before* the first
# street — which is what every room does, and what makes the run-out worth
# watching at all: a board dealt out over hands nobody has seen is three cards
# and no stakes. See `runoutBeats`.
HANDOVER_ALL_IN_SECONDS = 8
# A second board is a second answer to who won, and it gets read separately.
HANDOVER_SECOND_BOARD_SECONDS = 3
# Somebody left the tournament: the one thing at this table that does not happen
# again, and the only reason to hold everybody a moment longer.
HANDOVER_BUST_SECONDS = 4
# However it adds up, it stops here. Beyond this nobody is reading anything —
# they are waiting.
#
# Twenty-two and not eighteen, and the four seconds are arithmetic rather than
# generosity. Eighteen was set when an all-in bought five seconds; it buys eight
# now, because the hands turn over before the board. So the hand this cap is
# *for* — nine-handed all-in, run twice, somebody out — asked for 9 + 8 + 3 + 4
# and was cut to eighteen, which quietly meant the second board added one second
# instead of three and the bust added none. A cap that silently rewrites the
# reasons above it is a cap that makes those reasons untrue.
#
# What the client actually needs on that hand: eight hands turning over is 3.4s,
# the lead-in and three streets 4.0s, the winning five 1.5s — 8.9s before anyone
# has begun to take it in. Twenty-two leaves that hand the same room to be read
# in that an ordinary showdown gets, and it is the rarest hand of the night.
HANDOVER_MAX_SECONDS = 22
# Missing this many decisions in a row sits a player out, so one person who
# walked away stops costing everyone else the full shot clock every hand.
AUTO_SIT_OUT_TIMEOUTS = 3
# Heartbeats are written at most this often per player, to keep polling cheap.
HEARTBEAT_MIN_INTERVAL = 5.0
# What everybody puts in for a bomb pot, in big blinds. Big enough that the
# hand is worth the interruption, small enough that a run of them cannot
# quietly decide the tournament.
BOMB_POT_BLINDS = 2


# --------------------------------------------------------------------------- #
# Redis helpers
# --------------------------------------------------------------------------- #
def _room_key(room_id: str) -> str:
    return f"holdem:room:{room_id}"


def _chat_key(room_id: str) -> str:
    return f"holdem:chat:{room_id}"


def _lock_key(room_id: str) -> str:
    return f"holdem:lock:{room_id}"


def _auth_attempt_key(request: fastapi.Request, room_id: str) -> str:
    """Privacy-preserving key for repeated door failures.

    The raw network address is never stored. The room id scopes the limit so a
    typo at one table cannot lock somebody out of another, and hashing keeps
    the store free of IP addresses while still slowing repeated guesses.
    """
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    address = forwarded or (request.client.host if request.client else "unknown")
    digest = hashlib.sha256(f"{room_id}:{address}".encode()).hexdigest()[:24]
    return f"holdem:auth:{digest}"


async def _check_auth_limit(request: fastapi.Request, room_id: str) -> None:
    raw = await redis.get(_auth_attempt_key(request, room_id))
    if not raw:
        return
    try:
        attempts = json.loads(raw)
    except (TypeError, ValueError):
        return
    reset_at = float(attempts.get("resetAt", 0))
    if reset_at <= time.time():
        await redis.delete(_auth_attempt_key(request, room_id))
        return
    if int(attempts.get("count", 0)) >= AUTH_MAX_FAILURES:
        retry_after = max(1, int(reset_at - time.time()))
        raise fastapi.HTTPException(
            429,
            "Too many incorrect attempts. Wait a few minutes and try again.",
            headers={"Retry-After": str(retry_after)},
        )


async def _record_auth_failure(request: fastapi.Request, room_id: str) -> None:
    key = _auth_attempt_key(request, room_id)
    now = time.time()
    count = 0
    reset_at = now + AUTH_WINDOW_SECONDS
    raw = await redis.get(key)
    if raw:
        try:
            previous = json.loads(raw)
            if float(previous.get("resetAt", 0)) > now:
                count = int(previous.get("count", 0))
                reset_at = float(previous["resetAt"])
        except (TypeError, ValueError, KeyError):
            pass
    await redis.set(
        key,
        json.dumps({"count": count + 1, "resetAt": reset_at}),
        ex=max(1, int(reset_at - now)),
    )


async def _clear_auth_failures(request: fastapi.Request, room_id: str) -> None:
    await redis.delete(_auth_attempt_key(request, room_id))


# How long a lock lease lasts. A holder that dies (or, on Vercel, is frozen
# mid-request) must not block the room for longer than this.
LOCK_TTL = 10

# Both scripts are compare-and-swap: they only touch the key when the caller
# still owns the lock, which a GET followed by a separate SET/DEL does not
# guarantee — the lease can expire in between and be handed to somebody else.
_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""

_GUARDED_SET_SCRIPT = """
if redis.call('get', KEYS[2]) == ARGV[3] then
  if ARGV[4] == '1' and redis.call('exists', KEYS[3]) == 0 then
    return 0
  end
  redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
  if ARGV[5] == '1' then
    redis.call('expire', KEYS[3], ARGV[2])
  end
  return 1
end
return 0
"""


async def _release_lock(key: str, token: str) -> None:
    if hasattr(redis, "compare_delete"):  # dev store
        await redis.compare_delete(key, token)
    else:
        await redis.eval(_RELEASE_SCRIPT, [key], [token])


async def _guarded_set(
    key: str,
    value: str,
    lock_key: str,
    token: str,
    *,
    expire_key: str | None = None,
    require_expire_key: bool = False,
) -> bool:
    """Write ``key`` and align a related TTL while the lease is still ours."""
    if hasattr(redis, "compare_set"):  # dev store
        return await redis.compare_set(
            key,
            value,
            ROOM_TTL,
            lock_key,
            token,
            expire_key,
            require_expire_key,
        )
    related_key = expire_key or key
    result = await redis.eval(
        _GUARDED_SET_SCRIPT,
        [key, lock_key, related_key],
        [
            value,
            str(ROOM_TTL),
            token,
            "1" if require_expire_key else "0",
            "1" if expire_key else "0",
        ],
    )
    return bool(result)


# The lock the current request holds, so ``save_room`` can fence its write
# without every call site having to thread the lock through.
_current_lock: contextvars.ContextVar["_RoomLock | None"] = contextvars.ContextVar(
    "_current_lock", default=None
)


async def load_room(room_id: str) -> dict[str, Any] | None:
    raw = await redis.get(_room_key(room_id))
    if not raw:
        return None
    return json.loads(raw)


async def save_room(room: dict[str, Any]) -> None:
    """Persist a room, refusing the write if the lock behind it has lapsed.

    Holding the lock at the *start* of a read-modify-write proves nothing by the
    time it ends: a slow Redis, a paused function or a long settle can outlive
    the lease, and by then somebody else may have taken it and dealt. Checking
    ownership as part of the write itself is what makes the exclusion real —
    a writer that lost its lease cannot land a stale room over a newer one.
    """
    payload = json.dumps(room)
    lock = _current_lock.get()
    if lock is not None and lock.held:
        if not await _guarded_set(
            _room_key(room["id"]),
            payload,
            lock.key,
            lock.token,
            expire_key=_chat_key(room["id"]),
        ):
            lock.held = False  # somebody else owns it now; do not delete theirs
            raise LockLost(lock.key)
        return
    await redis.set(_room_key(room["id"]), payload, ex=ROOM_TTL)
    # Creation is the only production write without a lease and has no chat
    # yet. Keeping this here also makes direct maintenance/test saves preserve
    # an existing chat's room-aligned lifetime.
    await redis.expire(_chat_key(room["id"]), ROOM_TTL)


def _empty_chat() -> dict[str, Any]:
    return {"messages": [], "rate": {}}


async def load_chat(room_id: str) -> dict[str, Any]:
    """Load the bounded chat document, never the PokerKit room document."""
    raw = await redis.get(_chat_key(room_id))
    if not raw:
        return _empty_chat()
    try:
        chat = json.loads(raw)
    except (TypeError, ValueError):
        return _empty_chat()
    if not isinstance(chat, dict):
        return _empty_chat()
    if not isinstance(chat.get("messages"), list):
        chat["messages"] = []
    if not isinstance(chat.get("rate"), dict):
        chat["rate"] = {}
    return chat


async def save_chat(room_id: str, chat: dict[str, Any]) -> None:
    """Persist chat under the room lease and renew both documents together.

    A chat send is room activity, but it must not rewrite the large serialized
    game record. The fenced Redis command writes only the chat key and moves
    the room key to the same 24-hour expiry. Requiring the room key prevents a
    send right on the expiry boundary from leaving an orphaned chat behind.
    """
    lock = _current_lock.get()
    if lock is None or not lock.held:
        raise RuntimeError("Chat writes require the room lock.")
    payload = json.dumps(chat, separators=(",", ":"), ensure_ascii=False)
    if not await _guarded_set(
        _chat_key(room_id),
        payload,
        lock.key,
        lock.token,
        expire_key=_room_key(room_id),
        require_expire_key=True,
    ):
        lock.held = False
        raise LockLost(lock.key)


class RoomBusy(Exception):
    """The room lock could not be taken within the wait window."""


class LockLost(Exception):
    """The lease expired mid-request, so the write was refused."""


class _RoomLock:
    """Distributed lock guarding every read-modify-write of a room.

    It fails closed. An earlier version gave up after a few seconds and carried
    on without exclusion, which was survivable when the only writers were player
    actions — but now that the server deals hands on its own, two unguarded
    ticks can each deal a *different* hand under the same hand number, and the
    last write wins. Two players would be looking at different cards for the
    same hand. Refusing the request is always better: callers either surface a
    retry or, for polling, simply skip the update and try again in a moment.

    Exclusion is enforced twice: the lease keeps other writers out, and every
    write is fenced on still owning it (see ``save_room``). The second half is
    what covers a lease that expires anyway. Renewing it from a background task
    would not: the runtime freezes a paused function whole, watchdog included.
    """

    def __init__(self, room_id: str):
        self.key = _lock_key(room_id)
        self.token = secrets.token_hex(8)
        self.held = False
        self._reset: Any = None

    async def __aenter__(self):
        for _ in range(50):
            if await redis.set(self.key, self.token, nx=True, ex=LOCK_TTL):
                self.held = True
                self._reset = _current_lock.set(self)
                return self
            await asyncio.sleep(0.1)
        # The TTL means a crashed holder cannot block longer than that, so
        # waiting this long without success is a real problem, not congestion.
        raise RoomBusy(self.key)

    async def __aexit__(self, *exc):
        if self._reset is not None:
            _current_lock.reset(self._reset)
            self._reset = None
        if not self.held:
            return
        self.held = False
        try:
            await _release_lock(self.key, self.token)
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Password + id helpers
# --------------------------------------------------------------------------- #
def _hash_password(password: str) -> str:
    salt = secrets.token_hex(8)
    digest = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return f"{salt}:{digest}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split(":", 1)
    except ValueError:
        return False
    check = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return hmac.compare_digest(check, digest)


# --------------------------------------------------------------------------- #
# Who is who
# --------------------------------------------------------------------------- #
# A player's id and a player's credential have to be two different things.
#
# They were the same thing, and the table publishes every id — it has to, so
# clients can say whose seat is whose. Which meant anybody holding the room code
# could read the seating off an anonymous request, put somebody else's id on a
# request, and be handed their hole cards. Or fold their hand for them. The room
# password bought nothing, because nothing behind it ever checked who was
# asking.
#
# So the id stays public and useless on its own, and every request that reads
# private state or changes anything carries a secret handed out once, when the
# player sits down.
PLAYER_TOKEN_HEADER = "X-Player-Token"

# One message for every way a room from before the credential split can be
# reached, and one status code. Failing closed in four different shapes —
# a 401 here, a 500 there, a 200 that cannot then read anything — is how a
# client ends up in a state nobody wrote a screen for. Rooms expire within the
# day, so this is a message rather than a migration.
_LEGACY_ROOM = (
    "This table was created before the app started checking who is who. "
    "Start a new one — it only takes a moment."
)


def _new_token() -> str:
    return secrets.token_urlsafe(24)


def _reject_legacy(room: dict[str, Any]) -> None:
    """Refuse a room that has no credentials to check against."""
    if not room.get("watchToken"):
        raise fastapi.HTTPException(401, _LEGACY_ROOM)


# Answered with 410 rather than 403, everywhere it comes up, and the status is
# the point rather than tidiness. A device told "no" clears the credential it
# was refused with and sends the player back to the door — which is right for a
# key the table no longer knows, and exactly wrong here: the credential is the
# only thing that tells this device from a stranger's, so throwing it away
# turns the person who was just removed into a new arrival who knows the
# password. Gone says the seat existed and is not coming back, which is a thing
# the client can act on without forgetting who it is.
_REMOVED = "The host removed you from this table."


def _reject_the_removed(room: dict[str, Any], token: str | None) -> None:
    """Turn away a credential the host has shown the door."""
    pid = _player_by_token(room, token)
    if pid and room["players"][pid].get("kicked"):
        raise fastapi.HTTPException(410, _REMOVED)


def _has_seat(player: dict[str, Any] | None) -> bool:
    """Whether this record is still somebody at the table.

    A player removed by the host keeps their record — the final standings look
    players up by id, so deleting them outright turns the podium into a
    KeyError — but the record is a memory, not a seat. Their credential dies
    with the seat: otherwise being shown the door leaves you able to read the
    table, sit back in, and keep polling as if nothing happened.
    """
    return bool(player) and not player.get("removed")


def _authenticate(room: dict[str, Any], player_id: str, token: str | None) -> None:
    """Confirm the caller really is the player they claim to be."""
    player = room["players"].get(player_id)
    if player is None:
        raise fastapi.HTTPException(404, "That player is not at this table.")
    if not _has_seat(player):
        if player.get("kicked"):
            raise fastapi.HTTPException(410, _REMOVED)
        raise fastapi.HTTPException(403, "You have left this table.")
    stored = player.get("token")
    if not stored:
        raise fastapi.HTTPException(401, _LEGACY_ROOM)
    if not token or not hmac.compare_digest(stored, token):
        raise fastapi.HTTPException(403, "That is not your seat.")


def _may_watch(room: dict[str, Any], token: str | None) -> bool:
    """Whether this caller got past the door at all.

    A room code is not a password. It gets forwarded, screenshotted and pasted
    into group chats, and on its own it used to be enough to read the whole
    table over the API — who is playing, what everyone has left, the board, the
    pot. Watching through the front door asks for the password, so reading the
    same thing through the side door has to as well.

    The watch key is deliberately **group access, not per-person access**: one
    key for the room, handed to anyone who knows the password, and it lives as
    long as the room does. A spectator who leaves keeps it, and the host cannot
    revoke one guest without revoking every guest. That is the right shape for
    a table of friends and the wrong shape for anything else — if this ever
    grows a public lobby, the key has to become per-spectator first.
    """
    if not token:
        return False
    watch = room.get("watchToken")
    if watch and hmac.compare_digest(watch, token):
        return True
    # A seated player's own credential lets them in too, obviously.
    return any(
        _has_seat(p) and p.get("token") and hmac.compare_digest(p["token"], token)
        for p in room["players"].values()
    )


def _require_access(room: dict[str, Any], token: str | None) -> None:
    _reject_legacy(room)
    # Before the generic refusal, so the poll that finds out gets an answer it
    # can act on rather than "this table is private", which is both untrue and
    # indistinguishable from a key that never worked.
    _reject_the_removed(room, token)
    if not _may_watch(room, token):
        raise fastapi.HTTPException(403, "This table is private.")


def _is_player(room: dict[str, Any], player_id: str | None, token: str | None) -> bool:
    """Whether the caller is a seated player, for reads that also serve guests.

    Wrong or missing credentials do not fail here — they simply make you a
    spectator, which is what an onlooker is anyway.
    """
    if not player_id:
        return False
    player = room["players"].get(player_id)
    if not _has_seat(player) or not player.get("token") or not token:
        return False
    return hmac.compare_digest(player["token"], token)


def _new_id(n: int = 6) -> str:
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _free_seat(room: dict[str, Any]) -> int:
    """The lowest seat nobody is sitting in.

    Not the number of players (two people would share a seat as soon as one is
    removed) and not one past the highest (seats then climb past the nine this
    table has, and keep climbing with every arrival and departure). The seat
    numbers are a fixed set of chairs; this finds an empty one.

    Records that are only a memory do not hold a chair. Their seat number is
    still in the record — the standings are read off it — but a table where
    every player who ever left keeps their seat runs out of them: nine
    departures and the room is full with two people sitting at it.
    """
    taken = {p["seat"] for p in room["players"].values() if _has_seat(p)}
    for seat in range(MAX_SEATS):
        if seat not in taken:
            return seat
    raise fastapi.HTTPException(400, "This room is full.")


# --------------------------------------------------------------------------- #
# Doing a thing once
# --------------------------------------------------------------------------- #
# The lock makes two simultaneous requests take turns. It does not make the
# second one a no-op, and for anything that *creates* something that is the
# whole problem: two joins run one after the other and the table gains two
# seats for one person. The same shape is waiting in rebuys (charged twice) and
# in the sit-out toggle (flipped twice, back to where it started).
#
# A phone on a train does not need two taps to get there. It needs one request
# whose response never arrives, and a retry.
#
# So every mutating request may name itself, and a name the room has already
# seen is answered rather than replayed. Kept on the room because that is what
# the lock protects: a receipt in some other store is a receipt that can
# disagree with the thing it is vouching for.
#
# Two things this is deliberately *not* for.
#
# It is not for operations that say where the player wants to end up. "Pause",
# "plan to check", "sit out" are settings, not events: asking twice asks for
# the same thing, so they need no help being safe to repeat — and a receipt on
# one of them is worse than useless, because the second time the player
# genuinely means it (pause, resume, pause again during the same hand) it is
# the name that has already been seen, and the answer is a cheerful 200 that
# does nothing. A receipt belongs on the things that *create* or *charge*.
MAX_RECEIPTS = 32

# Joins keep their own book. Everything else with a receipt is a decision made
# during a hand, and a nine-handed hand is easily thirty of them — enough to
# push the one receipt whose loss cannot be put right off the end of a shared
# list. Every other replay is caught by the state of the room a second time
# (you cannot rebuy with chips in front of you, or take the add-on twice); a
# replayed join is a second seat and a second stack for one person, and the
# first seat is unrecoverable. So it does not queue behind ordinary play.
MAX_JOIN_RECEIPTS = 32
_JOINS = "joinReceipts"


def _receipt(
    room: dict[str, Any], key: str | None, book: str = "receipts"
) -> dict[str, Any] | None:
    """What this exact request was answered with last time, if it has been."""
    if not key:
        return None
    return (room.get(book) or {}).get(key)


def _keep_receipt(
    room: dict[str, Any],
    key: str | None,
    payload: dict[str, Any],
    book: str = "receipts",
    cap: int = MAX_RECEIPTS,
) -> None:
    """Record that this request has been carried out.

    Bounded on purpose: the room is one document that every poll reads whole,
    so an unbounded log of everything anybody ever did is a slow leak into
    every request at the table. The oldest go first; a retry that arrives after
    thirty-two other operations is not a retry.
    """
    if not key:
        return
    receipts = room.setdefault(book, {})
    receipts[key] = {"at": time.time(), **payload}
    while len(receipts) > cap:
        oldest = min(receipts, key=lambda k: receipts[k].get("at", 0))
        receipts.pop(oldest, None)


def _player_by_token(room: dict[str, Any], token: str | None) -> str | None:
    """Which seat this credential belongs to, if any.

    This is what identity *is* here: not a name typed into a box — two people
    at the same table can both be Marcos — but the secret the device has been
    holding since it first sat down. It is what tells "Marcos is back" from
    "another Marcos has arrived", which is the question every way back into a
    running tournament has to answer.
    """
    if not token:
        return None
    for pid, player in room["players"].items():
        stored = player.get("token")
        if stored and hmac.compare_digest(stored, token):
            return pid
    return None


# --------------------------------------------------------------------------- #
# Table talk
# --------------------------------------------------------------------------- #
def _normalise_chat_text(value: str) -> str:
    """Keep intentional line breaks while refusing empty/control-only text."""
    text = value.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        raise fastapi.HTTPException(400, "Write a message before sending it.")
    if len(text) > CHAT_MAX_CHARACTERS:
        raise fastapi.HTTPException(
            400, f"Messages can be at most {CHAT_MAX_CHARACTERS} characters."
        )
    if any(
        unicodedata.category(character) == "Cc" and character != "\n"
        for character in text
    ):
        raise fastapi.HTTPException(
            400, "Messages contain an unsupported control character."
        )
    return text


def _chat_retry_after(
    chat: dict[str, Any], player_id: str, now: float
) -> int | None:
    """Prune rolling windows and say how long this seat must wait, if at all."""
    rates = chat.setdefault("rate", {})
    if not isinstance(rates, dict):
        rates = {}
        chat["rate"] = rates

    # Old player records can accumulate as people leave and rejoin. A rate
    # entry has no purpose after its one-minute window, so every accepted send
    # also keeps this internal map bounded independently of room history.
    for pid, raw_stamps in list(rates.items()):
        stamps = raw_stamps if isinstance(raw_stamps, list) else []
        recent = sorted(
            float(stamp)
            for stamp in stamps
            if isinstance(stamp, (int, float))
            and now - CHAT_WINDOW_SECONDS < float(stamp) <= now + 1
        )
        if recent:
            rates[pid] = recent
        else:
            rates.pop(pid, None)

    stamps = rates.get(player_id, [])
    burst = [stamp for stamp in stamps if stamp > now - CHAT_BURST_SECONDS]
    waits: list[float] = []
    if len(burst) >= CHAT_BURST_MESSAGES:
        clears_at = burst[len(burst) - CHAT_BURST_MESSAGES] + CHAT_BURST_SECONDS
        waits.append(clears_at - now)
    if len(stamps) >= CHAT_WINDOW_MESSAGES:
        clears_at = stamps[len(stamps) - CHAT_WINDOW_MESSAGES] + CHAT_WINDOW_SECONDS
        waits.append(clears_at - now)
    return max(1, math.ceil(max(waits))) if waits else None


def _chat_view(
    room: dict[str, Any], chat: dict[str, Any], token: str | None
) -> dict[str, Any]:
    """Project chat without player IDs, capabilities, rate data, or game state."""
    viewer_id = _player_by_token(room, token)
    can_send = bool(viewer_id and _has_seat(room["players"].get(viewer_id)))
    messages: list[dict[str, Any]] = []
    for message in (chat.get("messages") or [])[-CHAT_MAX_MESSAGES:]:
        if not isinstance(message, dict):
            continue
        try:
            messages.append(
                {
                    "id": str(message["id"]),
                    "authorName": str(message["authorName"]),
                    "text": str(message["text"]),
                    "createdAt": int(message["createdAt"]),
                    "isMine": bool(viewer_id and message.get("authorId") == viewer_id),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    return {
        "messages": messages,
        "canSend": can_send,
        "serverTime": int(time.time() * 1000),
    }


# --------------------------------------------------------------------------- #
# Request models
# --------------------------------------------------------------------------- #
class ChatSendBody(BaseModel):
    # Author identity is deliberately absent, and spoof-shaped extra fields are
    # rejected rather than silently ignored. The capability header is the only
    # identity input accepted by the route.
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=CHAT_MAX_CHARACTERS)
    # Names one intention across a network retry. The public message id remains
    # server-generated and cannot be chosen by the caller.
    requestId: str = Field(min_length=1, max_length=64)


class TableRules(BaseModel):
    """Everything the host decides about the night, and nothing about who they are.

    Its own model because these are now set twice: once when the table is made
    and again from the lobby, before a card is dealt. Two copies of this list
    would drift the first time one of them gained a rule — and the half that
    drifted would be the half that silently accepts a value the other one
    rejects, which is the expensive direction.
    """

    name: str = Field(min_length=1, max_length=40)
    startingChips: int = Field(ge=1)
    smallBlind: int = Field(ge=1)
    bigBlind: int = Field(ge=1)
    # What the table is made of. Cosmetic and shared: a poker table is one
    # object everybody is sitting at, so this belongs to the room and not to
    # each player's settings. Validated against a list rather than taken as
    # free text — it ends up in a `data-` attribute that selects a stylesheet
    # rule, and an unknown value there is a table with no surface.
    baize: str = Field(default="emerald", pattern="^(emerald|claret|midnight|slate)$")
    deck: str = Field(default="clasica", pattern="^(clasica|casino|bloque|marfil)$")
    # 0 disables the blind clock (blinds stay where they started).
    levelMinutes: int = Field(default=10, ge=0, le=120)
    # How far the blinds move when they move, as opposed to how often.
    blindLadder: str = Field(default=DEFAULT_BLIND_LADDER, pattern="^(gentle|standard|beast)$")
    # 0 disables the shot clock.
    actionSeconds: int = Field(default=20, ge=0, le=120)
    # Dead money on every hand. "bb" is the modern big-blind ante (one player
    # posts for the table), "all" is the classic one where everybody does.
    anteMode: str = Field(default="off", pattern="^(off|all|bb)$")
    # Under the gun posts two big blinds and acts last preflop.
    straddle: bool = False
    # Blow the hand up every N deals: everybody antes and it starts on the
    # flop. 0 turns it off.
    bombPotEvery: int = Field(default=0, ge=0, le=50)
    # Big blinds each other player owes whoever wins with 7-2 offsuit.
    # 0 turns the rule off.
    sevenDeuce: int = Field(default=0, ge=0, le=20)
    # Stop the table every N blind levels. 0 turns scheduled breaks off; the
    # host can still stop it by hand whenever they like.
    breakEveryLevels: int = Field(default=0, ge=0, le=20)
    breakMinutes: int = Field(default=5, ge=1, le=60)
    # Turning up after it started. Allowed while the blinds are still on this
    # level or below; 0 shuts the door when the first hand is dealt.
    lateEntryLevels: int = Field(default=4, ge=0, le=99)
    # What a latecomer sits down with: the same as everybody started with, or
    # what the table is averaging now. The first is simpler; the second stops a
    # deep-stacked arrival at level nine walking in with nothing to play.
    lateEntryChips: str = Field(default="start", pattern="^(start|average)$")
    # Whether somebody can take their chips and go home early.
    allowLeaving: bool = True
    # Buying back in after busting, while the blinds are still on this level or
    # below. 0 turns rebuys off.
    rebuyLevels: int = Field(default=0, ge=0, le=99)
    rebuysPerPlayer: int = Field(default=1, ge=1, le=10)
    # What buying back in gets you. "start" is the stack everybody began with,
    # "average" is what the table is carrying now, "fixed" is a number the host
    # picked. The same argument as ``lateEntryChips``, and for the same reason:
    # at level nine a starting stack is a handful of big blinds, so a rebuy that
    # always pays the opening stack is a rebuy nobody takes.
    rebuyChips: str = Field(default="start", pattern="^(start|average|fixed)$")
    # Only read when ``rebuyChips`` is "fixed"; ignored otherwise rather than
    # rejected, so switching the mode back and forth in the sheet does not have
    # to clear it.
    rebuyChipsFixed: int = Field(default=0, ge=0)
    # One extra top-up per player inside the same window, for anyone who still
    # has chips. Off unless the host asks for it.
    addOn: bool = False
    # Extra seconds each player may spend across the whole tournament, on the
    # decisions that deserve them. 0 turns the time bank off.
    timeBankSeconds: int = Field(default=0, ge=0, le=600)
    # Offer the all-in players a second board. Everybody left in has to agree.
    runItTwice: bool = False


class CreateRoomBody(TableRules):
    hostName: str = Field(min_length=1, max_length=20)
    # Optional signed photo URL, prefilled from a signed-in player's profile or
    # a guest's uploaded selfie. Rendered as an <img src> at the table.
    hostAvatarUrl: str | None = Field(
        default=None, max_length=1000, pattern=r"^https://.+"
    )
    password: str = Field(min_length=4, max_length=64)


class SetRulesBody(TableRules):
    """The same rules again, from the lobby, by whoever is holding the table."""

    playerId: str = Field(min_length=1, max_length=64)
    # Which version of the rules this edit was made against. A whole ruleset is
    # sent every time, so an edit that started before somebody else's finished
    # would silently undo it by arriving second — and "somebody else" is not
    # hypothetical here: the host's own second tab, or a recovered device,
    # carries the same credential. None means "I have not read them", which
    # only the tests and a first write have any business saying.
    basedOn: int | None = None


class JoinBody(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=64)
    # Names this attempt, so a retry after a lost response takes the same seat
    # back instead of a second one. See "Doing a thing once" above.
    requestId: str | None = Field(default=None, max_length=64)
    # Optional signed photo URL, prefilled from a signed-in player's profile or
    # a guest's uploaded selfie. Rendered as an <img src> at the table.
    avatarUrl: str | None = Field(
        default=None, max_length=1000, pattern=r"^https://.+"
    )


class RecoverHostBody(BaseModel):
    password: str = Field(min_length=1, max_length=64)
    recoveryCode: str = Field(min_length=12, max_length=128)


class HostAuthorityBody(BaseModel):
    playerId: str
    targetId: str | None = None


class ActionBody(BaseModel):
    playerId: str
    action: str
    amount: int | None = None
    # Which hand the decision was made for. Required on /action — see
    # ``take_action``. Declared optional here only so the field can be rejected
    # with a readable message instead of a validation dump.
    handNumber: int | None = None
    # Which moment in the hand the decision was made at. Enforced on /action
    # for the same reason as handNumber, one level finer: see ``_save_state``.
    turnId: int | None = None
    requestId: str | None = Field(default=None, max_length=64)


# --------------------------------------------------------------------------- #
# Blind ladder
# --------------------------------------------------------------------------- #
def build_blind_schedule(
    small_blind: int, big_blind: int, ladder: str = DEFAULT_BLIND_LADDER
) -> list[dict[str, int]]:
    """Blind levels derived from the opening stakes.

    Multiplying both blinds by the same ladder keeps the host's chosen ratio
    (usually 1:2) and keeps every level on round numbers.
    """
    return [
        {"smallBlind": small_blind * m, "bigBlind": big_blind * m}
        for m in BLIND_LADDERS.get(ladder, BLIND_LADDERS[DEFAULT_BLIND_LADDER])
    ]


def _ante_for(room: dict[str, Any]) -> int:
    """What each posting seat owes this level.

    Tied to the big blind rather than stored as its own number, so it climbs
    with the ladder on its own and the host has one fewer thing to set. A big
    blind ante is a whole big blind, which is the modern standard; a table-wide
    ante is the old proportion of it, because everybody paying a full blind
    would be six blinds of dead money before a card is dealt.
    """
    mode = room.get("anteMode", "off")
    if mode == "bb":
        return int(room["bigBlind"])
    if mode == "all":
        return max(1, int(room["bigBlind"]) // 8)
    return 0


def _straddle_for(room: dict[str, Any], players: int) -> int:
    """What under the gun posts blind, or 0 for no straddle.

    Heads-up there is no under the gun — the two seats are already the blinds —
    so the rule simply does not apply however the host set it.
    """
    if not room.get("straddle") or players < 3:
        return 0
    return int(room["bigBlind"]) * 2


def _bomb_pot_due(room: dict[str, Any], players: int) -> int:
    """The ante for this hand if it is a bomb pot, else 0.

    Counted on the hand about to be dealt, not the one just finished — the
    host asked for "every N hands", and the Nth hand is the one that blows up.
    """
    every = int(room.get("bombPotEvery") or 0)
    if not every or players < 2:
        return 0
    if (room["handNumber"] + 1) % every:
        return 0
    return int(room["bigBlind"]) * BOMB_POT_BLINDS


def _level_duration(room: dict[str, Any]) -> int:
    return int(room.get("levelMinutes") or 0) * 60


def _projected_level(room: dict[str, Any], now: float) -> tuple[int, float | None]:
    """Level the clock says we should be on, without mutating the room.

    Returns ``(index, start_of_that_level)``. The clock only runs once the first
    hand is dealt, and it stops climbing on the final level.
    """
    index = int(room.get("levelIndex", 0))
    started = room.get("levelStartedAt")
    duration = _level_duration(room)
    schedule = room.get("blindSchedule") or []
    if not duration or started is None or not schedule:
        return index, started
    last = len(schedule) - 1
    while index < last and now - started >= duration:
        index += 1
        started += duration
    return index, started


def _apply_level(room: dict[str, Any], now: float) -> None:
    """Move the room onto the level the clock has reached.

    Called at the start of a hand only: a level that expires mid-hand takes
    effect on the next deal, which is how live tournaments handle it.
    """
    schedule = room.get("blindSchedule") or []
    if not schedule:
        return
    if room.get("levelStartedAt") is None:
        # The clock starts with the first hand, not when the room is created.
        room["levelStartedAt"] = now
    index, started = _projected_level(room, _clock_now(room, now))
    room["levelIndex"] = index
    room["levelStartedAt"] = started
    level = schedule[index]
    room["smallBlind"] = level["smallBlind"]
    room["bigBlind"] = level["bigBlind"]


# --------------------------------------------------------------------------- #
# Stopping the table
# --------------------------------------------------------------------------- #
# There is no counter to stop. The blind level is *projected* from
# ``levelStartedAt`` every time somebody asks, because nothing runs in the
# background — so pausing cannot mean "stop decrementing something". It means
# holding the clock still while the table is not playing, and then handing back
# exactly the time that was left. Done wrong, twenty minutes for a pizza comes
# back three levels higher, which is the difference between a break and an
# ambush.
def _is_paused(room: dict[str, Any]) -> bool:
    # ``autoDealPaused`` is what this used to be called, back when it only
    # stopped the dealing. Rooms live a day, so a few are still using it.
    return bool(room.get("paused", room.get("autoDealPaused")))


def _clock_now(room: dict[str, Any], now: float) -> float:
    """The time the blind clock thinks it is.

    Frozen at the moment the table stopped, so no level passes while nobody is
    playing. On the way back, ``_resume_table`` moves the level's start forward
    by however long the stoppage lasted, and the projection lines up again.
    """
    stopped = room.get("pausedAt")
    return stopped if stopped is not None else now


def _pause_table(room: dict[str, Any], now: float) -> None:
    room["paused"] = True
    room["autoDealPaused"] = True  # kept in step for anything still reading it
    if room.get("pausedAt") is None:
        room["pausedAt"] = now
    room["autoDealAt"] = None


def _resume_table(room: dict[str, Any], now: float) -> None:
    stopped = room.get("pausedAt")
    if stopped is not None and room.get("levelStartedAt") is not None:
        # Give back exactly what the stoppage took. Not "restart the level":
        # coming back from a five-minute break should leave four minutes on a
        # level that had four minutes left, not fifteen.
        room["levelStartedAt"] += max(0.0, now - stopped)
    room["pausedAt"] = None
    room["paused"] = False
    room["autoDealPaused"] = False
    room["breakUntil"] = None
    # Whoever was on the spot when the table stopped gets their time back, in
    # full rather than pro-rata. Coming back from a break with two seconds left
    # to make a decision nobody has been thinking about is a worse answer than
    # the arithmetic being exactly fair.
    if room.get("phase") == "hand":
        seconds = int(room.get("actionSeconds") or 0)
        if seconds and room.get("actorId"):
            room["actionDeadline"] = now + seconds
            room["bankRunning"] = False
        if room.get("runoutSeats"):
            room["runoutDeadline"] = now + RUNOUT_SECONDS


def _break_due(room: dict[str, Any], now: float) -> bool:
    """Whether the table has just played through a scheduled break.

    Counted in levels crossed rather than in hands, and consumed once, so a
    long gap between hands that skips two boundaries still stops the table
    exactly once — nobody wants two breaks back to back because the pizza
    arrived late.
    """
    every = int(room.get("breakEveryLevels") or 0)
    if not every or not int(room.get("breakMinutes") or 0):
        return False
    index, _ = _projected_level(room, _clock_now(room, now))
    return index // every > int(room.get("breaksTaken", 0))


def _no_more_hands(room: dict[str, Any]) -> bool:
    """Whether the hand the host called as the last one has been played."""
    last = room.get("lastHandNumber")
    return last is not None and room["handNumber"] >= last


# --------------------------------------------------------------------------- #
# Chips on and off the table
# --------------------------------------------------------------------------- #
# A tournament where nobody arrives, leaves or buys back in has one arithmetic
# check worth everything: the chips in play equal the starting stack times the
# number of players, always, and any bug that moves chips wrongly shows up as a
# total that no longer adds up.
#
# Late entry, leaving and rebuys all break that check — which is fine, as long
# as it is *replaced* rather than quietly dropped. So the table keeps a ledger:
# every chip ever issued to it, and every chip taken off it. The invariant
# becomes ``sum(stacks) + pot == issued - withdrawn``, and it still holds on
# every hand.
#
# What it catches is chips appearing, vanishing or being counted twice. What it
# cannot catch is a chip that moved *somewhere it should not have*: a pot pushed
# to the wrong seat adds up exactly as well as one pushed to the right one. That
# is a question about who won, and the tests that answer it plant the hands and
# name the winner. Worth writing down because a ledger that balances reads like
# proof of more than it proves.
#
# Arriving, leaving, busting and buying back in are one mechanism with four
# doors, deliberately. They are the same question — who is at this table and
# what are they sitting behind — and writing them separately is how two of them
# end up disagreeing about the answer.
def _level_number(room: dict[str, Any], now: float) -> int:
    """Which blind level the clock is on, counting from 1."""
    index, _ = _projected_level(room, _clock_now(room, now))
    return index + 1


def _window_closes_at(room: dict[str, Any], until_level: int) -> float | None:
    """When the blinds pass ``until_level``, or None if they never will."""
    duration = _level_duration(room)
    index, started = _projected_level(room, _clock_now(room, time.time()))
    if not duration or started is None or index + 1 > until_level:
        return None
    return started + (until_level - index) * duration


def _late_entry_open(room: dict[str, Any], now: float) -> bool:
    if room["phase"] == "finished" or not int(room.get("lateEntryLevels") or 0):
        return False
    return _level_number(room, now) <= int(room["lateEntryLevels"])


def _rebuy_open(room: dict[str, Any], now: float) -> bool:
    if room["phase"] == "finished" or not int(room.get("rebuyLevels") or 0):
        return False
    return _level_number(room, now) <= int(room["rebuyLevels"])


def _chips_balance(room: dict[str, Any]) -> int:
    """What every stack at this table should add up to."""
    return int(room.get("chipsIssued", 0)) - int(room.get("chipsWithdrawn", 0))


def _issue_chips(room: dict[str, Any], player_id: str, amount: int) -> None:
    room["players"][player_id]["chips"] += amount
    room["chipsIssued"] = int(room.get("chipsIssued", 0)) + amount


def _average_live_stack(room: dict[str, Any]) -> int | None:
    """What the players still in are carrying, or None if nobody is.

    Over the players still in, because averaging in the busted would hand
    whoever is arriving less than anybody actually has.
    """
    live = [room["players"][pid]["chips"] for pid in _eligible_player_ids(room)]
    return round(sum(live) / len(live)) if live else None


def _entry_stack(room: dict[str, Any]) -> int:
    """What somebody turning up mid-tournament sits down behind.

    The average is not sentiment: by level nine a starting stack is a handful
    of big blinds, so somebody arriving on it is not really playing.
    """
    start = int(room["startingChips"])
    if room.get("lateEntryChips") != "average":
        return start
    average = _average_live_stack(room)
    return max(start, average) if average is not None else start


def _rebuy_stack(room: dict[str, Any]) -> int:
    """What buying back in puts in front of you.

    Same argument as ``_entry_stack`` and the same floor: never below the
    opening stack, because a rebuy that hands you less than you started with is
    a rebuy that reads as a punishment. Rooms made before this was a choice
    carry no ``rebuyChips`` and get the opening stack, which is what they had.
    """
    start = int(room["startingChips"])
    mode = room.get("rebuyChips") or "start"
    if mode == "fixed":
        return max(1, int(room.get("rebuyChipsFixed") or 0) or start)
    if mode == "average":
        average = _average_live_stack(room)
        return max(start, average) if average is not None else start
    return start


def _rebuys_left(room: dict[str, Any], player: dict[str, Any]) -> int:
    return max(0, int(room.get("rebuysPerPlayer") or 0) - int(player.get("rebuys", 0)))


def _anyone_can_still_rebuy(room: dict[str, Any]) -> bool:
    """Whether the table is waiting on somebody who could still come back."""
    if not _rebuy_open(room, time.time()):
        return False
    return any(
        room["players"][pid]["chips"] <= 0 and _rebuys_left(room, room["players"][pid])
        for pid in room["order"]
    )


def _pass_the_host_role(room: dict[str, Any]) -> None:
    """Give the table's controls to somebody who is still at it.

    Being host is not a label on the room, it is the only credential that can
    start a hand, stop the table, call the last one and show somebody the door.
    Walking off with it in your pocket leaves a table that can do none of those
    — which, once the auto-deal has nothing left to deal, is a room that is
    over whether or not anybody meant it to be.

    Busting out does not trigger this: they are still at the table, watching,
    and it is still their room. Only leaving it does.
    """
    if _has_seat(room["players"].get(room.get("hostId") or "")):
        return
    successor = next(
        (pid for pid in room["order"] if _has_seat(room["players"].get(pid))), None
    )
    if successor:
        room["hostId"] = successor


def _remove_from_table(
    room: dict[str, Any], player_id: str, withdraw: bool, kicked: bool = False
) -> None:
    """Take somebody out of the game, keeping the books straight.

    Their record stays — the final standings look players up by id, and
    deleting them outright turns the podium into a KeyError — but the seat, the
    chips and the credential all go. ``withdraw`` says whether the stack leaves
    the table with them, which is the difference between going home and being
    knocked out; ``kicked`` whether it was their decision, which is the
    difference between being able to come back and not.
    """
    player = room["players"][player_id]
    if kicked:
        player["kicked"] = True
    if withdraw:
        room["chipsWithdrawn"] = int(room.get("chipsWithdrawn", 0)) + int(
            player["chips"]
        )
    busted = room.setdefault("bustOrder", [])
    if player_id not in busted:
        busted.append(player_id)
    player["chips"] = 0
    player["removed"] = True
    player["leaving"] = False
    if room.get("buttonId") == player_id:
        # The button moves to the *seat* after the one holding it, so losing
        # that player must not reset it: hand it back to the seat before, and
        # the next deal advances onto the right one.
        room["buttonId"] = _previous_seat(room, player_id)
    room["order"] = [pid for pid in room["order"] if pid != player_id]
    _pass_the_host_role(room)


def _seat_in_order(room: dict[str, Any], player_id: str) -> None:
    """Put a player into the rotation where they are physically sitting.

    ``order`` is what the button walks round, so it has to be the seating and
    not the arrival list. They coincided while seats were only ever handed out
    in order; a chair freed and refilled — or somebody turning up at level
    three — is exactly when they stop.
    """
    if player_id not in room["order"]:
        room["order"].append(player_id)
    room["order"].sort(key=lambda pid: room["players"][pid]["seat"])


def _start_break(room: dict[str, Any], now: float) -> None:
    every = int(room["breakEveryLevels"])
    index, _ = _projected_level(room, _clock_now(room, now))
    room["breaksTaken"] = index // every
    _pause_table(room, now)
    room["breakUntil"] = now + int(room["breakMinutes"]) * 60


# --------------------------------------------------------------------------- #
# Engine / hand orchestration
# --------------------------------------------------------------------------- #
def _eligible_player_ids(room: dict[str, Any]) -> list[str]:
    """Everybody still in the tournament: chips in front of them, dealt in.

    Sitting out is **not** on this list, and that is the rule rather than an
    oversight. It used to be: somebody who sat out was skipped by the deal
    entirely, so they paid no blinds and no antes while everybody else did —
    which makes stepping away the cheapest move at the table. Wait out a level
    from the sofa and come back with the same stack everybody else has been
    paying for. The bigger the blinds, the better it gets.

    So sitting out means being *away from the table*, not out of the hand. You
    are dealt in, you post, and your hand is played out the way an absent
    player's is: checked when it is free and folded when it costs — see
    `_run_away`. Which is what happens in a real tournament, and it is why
    people come back from dinner.
    """
    return [pid for pid in room["order"] if room["players"][pid]["chips"] > 0]


def _anyone_at_the_table(room: dict[str, Any]) -> bool:
    """Whether a single player with chips is actually here.

    The one thing the rule above needs a brake for. Blinding an absent player
    down is right while there is a table to be absent *from*; dealing hand
    after hand to a room where everybody has stepped away is the app playing a
    tournament by itself and handing the result to whoever comes back first.
    Nobody gains — they are all being blinded equally — so nothing is lost by
    waiting, and an evening is not.

    The appointment stays set rather than being cancelled, so the first person
    back finds a hand already due.
    """
    return any(
        not room["players"][pid].get("sittingOut") for pid in _eligible_player_ids(room)
    )


def _save_state(room: dict[str, Any], state) -> None:
    """Write the engine state back, and count the turn it just passed.

    ``handNumber`` stops a delayed request landing on a *later* hand. It does
    nothing about the same one: if a raise comes back round, the turn returns
    to a player who has already acted, and a duplicate of their earlier request
    — a double tap, a retry after a stall — is legal all over again and gets
    applied. They call a bet they never saw.

    So every advance of the engine gets a number, the client sends back the one
    it was looking at, and an order about a moment that has passed is refused.
    Monotonic for the life of the room, never reset by a new hand, so it can
    also say "the situation this was decided under" for anything saved ahead of
    time.
    """
    room["stateB64"] = poker.dumps(state)
    room["turnId"] = int(room.get("turnId", 0)) + 1


# How many decisions the table remembers. Long enough that a client polling at
# 1.2 seconds cannot miss one — a street round a nine-handed table is nine
# actions, and pre-actions can fire several of them between two polls — and
# short enough to stay a footnote on every response.
ACTION_LOG_MAX = 24


def _action_mark(state) -> dict[str, Any]:
    """Everything about the moment *before* an action that naming it needs.

    Taken as one object so the four places that apply an action cannot each
    forget a different half of it.
    """
    seat = state.actor_index
    return {
        "mark": poker.action_mark(state),
        "seat": seat,
        "bets": [int(b) for b in state.bets],
        "stack": int(state.stacks[seat]) if seat is not None else 0,
        "street": poker.street_name(state),
    }


def _record_action(
    room: dict[str, Any],
    before: dict[str, Any],
    state,
    *,
    auto: bool = False,
) -> None:
    """Write down what just happened, because the view cannot be asked.

    Every other moment at this table can be recovered by comparing two polled
    views: chips appear in front of somebody, a hand goes grey, the board grows
    a card. **Checking cannot.** Nothing about the table changes except whose
    turn it is, and "the turn moved and nothing else did" is the same picture
    as a street closing, a hand being dealt, or somebody's clock running out.
    So the one action a poker table is most recognisable for is the one a
    polled client is blind to, and that is what this list exists for.

    Kept per hand and bounded, not a full history: the point is that a client
    can catch up on what it missed between two polls, and ``seq`` — which never
    restarts — is how it knows which of these it has already played.
    """
    seat = before.get("seat")
    hand_ids = room.get("handPlayerIds") or []
    if seat is None or seat >= len(hand_ids):
        return
    described = poker.describe_action(
        state, before["mark"], seat, before["bets"], before["stack"]
    )
    if described is None:
        return
    seq = int(room.get("actionSeq", 0)) + 1
    room["actionSeq"] = seq
    log = room.setdefault("actionLog", [])
    log.append(
        {
            "seq": seq,
            "handNumber": int(room.get("handNumber", 0)),
            "playerId": hand_ids[seat],
            "street": before["street"],
            # Nobody decided this: the clock did, or somebody who had already
            # left. A fold that was chosen and a fold that ran out of time are
            # the same chips and a completely different moment.
            "auto": bool(auto),
            **described,
        }
    )
    del log[:-ACTION_LOG_MAX]


def _set_action_deadline(room: dict[str, Any], state, now: float) -> None:
    """Arm the shot clock for whoever is to act (or disarm it).

    Also writes down *who* is to act. Only the view needed that before, and it
    unpickles the engine anyway; the schedule needs it on every poll, to ask
    whether the player being waited on is one who has already left — and
    unpickling a whole hand to answer that on every request from every client
    is not a price worth paying for something the deal already knows.
    """
    seconds = int(room.get("actionSeconds") or 0)
    live = bool(state.status) and state.actor_index is not None
    room["actionDeadline"] = now + seconds if (seconds and live) else None
    # A new decision is on the shot clock, whatever the last one ended up
    # costing. The bank only ever opens once the clock has run out.
    room["bankRunning"] = False
    # The other thing a hand can be waiting for. It is not a decision about the
    # hand — the chips are already in — so it gets its own, shorter clock, and
    # it lives here because this is the one place that asks what the hand needs
    # next after every single advance of the engine.
    waiting = poker.runout_choosers(state)
    room["runoutSeats"] = waiting
    room["runoutDeadline"] = now + RUNOUT_SECONDS if waiting else None
    hand_ids = room.get("handPlayerIds") or []
    room["actorId"] = (
        hand_ids[state.actor_index]
        if live and state.actor_index < len(hand_ids)
        else None
    )


def _can_sit_out(room: dict[str, Any], player: dict[str, Any]) -> bool:
    """Whether benching this player still leaves a playable table. Always.

    It did not use to. Sitting out removed a player from the deal, so doing it
    heads-up left one eligible player and two live stacks: the tournament could
    neither deal nor declare a winner, and it hung there. This function existed
    to refuse that, and the refusal was awkward to explain to somebody who
    simply wanted to step away.

    Now that an absent player is dealt in and blinded like everybody else, the
    case cannot arise — the table always has the same number of hands in it —
    and the outcome the old docstring called the truer one is what happens at
    every seat rather than only heads-up: the blinds eat their stack and they
    bust out, exactly as they would for walking away from a real table.

    Kept as a function, and called where it was called, because "can this
    player sit out" is a question the client asks and the answer wants one
    place to live if it ever stops being yes.
    """
    return True


def _hand_was_shown_down(room: dict[str, Any]) -> bool:
    """Whether two or more hands were still live when the hand ended.

    Derived rather than stored, and from the same two fields `_build_view` uses,
    so the pause and the cards on screen can never disagree about whether there
    was a showdown.
    """
    hand_ids = room.get("handPlayerIds") or []
    folded = set(room.get("foldedSeats") or [])
    return (len(hand_ids) - len(folded)) >= 2


def _seats_that_must_show(
    room: dict[str, Any], state, pushed: list[int] | None = None
) -> list[int]:
    """Who has to turn their hand over at the end, in the order they do it.

    The rule everybody at a real table knows and no app had implemented here:
    the last player to bet or raise on the final street shows first, and from
    then on **a hand only has to be shown to beat what is already face up, or
    to collect a pot it has won**. Nobody else is obliged to say anything, and
    the reason is not politeness — it is that a beaten hand shown for free is a
    free reading of how that player plays, handed to the table by the app
    rather than by them.

    That second clause is not a detail. "Beats what is showing" is one
    comparison and a hand can win without being the best one at the table: a
    short stack is all in for the main pot, the two behind keep betting, and
    the side pot goes to the better of *those two* — whose kings lose to the
    ace-high that took the main and would therefore never be turned over. So a
    player collected a pot with a hand nobody at the table ever saw, and with
    7-2 running they collected the bonus for it too. A pot is claimed face up.

    Everything not in this list is thrown away face down, and its owner is
    offered the choice to show it anyway (`ShowCards`), which is the half of
    this that makes a home game a home game.

    Ordered, because the order is the answer: the walk *is* the rule.
    """
    hand_ids = room.get("handPlayerIds") or []
    folded = set(room.get("foldedSeats") or [])
    live = [i for i in range(len(hand_ids)) if i not in folded]
    if len(live) < 2:
        return live

    board = poker.boards(state)
    cards = board[0] if board else []

    # Who is first to speak: the last player to bet or raise **on the final
    # betting street**, which is the street the hand's last decision was made
    # on — the river if it got there, the flop if everybody was already all in.
    #
    # Scoped to that street and not to the whole hand, because those are
    # different players and only one of them owes the table anything. Bet the
    # turn, get called, check the river through, and the turn's bettor is under
    # no obligation to show first: on the last street nobody claimed anything,
    # so the rule falls back to where a dealer starts asking, which is the
    # first live seat to the left of the button.
    hand_no = room.get("handNumber")
    log = [e for e in (room.get("actionLog") or []) if e.get("handNumber") == hand_no]
    last_street = log[-1].get("street") if log else None
    opener: int | None = None
    for entry in log:
        if entry.get("street") != last_street:
            continue
        if entry.get("kind") in ("bet", "raise"):
            seat = hand_ids.index(entry["playerId"]) if entry.get("playerId") in hand_ids else None
            if seat is not None and seat in live:
                opener = seat
    if opener is None:
        button = hand_ids.index(room["buttonId"]) if room.get("buttonId") in hand_ids else 0
        after = [i for i in live if i > button] + [i for i in live if i <= button]
        opener = after[0]

    order = [i for i in live if i >= opener] + [i for i in live if i < opener]

    # Run twice and there are two boards, two best hands and two answers to
    # "does this beat what is showing". Nobody mucks; everything is turned
    # over — in the order it would have been, which is what the walk above is
    # for and why this asks after building it rather than before.
    if len(board) > 1:
        return order

    holes = room.get("handHoleCards") or []
    # Every seat the engine pushed chips to. Beating what is showing is not the
    # only reason to turn a hand over — collecting is the other one, and with
    # side pots the two come apart.
    collected = {i for i, chips in enumerate(pushed or []) if chips > 0}

    must: list[int] = []
    best = None
    for seat in order:
        hole = holes[seat] if seat < len(holes) else []
        rank = poker.hand_rank(hole, cards)
        # A hand nobody can rank is a hand nobody may muck on the strength of.
        if seat in collected or rank is None or best is None or rank >= best:
            must.append(seat)
            if rank is not None and (best is None or rank > best):
                best = rank
    return must


def _handover_seconds(room: dict[str, Any]) -> int:
    """How long to sit on the hand that just ended before dealing the next.

    Built up from what actually happened, because that is what decides how long
    anybody wants to look at it. See the constants for the reasoning.
    """
    if not _hand_was_shown_down(room):
        # Nobody showed anything. There is one line of text to read and the
        # chips to watch land, and holding the table past that is dead time.
        seconds = HANDOVER_FOLD_SECONDS
        # Unless the bluff is worth money here, in which case the only place to
        # claim it is this pause.
        if int(room.get("sevenDeuce") or 0):
            seconds += HANDOVER_SEVEN_DEUCE_SECONDS
        return seconds

    seconds = HANDOVER_SHOWDOWN_SECONDS
    if any(entry.get("allIn") for entry in room.get("actionLog") or []):
        seconds += HANDOVER_ALL_IN_SECONDS
    if len(room.get("boardResults") or []) > 1:
        seconds += HANDOVER_SECOND_BOARD_SECONDS
    players = room.get("players") or {}
    if any(
        (players.get(entry.get("playerId")) or {}).get("chips", 1) <= 0
        for entry in room.get("lastResults") or []
    ):
        seconds += HANDOVER_BUST_SECONDS
    return min(seconds, HANDOVER_MAX_SECONDS)


def _arm_auto_deal(room: dict[str, Any]) -> None:
    """Schedule the next deal, unless the table is stopped."""
    on = int(room.get("autoDealSeconds", AUTO_DEAL_SECONDS) or 0)
    if on and not _is_paused(room):
        room["autoDealAt"] = time.time() + _handover_seconds(room)
    else:
        room["autoDealAt"] = None


def _auto_deal_due(room: dict[str, Any]) -> bool:
    return _scheduled_deal(room) is not None and time.time() >= _scheduled_deal(room)


def _next_button(room: dict[str, Any], eligible: list[str]) -> str:
    """The seat that takes the button for the next hand.

    The button moves one *seat* clockwise, not one *player*: we walk ``order``
    from where it was and stop at the first player still in, so busting out
    doesn't drag the button backwards. Deriving it instead from the hand number
    — which is what this used to do — meant the opening seat jumped to an
    arbitrary place every time the field changed size, and the blinds stopped
    going round evenly.
    """
    order = room["order"]
    previous = room.get("buttonId")
    if previous not in order:
        # First hand of the tournament (or a room saved before the button was
        # tracked). Putting it on the last seat makes the first seat the small
        # blind, which is where a table naturally starts.
        return eligible[-1]
    start = order.index(previous)
    for step in range(1, len(order) + 1):
        pid = order[(start + step) % len(order)]
        if pid in eligible:
            return pid
    return eligible[-1]  # unreachable: eligible is a subset of order


def _previous_seat(room: dict[str, Any], player_id: str) -> str | None:
    """The seat before this one, going the way the button travels.

    Used when the player holding the button leaves: parking it behind them
    means the next deal advances onto the seat that was next anyway, instead of
    the button jumping somewhere arbitrary.
    """
    order = room["order"]
    if player_id not in order:
        return room.get("buttonId")
    start = order.index(player_id)
    for step in range(1, len(order)):
        candidate = order[(start - step) % len(order)]
        if candidate != player_id:
            return candidate
    return None


def _seat_order(button_id: str, eligible: list[str]) -> list[str]:
    """Players in the order pokerkit posts blinds in.

    Three or more, that is small blind first and the button last, so the blinds
    open the hand and the button acts last.

    **Heads-up, pokerkit reverses it**, and this is the one place at this table
    where the obvious code was wrong in a way nothing caught. Two players and
    pokerkit charges index 0 the *big* blind, makes index 1 the button, and
    gives index 1 the action first — which is correct heads-up poker: the button
    is the small blind and opens before the flop.

    This used to return the button first, on the reasonable-sounding reading
    that "index 0 is the small blind" and "heads-up the button is the small
    blind". Both halves are true and the conclusion is not, and the result was a
    heads-up game where **the dealer posted the big blind, the other player
    posted the small, and the big blind acted first** — every hand, in the one
    format where two people play the most hands. The seat tags said the right
    thing the whole time, which is what made it survive: the view labels
    positions from `positions`, not from the money, so the drawing agreed with
    the plan and the plan disagreed with the engine.
    """
    i = eligible.index(button_id)
    if len(eligible) == 2:
        return [eligible[(i + 1) % 2], button_id]
    return eligible[i + 1 :] + eligible[: i + 1]


def _rack_up(room: dict[str, Any]) -> None:
    """Put the table back to a lobby, with the same people and the same rules.

    What actually happens at a home game when the last chip is pushed: nobody
    goes home, somebody says "again?", and the chips go back into stacks. The
    app's answer to that was a podium and no way off it — a screen with nothing
    on it to press, which is the one thing a screen at the end of an evening
    has to have.

    Everything a tournament *accumulates* is cleared and everything it was
    *set up with* is kept, which is the whole distinction. Seats, names and
    credentials survive, so nobody rejoins and nobody loses their place at the
    table; blinds, structure, timers and house rules survive, because they are
    the table's, not the night's.

    The ledger is restated rather than added to. Rebuys and late entries mean
    the old tournament had more chips on it than it started with, and carrying
    that forward would leave `chipsIssued` describing a night that is over —
    so it is set to what this one is issuing, which is the same arithmetic
    `create_room` does with one player.
    """
    for pid in room["order"]:
        player = room["players"][pid]
        player["chips"] = room["startingChips"]
        player["rebuys"] = 0
        player["addOnTaken"] = False
        player["autoSatOut"] = False
        player["leaving"] = False
        player["timeBank"] = int(room.get("timeBankSeconds") or 0)
    room["chipsIssued"] = room["startingChips"] * len(room["order"])
    room["chipsWithdrawn"] = 0

    room["tournamentNumber"] = int(room.get("tournamentNumber") or 1) + 1
    room["phase"] = "lobby"
    room["handNumber"] = 0
    room["buttonId"] = None
    room["stateB64"] = None
    room["handPlayerIds"] = []
    room["handStartStacks"] = []
    room["handHoleCards"] = []
    room["foldedSeats"] = []
    room["actionLog"] = []
    room["lastResults"] = []
    room["boardResults"] = []
    room["showSeats"] = []
    room["shownSeats"] = {}
    room["pendingShowSeats"] = {}
    room["potAtEnd"] = 0
    room["standings"] = []
    room["bustOrder"] = []
    room["sevenDeuceWin"] = None
    room["sevenDeucePaid"] = False
    room["sevenDeucePending"] = False
    # Every clock and every appointment. A `finishAt` left over from the last
    # tournament closes this one on its first poll.
    room["levelIndex"] = 0
    room["levelStartedAt"] = None
    room["actionDeadline"] = None
    room["autoDealAt"] = None
    room["finishAt"] = None
    room["closeAt"] = None
    room["breakUntil"] = None
    room["breaksTaken"] = 0
    room["runoutSeats"] = []
    room["runoutDeadline"] = None
    room["bankRunning"] = False
    room["paused"] = False
    room["autoDealPaused"] = False
    room["pausedAt"] = None
    room["lastHand"] = False
    room["lastHandNumber"] = None
    # And the receipts, which name a request by the hand it was made in. Hand
    # numbers start again from zero, so a receipt kept from the last tournament
    # is a name the next one will use again — and the first player to fold on
    # hand 3 would be answered with what somebody did on hand 3 last time.
    room["receipts"] = {}


def _start_hand(room: dict[str, Any]) -> None:
    now = time.time()
    room["autoDealAt"] = None
    room["finishAt"] = None
    eligible = _eligible_player_ids(room)
    if len(eligible) < 2:
        _finish_tournament(room)
        raise fastapi.HTTPException(
            400, "Need at least two players with chips to start a hand."
        )
    _apply_level(room, now)
    button_id = _next_button(room, eligible)
    room["buttonId"] = button_id
    # Index 0 is the small blind — except heads-up, where it is the big blind
    # and the button is index 1. See `_seat_order`.
    hand_ids = _seat_order(button_id, eligible)
    start_stacks = [room["players"][pid]["chips"] for pid in hand_ids]
    bomb = _bomb_pot_due(room, len(hand_ids))
    straddle = _straddle_for(room, len(hand_ids))

    if bomb:
        # No preflop to play: everybody is in for the same amount, so nobody
        # is facing anything. Nothing here is a position.
        state = poker.create_hand(
            start_stacks,
            room["smallBlind"],
            room["bigBlind"],
            forced=poker.bomb_pot_forced(len(hand_ids), bomb),
            run_it_twice=bool(room.get("runItTwice")),
        )
        poker.check_around(state)
        positions = {"sb": -1, "bb": -1, "button": hand_ids.index(button_id)}
    else:
        forced = [room["smallBlind"], room["bigBlind"]]
        if straddle:
            forced.append(straddle)
        state = poker.create_hand(
            start_stacks,
            room["smallBlind"],
            room["bigBlind"],
            ante=_ante_for(room),
            ante_from_big_blind=room.get("anteMode") == "bb",
            forced=forced,
            run_it_twice=bool(room.get("runItTwice")),
        )
        # Read off the same rule `_seat_order` just applied, because heads-up
        # that rule is the reverse of the one everybody assumes. Deducing it
        # from the posted bets instead is what a straddle and a bomb pot break.
        heads_up = len(hand_ids) == 2
        positions = {
            "sb": 1 if heads_up else 0,
            "bb": 0 if heads_up else 1,
            "button": hand_ids.index(button_id),
            # Under the gun posts blind and acts last preflop. Only meaningful
            # when a straddle is in play, hence -1 the rest of the time.
            "straddle": 2 if straddle else -1,
        }

    room["handPlayerIds"] = hand_ids
    room["handStartStacks"] = start_stacks
    room["bombPot"] = bool(bomb)
    # Positions are known from the order we just built — the small blind is
    # whoever we put first — so they are recorded, not deduced. Reading them
    # back off the posted bets only worked while the blinds were the only
    # forced bets on the table, which a straddle and a bomb pot both break:
    # deduction calls the straddler the big blind, and a bomb pot has no
    # blinds at all to deduce from.
    room["positions"] = positions
    # Seat indices (within handPlayerIds) of players who folded this hand.
    # Tracked explicitly because pokerkit clears every player's status once the
    # hand ends, so the final state can't distinguish a fold from a showdown
    # loss.
    room["foldedSeats"] = []
    # Seats whose shot clock expired at least once this hand (shown in the UI).
    room["timedOutSeats"] = []
    # What everybody did, this hand only. ``actionSeq`` is deliberately *not*
    # reset with it: it is how a client knows whether it has already played a
    # given moment, and a counter that restarts every hand would have it
    # replaying the first action of every deal.
    room["actionLog"] = []
    # Hole cards are fixed for the whole hand in Hold'em, so snapshot them at
    # deal time. pokerkit mucks the losing hand at showdown (clearing its
    # cards), but we still want to reveal every non-folded hand.
    room["handHoleCards"] = [poker.hole_cards(state, i) for i in range(len(hand_ids))]
    # Cards players chose to turn over last hand. Showing is for the hand it
    # belongs to; a new deal takes them back off the table.
    room["shownSeats"] = {}
    # Cards a player who folded mid-hand has *asked* to turn over. Not public
    # yet: exposing a card while there is still betting to come would be giving
    # live players information, which is the one thing showing must never do.
    # They move into `shownSeats` the moment the hand settles.
    room["pendingShowSeats"] = {}
    # And who the last showdown made show. New hand, nothing shown yet.
    room["showSeats"] = []
    # Last hand's pot is last hand's. See `_settle_hand`.
    room["potAtEnd"] = 0
    # A plan is for the hand it was made during. New cards, no plans — the
    # check that reads them enforces this anyway, but leaving them lying about
    # is a shape somebody will eventually trust.
    for player in room["players"].values():
        player.pop("preAction", None)
    room["sevenDeucePaid"] = False
    room["sevenDeuceWin"] = None
    _save_state(room, state)
    room["phase"] = "hand"
    room["lastResults"] = []
    room["handNumber"] += 1
    _set_action_deadline(room, state, now)

    # A hand can immediately be over if only blinds create an all-in etc.
    if poker.is_hand_over(state):
        _settle_hand(room, state)


def _settle_hand(room: dict[str, Any], state) -> None:
    hand_ids = room["handPlayerIds"]
    folded_seats = set(room.get("foldedSeats", []))
    # Naming a hand only makes sense when it was actually shown down. If
    # everyone folded, the winner never had to reveal anything.
    went_to_showdown = _hand_was_shown_down(room)
    dealt = poker.boards(state)
    board = dealt[0]
    stored_holes = room.get("handHoleCards") or []
    # Run twice, and "who won" is two answers rather than one — a player who
    # takes both and a player who chops both come out of the arithmetic
    # identically, and the whole point of the second board is the difference.
    per_board = poker.pushed_by_board(state, len(hand_ids)) if len(dealt) > 1 else []
    room["boardResults"] = [
        {
            "cards": cards,
            "winners": [room["players"][hand_ids[s]]["name"] for s in seats],
        }
        for cards, seats in zip(dealt, per_board)
    ]

    # Read off the engine rather than netted out of the deltas: winning a pot
    # and finishing ahead are different questions once side pots exist. See
    # poker.pushed_amounts.
    pushed = poker.pushed_amounts(state, len(hand_ids))

    # What was in the middle when the hand ended, kept for as long as the hand
    # is on screen.
    #
    # `pot_total` works the pot out as "what has left the stacks and is not
    # still on the felt", and the moment the engine pushes the chips to whoever
    # won them that comes to zero. So the last street of every hand had no
    # collection to show — the river bets never got raked, they simply stopped
    # existing — and the mound in the middle vanished the instant the hand was
    # over, several seconds before the pot it represents crossed the felt.
    #
    # The total only. The breakdown into side pots is there to tell a player
    # what their call is chasing, and once nobody has a call to make there is
    # one pot on the table: the one being pushed.
    room["potAtEnd"] = sum(pushed)

    results = []
    for i, pid in enumerate(hand_ids):
        final = int(state.stacks[i])
        delta = final - room["handStartStacks"][i]
        room["players"][pid]["chips"] = final
        entry = {
            "playerId": pid,
            "name": room["players"][pid]["name"],
            "delta": delta,
            "won": pushed[i],
        }
        # Naming the hand is only unambiguous on one board. With two, the same
        # player usually has two different hands, and picking one to print is
        # picking one to be wrong about — the boards are shown instead.
        if (
            went_to_showdown
            and len(dealt) == 1
            and i not in folded_seats
            and i < len(stored_holes)
        ):
            made = poker.evaluate_hand(stored_holes[i], board)
            if made:
                entry["handName"] = made["name"]
                entry["handCards"] = made["cards"]
        results.append(entry)

    room["lastResults"] = results
    # Which hands the showdown itself turns over. Worked out once, here, and
    # stored: it is read by every viewer on every poll and it must not be able
    # to change its mind halfway through a reveal. See `_seats_that_must_show`.
    room["showSeats"] = (
        _seats_that_must_show(room, state, pushed) if went_to_showdown else []
    )
    room["phase"] = "handover"
    room["actionDeadline"] = None
    room["actorId"] = None
    # Whatever the hand was waiting on, it is not waiting any more.
    room["runoutSeats"] = []
    room["runoutDeadline"] = None
    # Anybody who folded and asked to show turns over now, and not one moment
    # earlier — the request was made while the hand was still being played, and
    # a card face up then is a card the players still in it get to use.
    pending = room.pop("pendingShowSeats", None) or {}
    shown = room.setdefault("shownSeats", {})
    for seat, indices in pending.items():
        shown[seat] = sorted(set(shown.get(seat, [])) | set(indices))
    # Before the busts are recorded: the bonus is a transfer that can empty a
    # stack, and a player taken to zero by it is out like any other.
    _pay_seven_deuce(room)
    # Anybody who said goodbye mid-hand goes now, with whatever the hand left
    # them. Waiting until the hand was over is the whole point: a seat cannot
    # be pulled out from under a pot that is half played.
    for pid in [p for p in room["order"] if room["players"][p].get("leaving")]:
        _remove_from_table(room, pid, withdraw=True)
    _record_busts(room)
    # One player holding every chip ends the tournament — but not this instant.
    #
    # This called `_finish_tournament` here, in the same response that dealt the
    # last card, so the hand that decides the whole night was the one hand
    # nobody got to watch: the table was replaced by a scoreboard before the
    # showdown, before the pot went out, before anybody saw what it was won
    # with. Every other hand gets a pause to be looked at; this one gets the
    # same pause, and the schedule closes the room when it is up.
    if len(_eligible_player_ids(room)) < 2:
        room["finishAt"] = time.time() + _handover_seconds(room)
        # Tell the frontend this is the last hand so it shows "Finishing the
        # night…" instead of a "Deal next hand" button that would fail because
        # there is only one player with chips left.
        room["lastHand"] = True
    else:
        _arm_auto_deal(room)


def _hand_winners(room: dict[str, Any]) -> set[str]:
    """Who was pushed chips out of a pot.

    Deliberately not "who came out ahead". Two cases break that reading and
    both are ordinary poker:

      * an exact chop hands each side back what they put in, so nobody is up
        and a chopped pot would silently skip the 7-2 entirely;
      * with a side pot, the player who wins it can still be down on the hand —
        a short stack takes the main pot and the side-pot winner finishes below
        where they started. They won a pot. The net says otherwise.

    So the pot pushes are recorded at settle time (``won``) and read back here.
    ``delta`` remains the fallback for a room that settled before this existed;
    rooms live a day, so that is a grace period, not a migration.
    """
    hand_ids = room.get("handPlayerIds") or []
    folded = set(room.get("foldedSeats", []))
    results = {r["playerId"]: r for r in room.get("lastResults", [])}
    winners = set()
    for seat, pid in enumerate(hand_ids):
        if seat in folded:
            continue
        entry = results.get(pid)
        if entry is None:
            continue
        won = entry.get("won")
        took_a_pot = won > 0 if won is not None else entry.get("delta", -1) >= 0
        if took_a_pot:
            winners.add(pid)
    return winners


def _is_seven_deuce(hole: list[str]) -> bool:
    """Seven-deuce offsuit — the worst hand in hold'em, hence the prize."""
    if len(hole) != 2:
        return False
    return {c[0] for c in hole} == {"7", "2"} and hole[0][1] != hole[1][1]


def _cards_are_public(room: dict[str, Any], seat: int) -> bool:
    """Whether the whole table has seen this seat's hand.

    Reaching the showdown is not the test. This used to read "there was a
    showdown and this seat did not fold", which was the rule before the muck
    existed and has been wrong since: most hands at a showdown are thrown away
    face down, and calling them public paid the 7-2 bonus for a hand nobody
    had seen — the one prize in the game that exists to be *shown*.

    Two ways in, and they are the two ways cards get seen: the showdown turned
    it over (`showSeats`), or its owner did (`shownSeats`), and the second one
    means both cards, because half a hand proves nothing.
    """
    if seat in set(room.get("showSeats") or []):
        return True
    return len(set(room.get("shownSeats", {}).get(str(seat), []))) >= 2


def _results_for(room: dict[str, Any], viewer_id: str | None) -> list[dict[str, Any]]:
    """The hand's results, as this viewer is allowed to see them.

    `lastResults` names every hand that reached the showdown and carries the
    five cards that made it, because the panel at the end of the hand draws
    them — and it was going out to everybody, unfiltered. So a hand thrown away
    face down was named, with its cards, for the whole table and for anybody
    watching: the muck worked everywhere on screen except in the one panel that
    comes up after every hand. `players[].cards` was carefully filtered and
    then completely bypassed.

    Same rule as the cards themselves, applied to the same information under
    its other name: a hand the showdown turned over, one its owner turned over,
    or your own.
    """
    hand_ids = room.get("handPlayerIds") or []
    seat_of = {pid: i for i, pid in enumerate(hand_ids)}
    out: list[dict[str, Any]] = []
    for entry in room.get("lastResults") or []:
        seat = seat_of.get(entry.get("playerId"))
        public = entry.get("playerId") == viewer_id or (
            seat is not None and _cards_are_public(room, seat)
        )
        if public:
            out.append(entry)
        else:
            # What everybody is entitled to: who was in it and what it cost
            # them. Not what they were holding.
            out.append({k: v for k, v in entry.items() if k not in _PRIVATE_RESULT})
    return out


#: The fields of a result that say what a player was holding.
_PRIVATE_RESULT = ("handName", "handCards")


def _pay_seven_deuce(room: dict[str, Any]) -> None:
    """Collect the 7-2 bonus, if the pot was just won with the worst hand.

    The rule is a side bet between players, not something the engine knows
    about: the pot is already pushed by the time this runs, so it is a plain
    transfer on top. Which is also why it needs care — it can take a player to
    zero, and a bonus that busts somebody without the tournament noticing
    leaves a ghost sitting at the table with no chips.

    It pays on pots won by folding too, which is the whole point: the prize is
    for the bluff, not the miracle. That is what makes showing your cards a
    real decision, and why this is called again from ``/show`` — a winner who
    keeps them face down simply does not collect.

    Runs at most once per hand.
    """
    bonus = int(room["bigBlind"]) * int(room.get("sevenDeuce") or 0)
    if not bonus or room.get("sevenDeucePaid"):
        return
    hand_ids = room.get("handPlayerIds") or []
    holes = room.get("handHoleCards") or []
    winners = _hand_winners(room)

    # Usually one, but a chopped pot has two, and both could be holding it.
    # Paying the first and then charging the second is the sort of arithmetic
    # nobody checks until it happens at the table.
    claimants = [
        (seat, pid)
        for seat, pid in enumerate(hand_ids)
        if pid in winners
        and seat < len(holes)
        and _is_seven_deuce(holes[seat])
        and _cards_are_public(room, seat)
    ]
    if not claimants:
        return

    claiming = [pid for _, pid in claimants]  # ordered: the split remainder depends on it
    payouts: dict[str, int] = {pid: 0 for pid in claiming}
    for other in hand_ids:
        if other in claiming:
            continue
        # Nobody can be made to pay more than they have. Losing the last of
        # your chips to the 7-2 is a fine way to go out; owing them is not a
        # state this game has. With more than one claimant the payer's stack is
        # shared out rather than charged twice.
        owed = bonus * len(claiming)
        pay = min(owed, room["players"][other]["chips"])
        room["players"][other]["chips"] -= pay
        for i, pid in enumerate(claiming):
            share = pay // len(claiming) + (1 if i < pay % len(claiming) else 0)
            payouts[pid] += share
    for pid, amount in payouts.items():
        room["players"][pid]["chips"] += amount

    room["sevenDeucePaid"] = True
    room["sevenDeuceWin"] = {
        "playerId": claimants[0][1],
        "name": ", ".join(room["players"][pid]["name"] for pid in claiming),
        "amount": sum(payouts.values()),
    }


def _seven_deuce_pending(room: dict[str, Any], viewer_id: str | None) -> bool:
    """Whether *this viewer* has an unclaimed 7-2 bonus waiting on their cards.

    Deliberately per-viewer, and that is the whole point rather than a detail.
    Telling the table a bonus is pending tells the table the winner is holding
    seven-deuce — before they have decided whether to show it. The rule only
    means anything because that decision is theirs: prove the bluff and take
    the money, or keep the secret and let it go. Broadcasting it makes the
    choice for them.
    """
    if not int(room.get("sevenDeuce") or 0) or room.get("sevenDeucePaid"):
        return False
    if room.get("phase") != "handover" or viewer_id is None:
        return False
    hand_ids = room.get("handPlayerIds") or []
    holes = room.get("handHoleCards") or []
    if viewer_id not in hand_ids:
        return False
    seat = hand_ids.index(viewer_id)
    if seat >= len(holes) or not _is_seven_deuce(holes[seat]):
        return False
    return viewer_id in _hand_winners(room)


def _record_busts(room: dict[str, Any]) -> None:
    """Remember the order players ran out of chips, for final placings.

    Busting later is a better finish, so the bust list read backwards gives the
    standings below the winner. When several players go out on the same hand,
    the one who started it with more chips outlasted the others and places
    above them — the usual tournament tie-break.
    """
    busted = room.setdefault("bustOrder", [])
    stacks_at_deal = dict(
        zip(room.get("handPlayerIds", []), room.get("handStartStacks", []))
    )
    newly_out = [
        pid
        for pid in room["order"]
        if room["players"][pid]["chips"] <= 0 and pid not in busted
    ]
    newly_out.sort(key=lambda pid: stacks_at_deal.get(pid, 0))
    busted.extend(newly_out)


def _finish_tournament(room: dict[str, Any], by_chips: bool = False) -> None:
    """Close the room once at most one player still has chips.

    ``by_chips`` ends it while several players still have some, which is what
    "one more hand and then we stop" means: nobody was knocked out, so the
    placings come from the stacks. Everyone busted along the way keeps the
    finish they earned, below the players still standing.
    """
    survivors = [pid for pid in room["order"] if room["players"][pid]["chips"] > 0]
    if len(survivors) > 1 and not by_chips:
        return
    if not by_chips and _anyone_can_still_rebuy(room):
        # Ending now would crown a winner while somebody is still entitled to
        # sit back down. Wait until the window shuts instead, and let the
        # schedule close the room then — the appointment is written down so
        # that the table is not left waiting on a poll that never comes.
        room["closeAt"] = _window_closes_at(room, int(room["rebuyLevels"]))
        room["actionDeadline"] = None
        room["autoDealAt"] = None
        return
    room["closeAt"] = None
    survivors.sort(key=lambda pid: -room["players"][pid]["chips"])
    _record_busts(room)
    busted = list(room.get("bustOrder", []))
    ranking = survivors + [pid for pid in reversed(busted) if pid not in survivors]
    room["standings"] = [
        {
            "place": place,
            "playerId": pid,
            "name": room["players"][pid]["name"],
            "avatarUrl": room["players"][pid].get("avatarUrl"),
            "chips": room["players"][pid]["chips"],
        }
        for place, pid in enumerate(ranking, start=1)
    ]
    room["phase"] = "finished"
    room["actionDeadline"] = None
    room["autoDealAt"] = None
    # However we got here, the appointment to get here is kept.
    room["finishAt"] = None


# --------------------------------------------------------------------------- #
# Deciding before your turn
# --------------------------------------------------------------------------- #
# The single biggest thing that can be done for the pace of a hand, and the one
# place in this system where a bug takes chips off somebody who never agreed to
# lose them. Both halves of that are worth being careful about.
#
# The care is in *what is offered*, not only in how it is stored. A pre-action
# that names an amount — "call 100" — has to be invalidated the moment somebody
# raises to 300, and getting that wrong pays a price the player never accepted.
# So no option here names an amount. All three are defined against whatever the
# situation turns out to be:
#
#   check      I want the next card if it is free. If somebody bets, wake me.
#   check-fold I want the next card if it is free, and I am done if it is not.
#   call-any   Whatever it costs. That is the intent, stated by the player.
#
# There is nothing left to invalidate, because there is no number to be wrong
# about. "Call 100" is the option that would need it, and it is the option that
# is not here.
#
# What is still stored is which hand it was set during, because a plan for this
# hand must never fire in the next one, and which turn, because arming one for
# a turn that is already yours is a second way to act on the same decision.
#
# They fire on somebody else's poll, the same way the shot clock does, and they
# beat the shot clock: a player who has already decided is not "out of time".
PRE_ACTIONS = ("check", "check-fold", "call-any")


def _pre_action_for(room: dict[str, Any], player_id: str | None) -> str | None:
    """The standing instruction for this player on this hand, if it still holds."""
    player = room["players"].get(player_id or "")
    plan = (player or {}).get("preAction")
    if not plan or plan.get("handNumber") != room.get("handNumber"):
        return None
    return plan.get("action")


def _open_the_time_bank(room: dict[str, Any], now: float) -> bool:
    """Spend the actor's bank instead of playing the hand for them.

    The same trap as pausing, one level down: there is nothing running to
    decrement. Nothing decrements anywhere in this file — every clock is a
    deadline, and the answer is worked out when somebody asks. So the bank is
    not counted down second by second; it is handed over whole at the moment
    the shot clock runs out, as one longer deadline, and what is left of it is
    read back off that deadline when the player finally acts.

    That is also the right behaviour at the table. A bank that has to be
    claimed is a bank that gets forgotten by exactly the player who most needed
    it — the one staring at a decision, not at the interface.

    ``TIMEOUT_GRACE`` is not part of it: that is slack for the network, not
    thinking time, and it applies to the bank's deadline in its turn.
    """
    if room.get("bankRunning"):
        return False  # already spent; the clock's answer stands
    player = room["players"].get(room.get("actorId") or "")
    left = int(player.get("timeBank", room.get("timeBankSeconds", 0)) or 0) if player else 0
    if left <= 0:
        return False
    player["timeBank"] = left
    room["bankRunning"] = True
    room["actionDeadline"] = now + left
    return True


def _charge_the_time_bank(room: dict[str, Any], player_id: str, now: float) -> None:
    """Take from the bank exactly what this decision used of it."""
    if not room.get("bankRunning"):
        return
    player = room["players"].get(player_id)
    if player is not None:
        remaining = (room.get("actionDeadline") or now) - now
        player["timeBank"] = max(0, int(remaining))
    room["bankRunning"] = False


def _apply_timeouts(room: dict[str, Any]) -> dict[str, Any] | None:
    """Fast-forward the shot clock. Returns what it did, or None if nothing.

    Serverless has nowhere to run a timer, so the clock is enforced by whichever
    request arrives after it expires — and every seated client polls, so an
    absent player is always folded by somebody else's poll. One auto-action per
    call is enough: the next player then gets a full window starting now.
    """
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    deadline = room.get("actionDeadline")
    now = time.time()
    if not deadline or now < deadline + TIMEOUT_GRACE:
        return None

    state = poker.loads(room["stateB64"])
    if poker.is_hand_over(state) or state.actor_index is None:
        room["actionDeadline"] = None
        return {"seat": None, "action": None}

    if _open_the_time_bank(room, now):
        return {"seat": state.actor_index, "action": None, "bank": True}

    seat = state.actor_index
    # If the bank was open, this decision has just spent all of it.
    _charge_the_time_bank(room, room.get("actorId") or "", now)
    legal = poker.legal_actions(state)
    # Checking is free, so never fold a hand that can see the next card for
    # nothing. Otherwise the clock costs you the hand.
    if legal["canCheckOrCall"] and legal["callAmount"] == 0:
        action = "call"
    elif legal["canFold"]:
        action = "fold"
    else:
        action = "call"
    before = _action_mark(state)
    poker.apply_action(state, action)
    _record_action(room, before, state, auto=True)

    if action == "fold":
        folded = room.setdefault("foldedSeats", [])
        if seat not in folded:
            folded.append(seat)
    room["timedOutSeats"] = sorted({*room.get("timedOutSeats", []), seat})

    # Someone who keeps letting the clock run has walked away from the table.
    player = room["players"].get(room["handPlayerIds"][seat])
    if player is not None:
        player["missedTurns"] = int(player.get("missedTurns", 0)) + 1
        if player["missedTurns"] >= AUTO_SIT_OUT_TIMEOUTS and _can_sit_out(room, player):
            player["sittingOut"] = True
            player["autoSatOut"] = True

    _save_state(room, state)
    if poker.is_hand_over(state):
        _settle_hand(room, state)
    else:
        _set_action_deadline(room, state, now)
    return {"seat": seat, "action": action}


# --------------------------------------------------------------------------- #
# What the room owes the clock
# --------------------------------------------------------------------------- #
# Serverless has nowhere to run a timer, so everything this room does on its
# own is done by whichever request happens to arrive next. That works, and it
# has one failure mode worth designing against.
#
# There are two decisions, not one. The *outer* one, in ``GET /state``, decides
# whether to take the lock at all — most polls must not, or six phones at 1.2
# seconds each would queue behind one another all night. The *inner* one
# decides what to actually do once the lock is held. When those two disagree —
# the outer says "something is due", the inner finds nothing to do and leaves
# the condition standing — every poll from every client takes the lock, for
# ever. The room congests itself, and the cause is two lists of conditions that
# were meant to match and drifted.
#
# So there is one list. Each entry says when it comes due and what to do about
# it; the outer predicate and the inner tick both read it, and neither can grow
# a case the other does not have. Anything that schedules itself — the shot
# clock, dealing the next hand, and later the time bank, a break, a player
# leaving at the end of the hand, a pre-action — belongs here rather than in a
# branch of its own.
def _scheduled_clock(room: dict[str, Any]) -> float | None:
    """When an unanswered decision becomes the clock's to make."""
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    deadline = room.get("actionDeadline")
    return deadline + TIMEOUT_GRACE if deadline else None


def _scheduled_deal(room: dict[str, Any]) -> float | None:
    """When the next hand deals itself.

    Not while the room is empty of anybody actually present — see
    `_anyone_at_the_table`. The appointment is left standing rather than
    cancelled, so the first person back finds a hand already due.
    """
    if room.get("phase") != "handover" or _is_paused(room):
        return None
    if not _anyone_at_the_table(room):
        return None
    return room.get("autoDealAt") or None


def _scheduled_finish(room: dict[str, Any]) -> float | None:
    """When the pause on the last hand of the night is up.

    Deliberately not stopped by a paused table: the hand is over and the winner
    is decided, and a stopped table that never says who won is worse than a
    stopped one that does.
    """
    if room.get("phase") != "handover":
        return None
    return room.get("finishAt") or None


def _scheduled_break_end(room: dict[str, Any]) -> float | None:
    """When a break is over and the table starts itself again."""
    return room.get("breakUntil") or None


def _scheduled_away(room: dict[str, Any]) -> float | None:
    """Whether somebody who is not at the table is holding up the hand.

    Two ways to not be there and one answer to both: they said goodbye
    (``leaving``), or they stepped away (``sittingOut``). Their chips are still
    in the hand either way — that is the whole point of dealing an absent
    player in — but nobody is going to make the decision, so the hand should
    not stop and ask.

    Due immediately, not on the shot clock: making the table wait twenty
    seconds for an answer that is not coming is the thing this exists to avoid.
    """
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    actor = room.get("actorId")
    if actor is None:
        return None
    player = room["players"].get(actor, {})
    return 0.0 if player.get("leaving") or player.get("sittingOut") else None


def _scheduled_preaction(room: dict[str, Any]) -> float | None:
    """Whether the player to act has already said what they want to do.

    Due at once. Waiting even a second would give back the pace this exists to
    buy, and there is nothing to wait for: the decision was made before the
    turn arrived.
    """
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    return 0.0 if _pre_action_for(room, room.get("actorId")) else None


def _scheduled_runout(room: dict[str, Any]) -> float | None:
    """When an unanswered offer of a second board expires."""
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    return room.get("runoutDeadline") or None


def _scheduled_close(room: dict[str, Any]) -> float | None:
    """When a table that has run out of players finally gives up waiting."""
    return room.get("closeAt") or None


def _run_clock(room: dict[str, Any]) -> bool:
    return _apply_timeouts(room) is not None


def _run_away(room: dict[str, Any]) -> bool:
    """Play out the hand for somebody who is not there.

    Checking when it is free and folding when it is not — the same rule the
    shot clock uses, because it is the same situation and any other rule would
    give away chips that are still theirs until the hand ends. pokerkit will
    not let a player fold a hand they can see the next card of for nothing,
    which is why this cannot simply fold every time. It runs at once rather
    than on the clock, so the rest of the table is not kept waiting.

    The blinds are already posted by the time this runs, and they stay posted.
    That is the point of it: an absent player pays for their seat.

    Keeps going while the seat to act is still an empty one, which is not the
    one-per-request rule the rest of this schedule follows — and it has to be.
    An absent player can be asked twice in a row: heads-up the big blind takes
    their option, the street turns, and out of position they are first to speak
    again. Answering one of those per poll left the whole table waiting a second
    and a bit for a seat nobody was sitting in, and a table with several people
    away spent a poll on each of them. Bounded at one time round, so a request
    carries a street and never a whole hand.
    """
    state = poker.loads(room["stateB64"])
    acted = False
    for _ in range(len(room.get("handPlayerIds") or [])):
        if poker.is_hand_over(state) or state.actor_index is None:
            break
        seat = state.actor_index
        who = room["players"].get((room.get("handPlayerIds") or [None] * 9)[seat])
        if not who or not (who.get("leaving") or who.get("sittingOut")):
            break
        legal = poker.legal_actions(state)
        action = "call" if legal["canCheckOrCall"] and not legal["callAmount"] else "fold"
        if action == "fold" and not legal["canFold"]:
            action = "call"
        before = _action_mark(state)
        poker.apply_action(state, action)
        # Nobody is sitting there: this is the table playing out a hand for
        # somebody who is not at it, which is not the same moment as a decision.
        _record_action(room, before, state, auto=True)
        if action == "fold":
            folded = room.setdefault("foldedSeats", [])
            if seat not in folded:
                folded.append(seat)
        acted = True
    if not acted:
        return False
    _save_state(room, state)
    if poker.is_hand_over(state):
        _settle_hand(room, state)
    else:
        _set_action_deadline(room, state, time.time())
    return True


def _run_preaction(room: dict[str, Any]) -> bool:
    """Carry out standing instructions until somebody has to be asked.

    Deliberately *not* one per request, which is the rule everywhere else in
    this schedule. Three players who have all said "check" is precisely the
    situation pre-actions exist for, and resolving one per poll would take
    three and a half seconds to do what should be instant — giving back the
    pace the feature is for.

    Bounded at one time round the table, so a request can carry a street and
    never a whole hand. Whoever is left is picked up by the next poll, a moment
    later, exactly as before.
    """
    state = poker.loads(room["stateB64"])
    acted = False
    # Tracked apart from ``acted``: an instruction that lapses changes the room
    # without moving the hand, and reporting "nothing happened" would leave it
    # unsaved and due all over again on the next poll — for ever.
    changed = False
    for _ in range(len(room.get("handPlayerIds") or [])):
        if poker.is_hand_over(state) or state.actor_index is None:
            break
        seat = state.actor_index
        player_id = room["handPlayerIds"][seat]
        plan = _pre_action_for(room, player_id)
        if not plan:
            break
        legal = poker.legal_actions(state)
        free = legal["canCheckOrCall"] and not legal["callAmount"]
        if plan == "call-any":
            action = "call" if legal["canCheckOrCall"] else None
        elif free:
            action = "call"  # a check, in the engine's vocabulary
        elif plan == "check-fold":
            action = "fold" if legal["canFold"] else "call"
        else:
            # Plain "check", and somebody bet. The instruction was for a free
            # card, not for this, so it lapses and the player is asked.
            action = None
        # Used up either way: a standing instruction is for one decision, not a
        # policy for the rest of the hand. Cleared before acting, so a failure
        # below cannot leave it armed to fire again.
        changed = room["players"][player_id].pop("preAction", None) is not None
        if action is None:
            break
        before = _action_mark(state)
        poker.apply_action(state, action, None)
        # Chosen, just chosen early — so it is somebody's decision and not the
        # table acting for them.
        _record_action(room, before, state)
        if action == "fold":
            folded = room.setdefault("foldedSeats", [])
            if seat not in folded:
                folded.append(seat)
        # They are at the table — more so than somebody who just answered in
        # time, in fact. The clock's strikes go with it.
        room["players"][player_id]["missedTurns"] = 0
        acted = True

    if acted:
        _save_state(room, state)
        if poker.is_hand_over(state):
            _settle_hand(room, state)
        else:
            _set_action_deadline(room, state, time.time())
    return changed or acted


def _settle_runout(room: dict[str, Any], state) -> None:
    """Write back a hand that was waiting on the number of boards."""
    _save_state(room, state)
    if poker.is_hand_over(state):
        _settle_hand(room, state)
    else:
        _set_action_deadline(room, state, time.time())


def _run_runout(room: dict[str, Any]) -> bool:
    """Nobody answered in time, so the hand runs once.

    Which is also what happens when anybody says no — running it twice needs
    everyone, so silence and a refusal come to the same thing. That is what
    makes it safe to let the clock answer for a player who has walked off.
    """
    state = poker.loads(room["stateB64"])
    waiting = poker.runout_choosers(state)
    if not waiting:
        room["runoutDeadline"] = None
        return True
    for _ in waiting:
        poker.choose_runout(state, 1)
    _settle_runout(room, state)
    return True


def _run_close(room: dict[str, Any]) -> bool:
    room["closeAt"] = None
    _finish_tournament(room)
    return True


def _run_break_end(room: dict[str, Any]) -> bool:
    _resume_table(room, time.time())
    if room.get("phase") == "handover":
        _arm_auto_deal(room)
    return True


def _run_finish(room: dict[str, Any]) -> bool:
    """The last hand has been looked at for long enough. Call it."""
    _finish_tournament(room)
    return True


def _run_deal(room: dict[str, Any]) -> bool:
    now = time.time()
    # The end of the night comes before the break, because a table with no hand
    # left to play has nothing to come back from a break for. The other way
    # round, the host calls the last hand, it is played, the level ticks over,
    # and everybody sits looking at a five-minute countdown before being told
    # who won.
    if _no_more_hands(room):
        _finish_tournament(room, by_chips=True)
        return True
    # A break interrupts the deal rather than the hand: stopping the table
    # between hands is the only version of "back in ten minutes" that does not
    # abandon a half-played pot.
    if _break_due(room, now):
        _start_break(room, now)
        return True
    try:
        _start_hand(room)
    except fastapi.HTTPException:
        # Not enough players to continue: leave it to the host. Clearing the
        # appointment matters as much as the deal not happening — an unmet
        # condition left standing is what makes every later poll take the lock.
        room["autoDealAt"] = None
    return True


# In the order they must happen: an expired decision is settled before the next
# hand is dealt, or a late fold lands on a hand that has already started. A
# break ending comes first of all, because it is what makes a deal due again;
# a player who has left plays before the clock, because they are not waiting
# for it.
_SCHEDULE = (
    ("break", _scheduled_break_end, _run_break_end),
    # Two ways to not be at the table, one answer. See `_scheduled_away`.
    ("away", _scheduled_away, _run_away),
    # Before the clock, deliberately: a player who has already decided is not
    # out of time, and running the clock first would fold a hand they told us
    # they wanted to play.
    ("preaction", _scheduled_preaction, _run_preaction),
    ("runout", _scheduled_runout, _run_runout),
    ("clock", _scheduled_clock, _run_clock),
    ("deal", _scheduled_deal, _run_deal),
    # After the deal, because the two are never both due — a table with a
    # winner has nothing left to deal.
    ("finish", _scheduled_finish, _run_finish),
    ("close", _scheduled_close, _run_close),
)


# The one thing a stopped table still does, which is start itself again.
# Everything else — folding an unanswered decision, spending somebody's time
# bank, carrying out a standing instruction, dealing, closing — is the table
# playing, and a stopped table is not playing. Without this the host pauses for
# a pizza and comes back to three players folded by a clock that never stopped.
_WHILE_STOPPED = ("break",)


def _work_due(room: dict[str, Any], now: float) -> list[str]:
    """Everything this room should already have done by ``now``."""
    stopped = _is_paused(room)
    due = []
    for name, when, _ in _SCHEDULE:
        if stopped and name not in _WHILE_STOPPED:
            continue
        at = when(room)
        if at is not None and now >= at:
            due.append(name)
    return due


def _next_wakeup(room: dict[str, Any]) -> float | None:
    """The soonest this room has anything to do, for whoever wants to know."""
    times = [at for _, when, _ in _SCHEDULE if (at := when(room)) is not None]
    return min(times) if times else None


def _tick(room: dict[str, Any]) -> bool:
    """Bring the room up to date with the wall clock. True if it changed."""
    now = time.time()
    due = _work_due(room, now)
    changed = False
    for name, _, run in _SCHEDULE:
        if name in due:
            changed = run(room) or changed
    return changed


# --------------------------------------------------------------------------- #
# View building (per-player redaction)
# --------------------------------------------------------------------------- #
def _level_view(room: dict[str, Any], now: float) -> dict[str, Any] | None:
    """Blind level, what comes next, and how long until it arrives."""
    schedule = room.get("blindSchedule") or []
    if not schedule:
        return None
    duration = _level_duration(room)
    current_index = int(room.get("levelIndex", 0))
    # Held still while the table is stopped, so the countdown on everyone's
    # screen stops too. A clock that keeps running through a break is the
    # clearest way to tell players the pause is not real.
    now = _clock_now(room, now)
    projected_index, projected_start = _projected_level(room, now)
    last_index = len(schedule) - 1

    def level_at(index: int) -> dict[str, Any]:
        return {
            "number": index + 1,
            "smallBlind": schedule[index]["smallBlind"],
            "bigBlind": schedule[index]["bigBlind"],
        }

    # Seconds until the clock crosses the next boundary.
    seconds_left: int | None = None
    if duration and projected_start is not None and projected_index < last_index:
        seconds_left = max(0, int(round(projected_start + duration - now)))

    return {
        **level_at(current_index),
        "totalLevels": len(schedule),
        "durationSec": duration,
        "secondsLeft": seconds_left,
        # The level the clock has already reached while a hand was running. It
        # takes effect on the next deal, the way a live tournament finishes the
        # hand on the old level.
        "pending": level_at(projected_index)
        if projected_index > current_index
        else None,
        # What the countdown is counting down to.
        "next": None
        if projected_index >= last_index
        else level_at(projected_index + 1),
        "isLast": projected_index >= last_index,
    }


def _build_view(room: dict[str, Any], viewer_id: str | None) -> dict[str, Any]:
    now = time.time()
    players_out: list[dict[str, Any]] = []
    board: list[str] = []
    pot = 0
    pots: list[dict[str, Any]] = []
    actor_id: str | None = None
    legal: dict[str, Any] | None = None
    street = "lobby"

    state = None
    shown_down = False
    dealt_boards: list[list[str]] = []
    hand_ids: list[str] = room.get("handPlayerIds", []) or []
    if room.get("stateB64"):
        state = poker.loads(room["stateB64"])
        dealt_boards = poker.boards(state)
        # The first board stays where every existing caller looks for it, so a
        # table that never runs it twice sees exactly what it always saw.
        board = dealt_boards[0]
        pot = poker.pot_total(state, room["handStartStacks"])
        # Named by seat here and turned into player ids below, once the ids for
        # this hand are in hand.
        pots = poker.side_pots(state)
        street = poker.street_name(state)
        pos = room.get("positions") or poker.initial_positions(state)
        sb_i, bb_i, button_i = pos["sb"], pos["bb"], pos["button"]
        # -1 when the rule is not in play, which no seat index can ever be.
        straddle_i = pos.get("straddle", -1)
        actor_i = state.actor_index
        if actor_i is not None:
            actor_id = hand_ids[actor_i]
        viewer_index = hand_ids.index(viewer_id) if viewer_id in hand_ids else None
        hand_over = poker.is_hand_over(state)
        if viewer_index is not None and actor_i == viewer_index:
            legal = poker.legal_actions(state)

        folded_seats = set(room.get("foldedSeats", []))
        timed_out_seats = set(room.get("timedOutSeats", []))
        stored_holes = room.get("handHoleCards") or []
        # A showdown only happens when at least two players reach the end
        # without folding. If everyone else folded, the winner keeps cards hidden.
        went_to_showdown = _hand_was_shown_down(room)
        # Only meaningful once the hand is over; mid-hand nobody has shown yet.
        shown_down = hand_over and went_to_showdown
        engine_by_pid: dict[str, dict[str, Any]] = {}
        for i, pid in enumerate(hand_ids):
            folded = i in folded_seats
            in_hand = not folded
            # Hole cards are fixed for the hand; prefer the snapshot taken at
            # deal time (pokerkit mucks losers at showdown).
            hole = stored_holes[i] if i < len(stored_holes) else poker.hole_cards(state, i)
            # You always see your own cards. At showdown, reveal every hand that
            # did not fold.
            # Face up because the showdown made it so — see
            # `_seats_that_must_show`. A hand that neither beats what is
            # already face up nor collected a pot is not turned over by the
            # app; its owner may still choose to.
            made_to_show = i in set(room.get("showSeats") or [])
            reveal = (pid == viewer_id) or (
                hand_over and went_to_showdown and not folded and made_to_show
            )
            # Cards the player chose to turn over after the hand — the bluff
            # they want credit for, or the one card that keeps everyone
            # guessing. Only some of a hand may be shown, so this is per card.
            shown = set(room.get("shownSeats", {}).get(str(i), []))
            engine_by_pid[pid] = {
                "index": i,
                "inHand": in_hand,
                "folded": folded,
                # What is actually left behind the line right now. The room's
                # copy is only rewritten when the hand settles, so serving that
                # one shows everybody their stack from before they bet — and an
                # all-in player still reading full stack until showdown.
                #
                # Only while the hand is live, though. Once it settles the room
                # becomes the authority, and anything that moves chips after the
                # pot is pushed — the 7-2 bonus, and rebuys later — happens
                # there and nowhere near the engine. Reading the engine past
                # that point quietly hides those transfers.
                **({"chips": int(state.stacks[i])} if not hand_over else {}),
                "bet": int(state.bets[i]),
                "isActor": actor_i == i,
                "isButton": i == button_i,
                "isSmallBlind": i == sb_i,
                "isBigBlind": i == bb_i,
                "isStraddle": i == straddle_i,
                # A folded hand still has cards to turn over if its owner wants
                # the credit, so the count follows what is on the table rather
                # than whether they are still in it.
                "cardsCount": len(hole) if (not folded or shown) else 0,
                "cards": hole
                if reveal
                else ([c if j in shown else None for j, c in enumerate(hole)] if shown else None),
                # Which cards this player has turned face up. Needed on your own
                # seat too: you always see your whole hand, so the cards alone
                # cannot tell you what the rest of the table can see.
                "shownIndices": sorted(shown),
                # Whether the showdown obliged this hand to be face up. Public,
                # because who had to show is a fact about the hand everybody at
                # the table watched happen — and the client needs it to know
                # whether *you* still have a hand nobody has seen.
                "showedDown": bool(hand_over and went_to_showdown and not folded and made_to_show),
                # What you have *asked* to show, while the hand is still being
                # played. Yours only — a plan the rest of the table can read is
                # the exposure this was written to avoid — and it stays a plan
                # until `_settle_hand` turns the cards over.
                "pendingShowIndices": (
                    sorted(room.get("pendingShowSeats", {}).get(str(i), []))
                    if pid == viewer_id
                    else []
                ),
                # What you have made, against the board as it stands.
                #
                # Yours only, and that is the whole design: it is the one piece
                # of private information the table would never say out loud, and
                # sending anybody else's would be dealing the hand face up.
                # Named here rather than worked out on the client because the
                # evaluator is already here, and two evaluators is two answers.
                "handName": (
                    (
                        (poker.evaluate_hand(hole, board) or {}).get("name")
                        if len(hole) + len(board) >= 5
                        else poker.describe_hole(hole)
                    )
                    if pid == viewer_id and hole
                    else None
                ),
                "timedOut": i in timed_out_seats,
            }
    else:
        engine_by_pid = {}

    for pid in room["order"]:
        p = room["players"][pid]
        entry = {
            "id": pid,
            "name": p["name"],
            "avatarUrl": p.get("avatarUrl"),
            "seat": p["seat"],
            "chips": p["chips"],
            "isHost": pid == room["hostId"],
            "sittingOut": bool(p.get("sittingOut")),
            "isYou": pid == viewer_id,
            "connected": (now - p.get("lastSeen", 0)) < 15,
            "index": None,
            "inHand": False,
            "folded": False,
            "bet": 0,
            "isActor": False,
            "isButton": False,
            "isSmallBlind": False,
            "isBigBlind": False,
            "isStraddle": False,
            "cardsCount": 0,
            "cards": None,
            "timedOut": False,
            "shownIndices": [],
            "pendingShowIndices": [],
            "showedDown": False,
            "out": p["chips"] <= 0,
            # Sat out by the shot clock rather than by choice, so the UI can
            # explain what happened and offer the way back in.
            "autoSatOut": bool(p.get("autoSatOut")),
            # Said goodbye, and goes as soon as this hand is settled.
            "leaving": bool(p.get("leaving")),
            "rebuys": int(p.get("rebuys", 0)),
            "addOnTaken": bool(p.get("addOnTaken")),
            "timeBank": int(p.get("timeBank", room.get("timeBankSeconds", 0)) or 0),
            # Whether benching them would still leave a playable table. The
            # button is disabled rather than left to fail, so nobody taps "sit
            # out" heads-up and gets an error for an answer.
            "canSitOut": bool(p.get("sittingOut")) or _can_sit_out(room, p),
        }
        if pid in engine_by_pid:
            entry.update(engine_by_pid[pid])
        players_out.append(entry)

    return {
        "room": {
            "id": room["id"],
            "name": room["name"],
            "phase": room["phase"],
            "smallBlind": room["smallBlind"],
            "bigBlind": room["bigBlind"],
            "startingChips": room["startingChips"],
            "handNumber": room["handNumber"],
            "tournamentNumber": int(room.get("tournamentNumber") or 1),
            "maxSeats": MAX_SEATS,
            "actionSeconds": int(room.get("actionSeconds") or 0),
            "anteMode": room.get("anteMode", "off"),
            "ante": _ante_for(room),
            "straddle": bool(room.get("straddle")),
            "bombPotEvery": int(room.get("bombPotEvery") or 0),
            # Whether the hand on the table right now is a bomb pot.
            "bombPot": bool(room.get("bombPot")),
            "sevenDeuce": int(room.get("sevenDeuce") or 0),
            # What this table is made of. Rooms made before there was a
            # choice get the default, which is the table everybody already had.
            "baize": room.get("baize") or "emerald",
            "deck": room.get("deck") or "clasica",
            "levelMinutes": int(room.get("levelMinutes") or 0),
            "autoDealSeconds": int(room.get("autoDealSeconds") or 0),
            # The table is stopped: no deals, and the blind clock is held still.
            "paused": _is_paused(room),
            "breakEveryLevels": int(room.get("breakEveryLevels") or 0),
            "breakMinutes": int(room.get("breakMinutes") or 0),
            # No hand after this one. Shown to everybody, not just the host:
            # knowing it is the last hand changes how it is played.
            "lastHand": bool(room.get("lastHand")),
            # How far the blinds move when they move. Rooms made before there
            # was a choice climbed the standard one, which is still its name.
            "blindLadder": room.get("blindLadder") or DEFAULT_BLIND_LADDER,
            # Coming and going, and whether either door is still open.
            "allowLeaving": bool(room.get("allowLeaving", True)),
            "lateEntryOpen": _late_entry_open(room, now),
            "rebuyOpen": _rebuy_open(room, now),
            "addOn": bool(room.get("addOn")),
            "timeBankSeconds": int(room.get("timeBankSeconds") or 0),
            # The settings themselves, not just what they currently allow. The
            # lobby has to render the rules back to the host — and let them
            # change their mind — so the numbers they chose have to survive the
            # round trip, not only their effect on this instant.
            "lateEntryLevels": int(room.get("lateEntryLevels") or 0),
            "lateEntryChips": room.get("lateEntryChips") or "start",
            "rebuyLevels": int(room.get("rebuyLevels") or 0),
            "rebuysPerPlayer": int(room.get("rebuysPerPlayer") or 0),
            "rebuyChips": room.get("rebuyChips") or "start",
            "rebuyChipsFixed": int(room.get("rebuyChipsFixed") or 0),
            "runItTwice": bool(room.get("runItTwice")),
            # What an edit has to be based on to be accepted. See ``set_rules``.
            "rulesVersion": int(room.get("rulesVersion") or 0),
            # The ladders themselves, as multipliers, so the lobby can show the
            # host what each one does to *their* stakes as they type them —
            # without a second copy of these numbers living in the frontend,
            # which is the copy that would quietly stop matching. Only while
            # there is still a choice to make: after the first deal it is a
            # couple of hundred bytes on every poll of a settled question.
            **(
                {"blindLadders": {k: list(v) for k, v in BLIND_LADDERS.items()}}
                if room["phase"] == "lobby"
                else {}
            ),
        },
        # The decision on the table is being paid for out of the actor's bank.
        # Everybody sees it, because "they are into their time bank" is what
        # the table would say out loud and it is why the countdown restarted.
        "bankRunning": bool(room.get("bankRunning")),
        "players": players_out,
        "board": board,
        # Every board dealt. One entry on all but the hands that ran twice, so
        # a table can render this and forget the distinction exists.
        "boards": dealt_boards or ([board] if board else []),
        # What each board came to, once the hand is over.
        "boardResults": room.get("boardResults") or [],
        "pot": pot,
        # What the pot came to, on the hands that are over.
        #
        # `pot` is an accounting fact — chips that have left the stacks and are
        # not still on the felt — and the moment the engine pushes them to
        # whoever won, it is correctly zero. But the table has two moments left
        # to draw after that and both need this number: the last street's bets
        # being raked in, which otherwise simply stopped existing, and the pot
        # sitting in the middle until it is paid, which otherwise vanished
        # several seconds before the chips representing it crossed the felt.
        #
        # Deliberately *not* folded into `pot`. During a handover these chips
        # are already in the winner's stack, and a total that counted them
        # twice would be a total that no longer adds up — which is the one
        # thing the books have to do. See `_settle_hand`.
        "potAtEnd": int(room.get("potAtEnd") or 0),
        # The pot broken out, main first. A single number is a lie the moment
        # somebody is all in for less than the bet: the short stack is playing
        # for the main pot and everybody else for that plus a side pot they
        # cannot win, and told only the total a player cannot work out what
        # their call is chasing. Sums to ``pot`` by construction.
        "pots": [
            {
                "amount": p["amount"],
                "playerIds": [hand_ids[s] for s in p["seats"] if s < len(hand_ids)],
            }
            for p in pots
        ],
        "street": street,
        "actorId": actor_id,
        "legal": legal,
        # What everybody did, this hand, newest last. The one moment a polled
        # client cannot recover by comparing two pictures is a check — nothing
        # changes but whose turn it is — so it is written down instead of
        # inferred. ``seq`` never restarts, so a client knows what it has
        # already seen even across a deal.
        "actions": room.get("actionLog", []),
        # Per viewer, because it says what people were holding. See
        # `_results_for` — this is the same filter as `players[].cards`, and it
        # is here because it was missing.
        "lastResults": _results_for(room, viewer_id),
        "standings": room.get("standings", []),
        # Whether this hand was actually shown down. The table can't infer it
        # from the phase: a hand won by folds also ends in "handover", and
        # treating that as a showdown puts the winner's cards on screen for the
        # player next to them to read.
        "wentToShowdown": shown_down,
        # The hands that have to be turned over, in the order they are — the
        # walk `_seats_that_must_show` does, which *is* the rule.
        #
        # Sent rather than worked out again on the client, because it was being
        # worked out again on the client and getting two different answers: the
        # last aggressor of the whole hand instead of the last street, and,
        # where nobody had bet, whichever seat happened to be first in an array
        # each viewer has rotated to put themselves at the bottom — so two
        # people at the same table watched two different showdowns and each saw
        # themselves show first.
        "showOrder": [
            hand_ids[s] for s in (room.get("showSeats") or []) if s < len(hand_ids)
        ],
        # Who collected the 7-2 bonus this hand, and what it came to.
        "sevenDeuceWin": room.get("sevenDeuceWin"),
        # The bonus is there for the taking but the cards are still down.
        "sevenDeucePending": _seven_deuce_pending(room, viewer_id),
        # What *this* viewer has said they will do, and nobody else's. A table
        # that could see who has already folded in advance would be playing a
        # different game: half the information in poker is what somebody has
        # not decided yet.
        "preAction": _pre_action_for(room, viewer_id),
        # The hand is all-in and waiting on whether to deal a second board.
        # Everybody sees that it is being asked — the table is watching — but
        # only the players still in it are being asked.
        "runoutSeats": [
            hand_ids[s]
            for s in (room.get("runoutSeats") or [])
            if s < len(hand_ids)
        ],
        "runoutDeadline": room.get("runoutDeadline"),
        "level": _level_view(room, now),
        # Every clock is an absolute server timestamp; the client subtracts
        # serverTime to stay correct even when a device's clock is off.
        "actionDeadline": room.get("actionDeadline"),
        "autoDealAt": room.get("autoDealAt"),
        # When the table starts itself again, or None if it is not on a break.
        "breakUntil": room.get("breakUntil"),
        # The moment this view describes. Sent back with a decision so an order
        # about a moment that has passed can be refused rather than applied.
        "turnId": int(room.get("turnId", 0)),
        "serverTime": now,
        "you": next((p for p in players_out if p["id"] == viewer_id), None),
    }


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.exception_handler(RoomBusy)
async def _room_busy(request: fastapi.Request, exc: RoomBusy):
    """A contended room is a retry, not a failure — say so with a 503."""
    return fastapi.responses.JSONResponse(
        status_code=503,
        content={"detail": "The table is busy right now. Try that again."},
    )


@app.exception_handler(LockLost)
async def _lock_lost(request: fastapi.Request, exc: LockLost):
    """The write was refused because the lease lapsed. Nothing was changed."""
    return fastapi.responses.JSONResponse(
        status_code=503,
        content={"detail": "That took too long to reach the table. Try again."},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/rooms/{room_id}/preview")
async def room_preview(room_id: str) -> dict[str, Any]:
    """The small public face of an invitation link.

    Link unfurlers cannot type the room password or hold a player's token, but
    a useful invitation still needs to say which table the link opens. Keep
    this projection deliberately separate from ``_build_view``: no player
    names, credentials, cards, house rules or scheduled work belong in a chat
    preview. Anyone with the room code can read exactly these table facts and
    nothing else.
    """
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")

    return {
        "roomId": room["id"],
        "name": room["name"],
        "phase": room["phase"],
        "playerCount": len(room.get("order") or []),
        "maxSeats": MAX_SEATS,
        "smallBlind": int(room["smallBlind"]),
        "bigBlind": int(room["bigBlind"]),
        "handNumber": int(room.get("handNumber", 0)),
    }


def _check_rules(rules: TableRules) -> None:
    """The two things a valid ruleset cannot be, whoever is setting it."""
    if rules.bigBlind <= rules.smallBlind:
        raise fastapi.HTTPException(400, "Big blind must be larger than small blind.")
    if rules.startingChips < rules.bigBlind * 2:
        raise fastapi.HTTPException(
            400, "Starting chips should be at least twice the big blind."
        )


def _restack(room: dict[str, Any], starting_chips: int) -> None:
    """Set the opening stack and put it in front of everybody waiting.

    Only ever called in the lobby, where every seat holds exactly one opening
    stack and nothing has been bet. Rewriting the stacks *and* the issue count
    in the same place is what keeps ``_chips_balance`` true — a table whose
    books stop adding up is the one failure this ledger exists to catch.
    """
    room["startingChips"] = starting_chips
    for pid in room["order"]:
        room["players"][pid]["chips"] = starting_chips
    room["chipsIssued"] = starting_chips * len(room["order"])
    room["chipsWithdrawn"] = 0


def _apply_rules(room: dict[str, Any], rules: TableRules) -> None:
    """Write the host's decisions onto a table that has not dealt a card yet.

    One function for both the moment the table is made and the moment the host
    changes their mind in the lobby, so the two cannot answer differently.
    """
    room["name"] = rules.name
    room["smallBlind"] = rules.smallBlind
    room["bigBlind"] = rules.bigBlind
    room["blindLadder"] = rules.blindLadder
    room["blindSchedule"] = build_blind_schedule(
        rules.smallBlind, rules.bigBlind, rules.blindLadder
    )
    room["levelMinutes"] = rules.levelMinutes
    room["actionSeconds"] = rules.actionSeconds
    room["anteMode"] = rules.anteMode
    room["straddle"] = rules.straddle
    room["bombPotEvery"] = rules.bombPotEvery
    room["sevenDeuce"] = rules.sevenDeuce
    room["baize"] = rules.baize
    room["deck"] = rules.deck
    room["breakEveryLevels"] = rules.breakEveryLevels
    room["breakMinutes"] = rules.breakMinutes
    room["lateEntryLevels"] = rules.lateEntryLevels
    room["lateEntryChips"] = rules.lateEntryChips
    room["allowLeaving"] = rules.allowLeaving
    room["rebuyLevels"] = rules.rebuyLevels
    room["rebuysPerPlayer"] = rules.rebuysPerPlayer
    room["rebuyChips"] = rules.rebuyChips
    room["rebuyChipsFixed"] = rules.rebuyChipsFixed
    room["addOn"] = rules.addOn
    room["timeBankSeconds"] = rules.timeBankSeconds
    room["runItTwice"] = rules.runItTwice
    _restack(room, rules.startingChips)
    # Bumped last, so anything holding an older number knows it is holding a
    # ruleset that no longer describes this table. See ``set_rules``.
    room["rulesVersion"] = int(room.get("rulesVersion") or 0) + 1


@app.post("/rooms")
async def create_room(body: CreateRoomBody) -> dict[str, Any]:
    _check_rules(body)

    room_id = _new_id()
    host_id = secrets.token_urlsafe(12)
    host_token = _new_token()
    recovery_code = secrets.token_urlsafe(12)
    now = time.time()
    room = {
        "id": room_id,
        "hostId": host_id,
        "passwordHash": _hash_password(body.password),
        # A second device can recover host authority only with this one-time
        # backup secret. The shared room password is deliberately insufficient.
        "hostRecoveryHash": _hash_password(recovery_code),
        "phase": "lobby",
        "handNumber": 0,
        "tournamentNumber": 1,
        "order": [host_id],
        "players": {
            host_id: {
                "id": host_id,
                "name": body.hostName,
                "avatarUrl": body.hostAvatarUrl,
                "seat": 0,
                # Filled by `_apply_rules` below, along with the books.
                "chips": 0,
                "token": host_token,
                "sittingOut": False,
                "lastSeen": now,
            }
        },
        "handPlayerIds": [],
        "handStartStacks": [],
        "stateB64": None,
        "lastResults": [],
        "createdAt": now,
        # Every rule below is written by `_apply_rules` at the end, which is
        # also what the lobby calls when the host changes their mind. What is
        # left here is the machinery those rules drive.
        "levelIndex": 0,
        # Stays None until the first hand is dealt, so waiting in the lobby
        # never burns a blind level.
        "levelStartedAt": None,
        "actionDeadline": None,
        "autoDealSeconds": AUTO_DEAL_SECONDS,
        "autoDealAt": None,
        # The table is stopped: no deals, and the blind clock is held still.
        "paused": False,
        "autoDealPaused": False,
        "pausedAt": None,
        "breakUntil": None,
        "breaksTaken": 0,
        # The host has called it: no hand after the one being played.
        "lastHand": False,
        "lastHandNumber": None,
        # When the offer of a second board expires and the hand runs once.
        "runoutDeadline": None,
        # Whether the decision on the table is being paid for out of the
        # actor's bank rather than the shot clock. See ``_open_the_time_bank``.
        "bankRunning": False,
        # Every chip ever put on this table, and every chip taken off it. What
        # replaces "starting stack times players" once people can arrive, leave
        # and buy back in — see ``_chips_balance``. Opened by `_apply_rules`.
        "chipsIssued": 0,
        "chipsWithdrawn": 0,
        # Set when the tournament would be over but somebody can still buy back
        # in. See ``_scheduled_close``.
        "closeAt": None,
        "bustOrder": [],
        "standings": [],
        # Seat holding the button. Advances one seat per hand; see _next_button.
        "buttonId": None,
        # Handed to anyone who gives the password, seated or not, so that
        # reading the table needs the same key as sitting at it.
        "watchToken": _new_token(),
    }
    _apply_rules(room, body)
    await save_room(room)
    # A room code is meant to name one private room for its whole lifetime.
    # `_new_id` collisions are rare, but carrying a separate old chat into a
    # newly created room would turn that rarity into a conversation leak. The
    # new capability is not returned until its chat namespace is empty.
    await redis.delete(_chat_key(room_id))
    return {
        "roomId": room_id,
        "playerId": host_id,
        "token": host_token,
        "isHost": True,
        "recoveryCode": recovery_code,
    }


@app.post("/rooms/{room_id}/rules")
async def set_rules(
    room_id: str,
    body: SetRulesBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Change what kind of night this is, before it starts.

    Only in the lobby, and that is not a limitation being apologised for — it
    is the product decision. House rules are agreed before the cards come out;
    a host who can move the blinds up in the middle of a tournament is a host
    who can move them up on the hand they are losing, and a table of friends
    should never have to wonder about that.

    In the lobby nothing has been bet and every seat holds one opening stack,
    so re-stacking everybody is arithmetic rather than surgery. After the first
    deal it would be neither.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can set the rules.")
        if room["phase"] != "lobby":
            raise fastapi.HTTPException(
                400, "The rules are set before the first hand, not during."
            )
        # A whole ruleset arrives every time, so the last writer wins by
        # definition — and losing here is not "my change did not apply", it is
        # "my change reverted somebody else's without telling either of us".
        if (
            body.basedOn is not None
            and body.basedOn != int(room.get("rulesVersion") or 0)
        ):
            raise fastapi.HTTPException(
                409, "The rules changed while you were editing them. Reopen and try again."
            )
        _check_rules(body)
        _apply_rules(room, body)
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/join")
async def join_room(
    room_id: str,
    body: JoinBody,
    request: fastapi.Request,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Take a seat.

    Four ways this can be called and only one of them creates anything:

      * a device that already holds a credential for this table is somebody
        coming back, and gets the seat it already has;
      * a device holding a credential the host has shown the door is turned
        away, because otherwise being removed lasts until you press join;
      * a request whose name the room has already answered is a retry after a
        lost response, and gets the same answer again;
      * anything else is a new player, and gets a chair.

    Without the first and third, a response lost on the way home costs the
    retry a second seat — and the first seat is unrecoverable, because the only
    proof it belonged to anybody went missing with the response.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        # Before the password check, because a room with no credentials cannot
        # seat anybody usefully: they would be handed a key that every read
        # rejects a moment later. Fail here, in one shape, like every other
        # door into a legacy room.
        _reject_legacy(room)

        returning = _player_by_token(room, x_player_token)
        if returning and _has_seat(room["players"][returning]):
            return {
                "roomId": room_id,
                "playerId": returning,
                "token": room["players"][returning]["token"],
                "isHost": returning == room["hostId"],
            }
        # Removed by the host, and the credential is what says so. The password
        # is not a second opinion: everyone at the table has it, including the
        # person who was just asked to leave, so letting a known device back in
        # on it makes removing anybody a formality that lasts until they press
        # join again.
        #
        # This is as far as it goes, and that is worth being clear about. The
        # same person on a device the room has never seen is a new player who
        # knows the password, and nothing here can tell them from a friend who
        # has just been sent the link; the same is true of watching, which asks
        # for the password and nothing else. Shutting those doors takes a new
        # password, which is what a table of friends would reach for anyway.
        _reject_the_removed(room, x_player_token)

        await _check_auth_limit(request, room_id)
        if not _verify_password(body.password, room["passwordHash"]):
            await _record_auth_failure(request, room_id)
            raise fastapi.HTTPException(403, "Incorrect room password.")
        await _clear_auth_failures(request, room_id)

        seen = _receipt(room, body.requestId, _JOINS)
        if seen:
            return {
                "roomId": room_id,
                "playerId": seen["playerId"],
                "token": seen["token"],
                "isHost": False,
            }

        now = time.time()
        if room["phase"] != "lobby" and not _late_entry_open(room, now):
            raise fastapi.HTTPException(
                400,
                "This tournament is past the point where anyone can join. Ask the "
                "host for a new table, or watch this one.",
            )
        if len(room["order"]) >= MAX_SEATS:
            raise fastapi.HTTPException(400, "This room is full.")

        player_id = secrets.token_urlsafe(12)
        token = _new_token()
        seat = _free_seat(room)
        stack = room["startingChips"] if room["phase"] == "lobby" else _entry_stack(room)
        room["players"][player_id] = {
            "id": player_id,
            "name": body.name,
            "avatarUrl": body.avatarUrl,
            "seat": seat,
            "chips": 0,
            "token": token,
            "sittingOut": False,
            "lastSeen": now,
        }
        _issue_chips(room, player_id, stack)
        # Into the rotation where they are sitting, not at the end of the queue:
        # ``order`` is what the button walks round.
        _seat_in_order(room, player_id)
        # A latecomer cannot be dealt into a hand already in progress —
        # ``_eligible_player_ids`` is read at the deal — so nothing else is
        # needed to keep them out of it. But a table that had run dry and was
        # sitting on its hands now has somebody to play with again.
        if room["phase"] == "handover" and not room.get("autoDealAt"):
            if len(_eligible_player_ids(room)) >= 2:
                _arm_auto_deal(room)
        _keep_receipt(
            room,
            body.requestId,
            {"playerId": player_id, "token": token},
            _JOINS,
            MAX_JOIN_RECEIPTS,
        )
        await save_room(room)
    return {
        "roomId": room_id,
        "playerId": player_id,
        "token": token,
        "isHost": False,
    }


class KickBody(BaseModel):
    playerId: str        # the host asking
    targetId: str        # the player being shown the door


@app.post("/rooms/{room_id}/kick")
async def kick_player(
    room_id: str,
    body: KickBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Remove somebody from the table, at the host's word.

    Only between hands. Pulling a seat out from under a live hand means
    rewriting a pot that is already half-played, and there is no version of
    that which is not worse than waiting twenty seconds.

    Their chips leave with them, and they are recorded where they stood, so the
    final standings still have them in the place they reached rather than
    quietly forgetting they were ever here.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can remove a player.")
        if body.targetId == room["hostId"]:
            raise fastapi.HTTPException(400, "The host cannot remove themselves.")
        if body.targetId not in room["players"]:
            raise fastapi.HTTPException(404, "That player is not at this table.")
        if room["phase"] == "hand":
            raise fastapi.HTTPException(
                400, "Wait for the hand to finish before removing anyone."
            )
        if room["phase"] == "finished":
            # The placings are already written. Removing somebody now would
            # recompute them with a zeroed stack and rewrite the podium — the
            # winner of the night quietly demoted after the fact.
            raise fastapi.HTTPException(400, "This tournament is already over.")

        if room["phase"] == "lobby":
            # Nobody has played a hand, so there is nothing to place them in:
            # they are kept out of ``order`` and out of the bust list, and the
            # standings never hear of them. The record itself stays, marked, so
            # that the door they were shown stays shut behind them.
            target = room["players"][body.targetId]
            room["chipsWithdrawn"] = int(room.get("chipsWithdrawn", 0)) + int(
                target["chips"]
            )
            target["chips"] = 0
            target["removed"] = True
            target["kicked"] = True
            room["order"] = [pid for pid in room["order"] if pid != body.targetId]
        else:
            # The same door somebody uses to leave of their own accord: the
            # record stays for the podium, the seat and the chips go, and the
            # button steps back rather than being cleared.
            _remove_from_table(room, body.targetId, withdraw=True, kicked=True)

        if room["phase"] != "lobby" and len(_eligible_player_ids(room)) < 2:
            _finish_tournament(room)
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/leave")
async def leave_table(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Go home, taking your chips with you.

    Between friends this is what leaving means: the stack goes with the person,
    rather than sitting there as a ghost paying blinds all night — which is
    what the online rooms do, and which at a table of four is unmissable.

    Called during a hand, it is a goodbye rather than a disappearance: the seat
    stays until the pot is settled, because pulling it out from under a hand
    that is half played rewrites a pot everybody else is still in. Their
    remaining decisions are played out at once (checking when it is free,
    folding when it is not) so nobody is kept waiting on somebody who has gone.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        if not room.get("allowLeaving", True):
            raise fastapi.HTTPException(
                400, "The host set this table up to be played to the end."
            )
        if room["phase"] == "finished":
            raise fastapi.HTTPException(400, "This tournament is already over.")

        player = room["players"][body.playerId]
        in_the_hand = (
            room["phase"] == "hand" and body.playerId in (room.get("handPlayerIds") or [])
        )
        if room["phase"] == "lobby":
            # Nobody has played a hand, so there is nothing to place them in.
            room["chipsWithdrawn"] = int(room.get("chipsWithdrawn", 0)) + int(
                player["chips"]
            )
            room["order"] = [pid for pid in room["order"] if pid != body.playerId]
            room["players"].pop(body.playerId, None)
            _pass_the_host_role(room)
        elif in_the_hand:
            player["leaving"] = True
        else:
            _remove_from_table(room, body.playerId, withdraw=True)
            if len(_eligible_player_ids(room)) < 2:
                _finish_tournament(room)
        _keep_receipt(room, body.requestId, {})
        await save_room(room)
        # Built for the leaver, however little is left of their seat. A view is
        # somebody's view of the table — it carries whoever it is built for
        # their own hole cards — so handing this one to the host would deal the
        # person walking out of the door the host's hand on the way past.
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/rebuy")
async def rebuy(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Buy back in after busting, or take the one add-on.

    ``action`` is ``rebuy`` (only with an empty stack) or ``add-on`` (only with
    chips still in front of you). Both are bounded by the window the host set,
    and both are counted, because "how many can I have" is the first question
    anybody asks and an answer of "as many as you like" is not a tournament.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        now = time.time()
        if not _rebuy_open(room, now):
            raise fastapi.HTTPException(
                400, "The rebuy window has closed." if room.get("rebuyLevels")
                else "This table has no rebuys."
            )
        player = room["players"][body.playerId]
        if room["phase"] == "hand" and body.playerId in (
            room.get("handPlayerIds") or []
        ):
            # Chips bought while you are in a hand would vanish at the end of
            # it: the engine holds the live stacks and the settlement writes
            # them back over whatever is here. Which is also the honest rule —
            # nobody tops up in the middle of a pot.
            raise fastapi.HTTPException(
                400, "Wait for the hand to finish before buying chips."
            )

        if body.action == "add-on":
            if not room.get("addOn"):
                raise fastapi.HTTPException(400, "This table has no add-on.")
            if player.get("addOnTaken"):
                raise fastapi.HTTPException(400, "You have already taken the add-on.")
            if player["chips"] <= 0:
                raise fastapi.HTTPException(
                    400, "You are out of chips — buy back in rather than adding on."
                )
            player["addOnTaken"] = True
        elif body.action == "rebuy":
            if player["chips"] > 0:
                raise fastapi.HTTPException(
                    400, "You still have chips. There is nothing to buy back into."
                )
            if not _rebuys_left(room, player):
                raise fastapi.HTTPException(400, "You have used all your rebuys.")
            player["rebuys"] = int(player.get("rebuys", 0)) + 1
            # Out of the bust list: they are not out any more, and that list is
            # what the final placings are read from.
            room["bustOrder"] = [
                pid for pid in room.get("bustOrder", []) if pid != body.playerId
            ]
        else:
            raise fastapi.HTTPException(400, f"Unknown purchase: {body.action}")

        # The add-on is a top-up on a stack that is still alive, so it is the
        # opening stack by definition; only a rebuy is buying back in, and only
        # a rebuy asks what a fresh stack is worth at this level.
        _issue_chips(
            room,
            body.playerId,
            int(room["startingChips"]) if body.action == "add-on" else _rebuy_stack(room),
        )
        # A table that had given up waiting has a game again.
        room["closeAt"] = None
        if room["phase"] == "handover" and len(_eligible_player_ids(room)) >= 2:
            _arm_auto_deal(room)
        _keep_receipt(room, body.requestId, {})
        await save_room(room)
        return _build_view(room, body.playerId)


class WatchBody(BaseModel):
    password: str = Field(min_length=1, max_length=64)


@app.post("/rooms/{room_id}/watch")
async def watch_room(
    room_id: str, body: WatchBody, request: fastapi.Request
) -> dict[str, Any]:
    """Pull up a chair without taking a seat.

    A spectator is simply an id that belongs to nobody at the table. That is
    the whole implementation, and it is safe by construction: ``_build_view``
    only ever reveals a hand to the player holding it or at a showdown, so an
    id matching no seat sees exactly what someone standing behind the table
    sees. They are not written into the room either, which keeps them out of
    the seat count, the deal, and the standings.
    """
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")
    _reject_legacy(room)
    # Still a private table. Watching is not a way around the password.
    await _check_auth_limit(request, room_id)
    if not _verify_password(body.password, room["passwordHash"]):
        await _record_auth_failure(request, room_id)
        raise fastapi.HTTPException(403, "Incorrect room password.")
    await _clear_auth_failures(request, room_id)
    return {
        "roomId": room_id,
        "playerId": f"watch-{secrets.token_urlsafe(9)}",
        "token": room["watchToken"],
        "isHost": False,
        "spectator": True,
    }


@app.get("/rooms/{room_id}/chat")
async def get_chat(
    room_id: str,
    response: fastapi.Response,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Read the room's bounded table talk with the same capability as state."""
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")
    _require_access(room, x_player_token)
    chat = await load_chat(room_id)
    # The body is private and viewer-relative (`isMine`). Do not let a browser,
    # edge, or future proxy reuse one capability's snapshot for another.
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = PLAYER_TOKEN_HEADER
    return _chat_view(room, chat, x_player_token)


@app.post("/rooms/{room_id}/chat")
async def send_chat(
    room_id: str,
    body: ChatSendBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Append table talk as the seat proven by the capability header.

    The room lease makes author authentication linearizable with leaving,
    removal, and host recovery, and prevents concurrent JSON appends from
    overwriting one another. PokerKit is never loaded or rewritten here.
    """
    text = _normalise_chat_text(body.text)
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _require_access(room, x_player_token)
        author_id = _player_by_token(room, x_player_token)
        if not author_id or not _has_seat(room["players"].get(author_id)):
            raise fastapi.HTTPException(
                403, "Only seated players can send messages to this table."
            )

        chat = await load_chat(room_id)
        messages = chat.setdefault("messages", [])
        if not isinstance(messages, list):
            messages = []
            chat["messages"] = messages

        # A response can disappear after Redis commits. Repeating the same
        # request returns the original server id and timestamp instead of
        # saying the same thing twice.
        accepted = next(
            (
                message
                for message in reversed(messages)
                if isinstance(message, dict)
                and message.get("authorId") == author_id
                and message.get("requestId") == body.requestId
            ),
            None,
        )
        if accepted is not None:
            await save_chat(room_id, chat)  # also realigns both 24-hour TTLs
            return _chat_view(room, chat, x_player_token)

        now = time.time()
        retry_after = _chat_retry_after(chat, author_id, now)
        if retry_after is not None:
            raise fastapi.HTTPException(
                429,
                "You're sending messages too quickly. Wait a moment and try again.",
                headers={"Retry-After": str(retry_after)},
            )

        message = {
            "id": secrets.token_urlsafe(12),
            "authorId": author_id,
            "authorName": room["players"][author_id]["name"],
            "text": text,
            "createdAt": int(now * 1000),
            "requestId": body.requestId,
        }
        messages.append(message)
        chat["messages"] = messages[-CHAT_MAX_MESSAGES:]
        chat.setdefault("rate", {}).setdefault(author_id, []).append(now)
        await save_chat(room_id, chat)
        return _chat_view(room, chat, x_player_token)


@app.post("/rooms/{room_id}/host/recover")
async def recover_host(
    room_id: str, body: RecoverHostBody, request: fastapi.Request
) -> dict[str, Any]:
    """Move host authority to a replacement device using a one-time backup.

    Recovery rotates both the player credential and the backup code. A lost
    phone therefore stops authorising the host seat as soon as recovery works,
    and a copied backup cannot be replayed later.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _reject_legacy(room)
        await _check_auth_limit(request, room_id)

        recovery_hash = room.get("hostRecoveryHash")
        valid = bool(recovery_hash) and _verify_password(
            body.recoveryCode, recovery_hash
        )
        valid = valid and _verify_password(body.password, room["passwordHash"])
        if not valid:
            await _record_auth_failure(request, room_id)
            raise fastapi.HTTPException(
                403, "The password or host backup code is incorrect."
            )

        host_id = room.get("hostId")
        host = room["players"].get(host_id or "")
        if not _has_seat(host):
            raise fastapi.HTTPException(409, "This table no longer has that host seat.")

        await _clear_auth_failures(request, room_id)
        token = _new_token()
        next_recovery_code = secrets.token_urlsafe(12)
        host["token"] = token
        room["hostRecoveryHash"] = _hash_password(next_recovery_code)
        await save_room(room)
        return {
            "roomId": room_id,
            "playerId": host_id,
            "token": token,
            "isHost": True,
            "recoveryCode": next_recovery_code,
        }


@app.post("/rooms/{room_id}/host/backup")
async def create_host_backup(
    room_id: str,
    body: HostAuthorityBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Issue a fresh one-time host backup to the authenticated host device."""
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can create a backup code.")
        recovery_code = secrets.token_urlsafe(12)
        room["hostRecoveryHash"] = _hash_password(recovery_code)
        await save_room(room)
        return {
            "roomId": room_id,
            "playerId": body.playerId,
            "token": room["players"][body.playerId]["token"],
            "isHost": True,
            "recoveryCode": recovery_code,
        }


@app.post("/rooms/{room_id}/host/transfer")
async def transfer_host(
    room_id: str,
    body: HostAuthorityBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Hand the table to another seated player without creating an account."""
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can transfer the table.")
        if room["phase"] == "finished":
            raise fastapi.HTTPException(400, "This tournament is already over.")
        target = room["players"].get(body.targetId or "")
        if not _has_seat(target) or body.targetId == body.playerId:
            raise fastapi.HTTPException(400, "Choose another seated player.")
        room["hostId"] = body.targetId
        # The previous host's backup cannot reclaim a table they deliberately
        # handed over. The new host can create a fresh backup from their device.
        room["hostRecoveryHash"] = None
        await save_room(room)
        return _build_view(room, body.playerId)


class ShowBody(BaseModel):
    # Which of your two cards to turn over: [0], [1] or both.
    #
    # Empty is only meaningful mid-hand, where this is still a plan and taking
    # it back is a legal move. Once the hand is over the cards are on the table
    # and there is nothing to send an empty list about.
    playerId: str
    indices: list[int] = Field(max_length=2)
    # Which hand you meant to show. Same reasoning as on /action: a request
    # delayed in the network is an intention about the hand it was made for,
    # and applying it to whatever is on the table when it lands turns "show my
    # bluff" into "turn over the hand I am about to play".
    handNumber: int | None = None


@app.post("/rooms/{room_id}/show")
async def show_cards(
    room_id: str,
    body: ShowBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Turn your own cards face up, or say that you are going to.

    Half of what makes a home game a home game: the bluff nobody would believe
    unless you prove it, and the single card shown to keep them guessing. Only
    your own hand, only the one just played, and only until the next deal.

    Two phases, and which one this is depends entirely on when it arrives:

    * **During the hand**, and only from a player who has folded, it is a
      *plan*. The decision to show is made the moment you throw the hand away
      and it has gone cold by the time the pot is pushed — but the cards
      themselves cannot appear while there is still betting to come, because a
      card face up then is a card the live players get to use. Reversible right
      up to the end: an empty list takes it back, and a new one replaces it.
      Nobody but you can see it (`pendingShowSeats`).
    * **After the hand**, it is the thing itself, and there is no way back.
      Once a card is public the table has seen it, so the client asks before
      sending rather than offering an undo that cannot exist. An empty list
      here is refused rather than treated as "show nothing".
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.handNumber is None:
            raise fastapi.HTTPException(
                400, "This did not say which hand it was for. Reload the table."
            )
        if body.handNumber != room["handNumber"]:
            raise fastapi.HTTPException(409, "That hand is already over.")
        if room["phase"] not in ("hand", "handover"):
            raise fastapi.HTTPException(400, "There is no hand to show right now.")
        hand_ids = room.get("handPlayerIds") or []
        if body.playerId not in hand_ids:
            raise fastapi.HTTPException(403, "You were not in that hand.")
        if body.playerId not in room["order"]:
            # Removed from the table since the hand ended. Their seat is gone,
            # so there is nothing to show it to and no stack to pay a bonus
            # into — collecting one would move chips to somebody who has left.
            raise fastapi.HTTPException(403, "You are no longer at this table.")
        seat = hand_ids.index(body.playerId)
        held = len((room.get("handHoleCards") or [[]])[seat])
        if any(i < 0 or i >= held for i in body.indices):
            raise fastapi.HTTPException(400, "You do not have that card.")
        if room["phase"] == "hand":
            # Mid-hand. Only somebody who has folded can decide this — a player
            # with a live hand showing a card is passing information to the
            # players still deciding what to do about it — and the decision is
            # recorded rather than acted on: the cards go face up when the hand
            # settles, along with everybody else's.
            #
            # Replaced rather than added to, and an empty list is allowed:
            # until the cards are actually turned over this is a plan, and a
            # plan you cannot change is a plan nobody will risk making.
            if seat not in set(room.get("foldedSeats", [])):
                raise fastapi.HTTPException(400, "You are still in this hand.")
            room.setdefault("pendingShowSeats", {})[str(seat)] = sorted(set(body.indices))
            await save_room(room)
            return _build_view(room, body.playerId)
        if not body.indices:
            raise fastapi.HTTPException(400, "Say which cards to show.")
        shown = room.setdefault("shownSeats", {})
        # Adding rather than replacing: showing one card and then the other is
        # a normal thing to do, and the first one is already public.
        shown[str(seat)] = sorted(set(shown.get(str(seat), [])) | set(body.indices))
        # Turning over a 7-2 on a pot won by folding is how that bonus gets
        # claimed, so the same settlement runs again — it is idempotent.
        _pay_seven_deuce(room)
        _record_busts(room)
        if len(_eligible_player_ids(room)) < 2:
            _finish_tournament(room)
        await save_room(room)
        return _build_view(room, body.playerId)


@app.get("/rooms/{room_id}/rabbit")
async def rabbit_hunt(
    room_id: str,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """The board that would have come, once the hand is safely over.

    Pure curiosity — knowing the river you folded away changes nothing and is
    the most-requested thing in a home game. It is also the one route in this
    file that must never run a moment early: the deck it reads from is the
    unplayed future, so serving it while anyone can still act would hand a
    player the turn card before they bet on it. Hence the phase gate, and hence
    it reads without taking the lock or writing anything back.
    """
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")
    _require_access(room, x_player_token)
    if room["phase"] not in ("handover", "finished") or not room.get("stateB64"):
        raise fastapi.HTTPException(400, "Wait for the hand to finish.")
    state = poker.loads(room["stateB64"])
    if not poker.is_hand_over(state):
        raise fastapi.HTTPException(400, "Wait for the hand to finish.")
    return {"handNumber": room["handNumber"], "streets": poker.would_have_come(state)}


@app.get("/rooms/{room_id}/state")
async def get_state(
    room_id: str,
    playerId: str | None = None,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """The table as this caller is allowed to see it.

    Naming a seat is not the same as sitting in one. Every id at the table is
    public — clients need them to say whose seat is whose — so asking for a
    player's view has to be backed by that player's secret. Without it the
    caller is treated as an onlooker and sees exactly what an onlooker sees:
    the felt, the chips, and nobody's cards.
    """
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")
    _require_access(room, x_player_token)

    now = time.time()
    if not _is_player(room, playerId, x_player_token):
        playerId = None
    player = room["players"].get(playerId) if playerId else None
    # Heartbeat so other players can see who is connected. Throttled because
    # every seated client polls this route continuously.
    stale_heartbeat = bool(
        player and now - player.get("lastSeen", 0) >= HEARTBEAT_MIN_INTERVAL
    )

    # The only two reasons to take the lock on a read: this player's presence
    # needs writing down, or the room owes the clock something. The second one
    # is asked of the schedule rather than restated here — see ``_SCHEDULE``,
    # and the failure mode of keeping two copies of the same conditions.
    if stale_heartbeat or _work_due(room, now):
        try:
            await _tick_under_lock(room_id, playerId)
        except RoomBusy:
            # Somebody else is already updating this room; show what we read and
            # pick the change up on the next poll a moment from now.
            return _build_view(room, playerId)
        room = await load_room(room_id) or room
    return _build_view(room, playerId)


async def _tick_under_lock(room_id: str, playerId: str | None) -> None:
    """Advance the clocks and record the heartbeat, holding the room lock."""
    async with _RoomLock(room_id):
        # Re-read inside the lock: another request may have acted already.
        room = await load_room(room_id)
        if not room:
            return
        changed = _tick(room)
        if playerId and playerId in room["players"]:
            last_seen = room["players"][playerId].get("lastSeen", 0)
            if time.time() - last_seen >= HEARTBEAT_MIN_INTERVAL:
                room["players"][playerId]["lastSeen"] = time.time()
                changed = True
        if changed:
            await save_room(room)


@app.post("/rooms/{room_id}/start")
async def start_hand(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can start a hand.")
        if room["phase"] == "hand":
            raise fastapi.HTTPException(400, "A hand is already in progress.")
        if room["phase"] == "finished":
            raise fastapi.HTTPException(400, "This tournament is over.")
        if _no_more_hands(room):
            # The last hand has been played. Dealing another would quietly
            # unsay what the whole table was told.
            _finish_tournament(room, by_chips=True)
            await save_room(room)
            raise fastapi.HTTPException(400, "That was the last hand.")
        if room.get("breakUntil") and time.time() < room["breakUntil"]:
            raise fastapi.HTTPException(400, "The table is on a break.")
        try:
            _start_hand(room)
        except fastapi.HTTPException:
            # _start_hand may have closed the tournament before refusing.
            await save_room(room)
            raise
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/again")
async def play_again(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Another one, same table, same people, same rules.

    The end of a tournament is not the end of an evening. See `_rack_up`.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can start another.")
        # Asked before the phase is, and that order is the point: a retry of
        # this arrives at a room that is already a lobby, so checking the phase
        # first would answer the second tap with "this tournament is still
        # going" — about a tournament that the first tap ended.
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        if room["phase"] != "finished":
            raise fastapi.HTTPException(400, "This tournament is still going.")
        # `_rack_up` clears the receipts — they are named by hand number and
        # the hand numbers start again — so this one is written after it.
        _rack_up(room)
        _keep_receipt(room, body.requestId, {"ok": True})
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/action")
async def take_action(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    # An action belongs to the hand it was decided in, and an action that does
    # not name its hand cannot be shown to belong to the one in progress. It is
    # rejected before anything is read or written, so a client on an old bundle
    # gets a clear error instead of playing somebody else's cards.
    if body.handNumber is None or body.turnId is None:
        raise fastapi.HTTPException(
            400,
            "This action did not say which hand it was for. Reload the table and "
            "try again.",
        )
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        # A retry of something already done is answered, not done again.
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        # Settle any expired shot clock first, so a late action can't jump the
        # queue ahead of the fold it already earned.
        timeout = _apply_timeouts(room)
        if timeout:
            await save_room(room)
        # Deliberately *not* dealing the next hand here. Doing so would let a
        # late-arriving action deal a fresh hand and then play it, applying a
        # decision made for the previous one. Polling deals it a moment later.
        if room["phase"] != "hand" or not room.get("stateB64"):
            raise fastapi.HTTPException(400, "There is no hand in progress.")

        # Without this, a retried or delayed request can land after the next
        # deal and act on cards the player has never seen.
        if body.handNumber != room["handNumber"]:
            raise fastapi.HTTPException(409, "That hand is already over.")

        hand_ids = room["handPlayerIds"]
        if body.playerId not in hand_ids:
            raise fastapi.HTTPException(403, "You are not seated in this hand.")

        state = poker.loads(room["stateB64"])
        viewer_index = hand_ids.index(body.playerId)
        if state.actor_index != viewer_index:
            if timeout and timeout.get("seat") == viewer_index:
                raise fastapi.HTTPException(
                    409, "Your time ran out — the clock played that hand for you."
                )
            raise fastapi.HTTPException(409, "It is not your turn.")

        # It is their turn — but is it the *same* turn they decided on? A raise
        # can bring the action back round to a player who has already acted,
        # and at that point a duplicate of their earlier request is legal all
        # over again. Checked here rather than higher up so that a decision
        # sent after the shot clock already played it still gets told so,
        # instead of this more general answer. See ``_save_state``.
        if body.turnId != int(room.get("turnId", 0)):
            raise fastapi.HTTPException(
                409, "The action moved on while that was on its way."
            )

        # Whatever this decision took out of their bank, before it changes the
        # deadline the answer is read from.
        _charge_the_time_bank(room, body.playerId, time.time())

        before = _action_mark(state)
        try:
            poker.apply_action(state, body.action, body.amount)
        except poker.ActionError as exc:
            raise fastapi.HTTPException(400, str(exc))
        _record_action(room, before, state)

        if body.action == "fold":
            folded = room.setdefault("foldedSeats", [])
            if viewer_index not in folded:
                folded.append(viewer_index)

        # Acting proves they are still at the table, so it also undoes a
        # bench the clock imposed. A sit-out they chose themselves stands.
        actor_player = room["players"][body.playerId]
        actor_player["missedTurns"] = 0
        if actor_player.get("autoSatOut"):
            actor_player["autoSatOut"] = False
            actor_player["sittingOut"] = False

        _save_state(room, state)
        if poker.is_hand_over(state):
            _settle_hand(room, state)  # state kept for the showdown reveal
        else:
            _set_action_deadline(room, state, time.time())
        _keep_receipt(room, body.requestId, {})
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/runout")
async def choose_runout(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Say whether you want the rest of the board dealt once or twice.

    Offered only when the chips are already in and there is board to come, and
    only to the players still in the hand. Everybody has to agree — one refusal
    and it runs once, which is also what an unanswered offer comes to, which is
    what lets the clock answer for somebody who has walked off.

    ``action`` is ``once`` or ``twice``.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        if body.action not in ("once", "twice"):
            raise fastapi.HTTPException(400, "Say once or twice.")
        if room["phase"] != "hand" or not room.get("stateB64"):
            raise fastapi.HTTPException(400, "There is no hand to deal.")
        if body.handNumber != room["handNumber"]:
            raise fastapi.HTTPException(409, "That hand is already over.")

        state = poker.loads(room["stateB64"])
        hand_ids = room.get("handPlayerIds") or []
        waiting = poker.runout_choosers(state)
        seat = hand_ids.index(body.playerId) if body.playerId in hand_ids else -1
        if seat not in waiting:
            raise fastapi.HTTPException(409, "Nobody is asking you that.")

        poker.choose_runout(state, 2 if body.action == "twice" else 1)
        _settle_runout(room, state)
        _keep_receipt(room, body.requestId, {})
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/preaction")
async def set_pre_action(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Say now what you want to do when it is your turn.

    ``action`` is ``check``, ``check-fold``, ``call-any``, or ``clear`` to take
    it back. Only for the hand being played, only while it is not already your
    turn, and only ever until it fires once.

    Read the note above ``PRE_ACTIONS`` for why no option here names an amount.

    No receipt: this writes down where the player wants to end up, so sending
    it twice asks for the same thing and the second one is harmless. A receipt
    would make it *worse* — a plan that has already fired, or been taken back,
    and is then set again on a later street of the same hand is the same
    request by name, and would be answered with a 200 that plans nothing.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        player = room["players"][body.playerId]

        if body.action == "clear":
            player.pop("preAction", None)
            await save_room(room)
            return _build_view(room, body.playerId)

        if body.action not in PRE_ACTIONS:
            raise fastapi.HTTPException(400, f"Unknown pre-action: {body.action}")
        if room["phase"] != "hand":
            raise fastapi.HTTPException(400, "There is no hand to plan for.")
        if body.playerId not in (room.get("handPlayerIds") or []):
            raise fastapi.HTTPException(403, "You are not in this hand.")
        if body.handNumber != room["handNumber"]:
            raise fastapi.HTTPException(409, "That hand is already over.")
        if room.get("actorId") == body.playerId:
            # It is already their turn, so this is not a plan — it is an
            # action, and letting it in here would be a second way to make the
            # same decision, racing the first.
            raise fastapi.HTTPException(
                409, "It is your turn — play the hand rather than planning it."
            )

        player["preAction"] = {
            "action": body.action,
            "handNumber": room["handNumber"],
            # The moment it was decided at. Not used to invalidate anything —
            # none of these instructions can go stale, by construction — but it
            # is what a client sends back to take back the right one.
            "turnId": int(room.get("turnId", 0)),
        }
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/sit")
async def toggle_sit_out(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Sit a player out, or bring them back (applies from the next hand).

    ``action`` is ``out`` or ``in`` — where the player wants to end up, not a
    flip of where they are. A flip is the one shape where a retry is worse than
    useless: it undoes itself, and the player ends up sitting in when they
    asked to sit out with nothing on screen explaining why. Saying which side
    of the table they want to be on makes the request safe to repeat by
    construction, and safe to *mean* twice, which a receipt cannot manage.

    Anything else is read as the old flip, for a phone that still has the
    previous version of the page open, and that one keeps its receipt.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        p = room["players"].get(body.playerId)
        if not p:
            raise fastapi.HTTPException(404, "Player not found.")
        flipping = body.action not in ("out", "in")
        if flipping and _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        going_out = not p.get("sittingOut") if flipping else body.action == "out"
        # The same rule the shot clock obeys when it benches somebody: a table
        # left with one eligible player and two live stacks can neither deal nor
        # crown a winner, and nothing the remaining player does gets it moving
        # again. Choosing to sit out is no less able to strand it than timing
        # out, so it is refused at the same boundary.
        if going_out and room["phase"] != "finished" and not _can_sit_out(room, p):
            raise fastapi.HTTPException(
                400,
                "You can't sit out here — the table would be left without enough "
                "players to deal. Fold your way out or wait for the hand to end.",
            )
        p["sittingOut"] = going_out
        if not p["sittingOut"]:
            # Coming back clears the strikes that sat them out.
            p["missedTurns"] = 0
            p["autoSatOut"] = False
            # Their return may be what makes the table playable again. Without
            # re-arming, everyone sits on "Dealing the next hand…" forever
            # because the countdown was cancelled when the table ran dry.
            if (
                room["phase"] == "handover"
                and not room.get("autoDealAt")
                and len(_eligible_player_ids(room)) >= 2
            ):
                _arm_auto_deal(room)
        if flipping:
            _keep_receipt(room, body.requestId, {})
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/table")
async def control_table(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """The host's controls over the table itself, rather than over a hand.

    ``action`` is one of:

      * ``pause`` — stop the table. No deals, and the blind clock holds still.
      * ``resume`` — start it again, with exactly the time the level had left.
      * ``last-hand`` — no hand after the one being played. Everybody is told,
        because knowing it is the last hand changes how it is played.
      * ``keep-playing`` — take that back, while there is still a hand to take
        it back during.

    Pausing mid-countdown cancels the pending deal. Resuming while the table is
    between hands starts the countdown again from now, rather than from
    whatever was left when it stopped — nobody wants the next hand dealt half a
    second after they sit back down.

    No receipt: all four are settings rather than events, so each one is
    written to be safe against arriving twice on its own terms. That is the
    only version that lets a host pause, resume and pause again during the same
    hand — which a name the room had already seen would answer with a 200 and a
    table that never stopped.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can change this.")
        now = time.time()

        if body.action == "pause":
            # ``_pause_table`` keeps the moment it stopped at, so a second one
            # cannot quietly hand the table back the time it has been stopped.
            _pause_table(room, now)
        elif body.action == "resume":
            # Only from a stop. Resuming a table that is already going gives
            # whoever is on the spot a second full shot clock, which is a way
            # to stall a hand by tapping a button that looks like it does
            # nothing.
            if _is_paused(room):
                _resume_table(room, now)
                if room["phase"] == "handover":
                    _arm_auto_deal(room)
        elif body.action == "last-hand":
            if room["phase"] == "finished":
                raise fastapi.HTTPException(400, "This tournament is already over.")
            # Which hand is the last one is decided now and written down, not
            # re-derived later. Called during a hand, it is this one; called
            # between hands, there is one more to play — which is what a host
            # saying "last hand" at the table means, and the only reading that
            # does not end the night on a pot nobody knew was the final one.
            #
            # Decided once, too: asked again it is the same answer, rather than
            # the hand after the one already promised. Otherwise a repeated tap
            # — or the same tap landing after the hand it was made during has
            # ended — buys the table an extra hand nobody called for.
            if room.get("lastHandNumber") is None:
                room["lastHandNumber"] = room["handNumber"] + (
                    0 if room["phase"] == "hand" else 1
                )
            room["lastHand"] = True
        elif body.action == "keep-playing":
            if room["phase"] == "finished":
                raise fastapi.HTTPException(
                    400, "The placings are written. Start a new table."
                )
            room["lastHand"] = False
            room["lastHandNumber"] = None
        else:
            raise fastapi.HTTPException(400, f"Unknown table control: {body.action}")

        if room["phase"] != "handover":
            room["autoDealAt"] = None
        await save_room(room)
        return _build_view(room, body.playerId)


# --------------------------------------------------------------------------- #
# ASGI entrypoint
# --------------------------------------------------------------------------- #
# Vercel's `services` model routes `/api/*` to this backend and preserves the
# path (it does NOT strip `/api`). To keep every route matching, we mount the
# whole app under `/api`. The mount strips `/api` before dispatching, so a
# request to `/api/rooms` resolves the `@app.post("/rooms")` route above.
#
# The local dev proxy (frontend/next.config.mjs) also targets `/api`, so dev
# and production behave identically. Use `main:asgi_app` as the entrypoint.
asgi_app = fastapi.FastAPI(title="Texas Hold'em Poker (root)")
asgi_app.mount("/api", app)

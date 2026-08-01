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
import os
import secrets
import time
from typing import Any

import fastapi
import fastapi.middleware.cors
import fastapi.responses
from pydantic import BaseModel, Field

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

# Blind ladder expressed as multipliers of the table's opening blinds, so the
# host only picks the starting stakes and how long a level lasts. The ratio the
# host chose between small and big blind is preserved at every level.
BLIND_MULTIPLIERS = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128)

# Grace added to the shot clock before auto-acting, so a decision sent right on
# the buzzer is not lost to network latency.
TIMEOUT_GRACE = 1.5
# Pause between hands before the next one is dealt on its own. Long enough to
# read the showdown, short enough that nobody has to chase the host.
AUTO_DEAL_SECONDS = 8
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


def _lock_key(room_id: str) -> str:
    return f"holdem:lock:{room_id}"


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
  redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 1
end
return 0
"""


async def _release_lock(key: str, token: str) -> None:
    if hasattr(redis, "compare_delete"):  # dev store
        await redis.compare_delete(key, token)
    else:
        await redis.eval(_RELEASE_SCRIPT, [key], [token])


async def _guarded_set(key: str, value: str, lock_key: str, token: str) -> bool:
    """Write ``key`` only if ``lock_key`` still holds ``token``."""
    if hasattr(redis, "compare_set"):  # dev store
        return await redis.compare_set(key, value, ROOM_TTL, lock_key, token)
    result = await redis.eval(
        _GUARDED_SET_SCRIPT, [key, lock_key], [value, str(ROOM_TTL), token]
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
        if not await _guarded_set(_room_key(room["id"]), payload, lock.key, lock.token):
            lock.held = False  # somebody else owns it now; do not delete theirs
            raise LockLost(lock.key)
        return
    await redis.set(_room_key(room["id"]), payload, ex=ROOM_TTL)


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
        raise fastapi.HTTPException(403, "You were removed from this table.")
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
    """
    taken = {p["seat"] for p in room["players"].values()}
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
MAX_RECEIPTS = 32


def _receipt(room: dict[str, Any], key: str | None) -> dict[str, Any] | None:
    """What this exact request was answered with last time, if it has been."""
    if not key:
        return None
    return (room.get("receipts") or {}).get(key)


def _keep_receipt(room: dict[str, Any], key: str | None, payload: dict[str, Any]) -> None:
    """Record that this request has been carried out.

    Bounded on purpose: the room is one document that every poll reads whole,
    so an unbounded log of everything anybody ever did is a slow leak into
    every request at the table. The oldest go first; a retry that arrives after
    thirty-two other operations is not a retry.
    """
    if not key:
        return
    receipts = room.setdefault("receipts", {})
    receipts[key] = {"at": time.time(), **payload}
    while len(receipts) > MAX_RECEIPTS:
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
# Request models
# --------------------------------------------------------------------------- #
class CreateRoomBody(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    hostName: str = Field(min_length=1, max_length=20)
    startingChips: int = Field(ge=1)
    smallBlind: int = Field(ge=1)
    bigBlind: int = Field(ge=1)
    password: str = Field(min_length=1, max_length=64)
    # 0 disables the blind clock (blinds stay where they started).
    levelMinutes: int = Field(default=10, ge=0, le=120)
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
    # One extra top-up per player inside the same window, for anyone who still
    # has chips. Off unless the host asks for it.
    addOn: bool = False
    # Extra seconds each player may spend across the whole tournament, on the
    # decisions that deserve them. 0 turns the time bank off.
    timeBankSeconds: int = Field(default=0, ge=0, le=600)


class JoinBody(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=64)
    # Names this attempt, so a retry after a lost response takes the same seat
    # back instead of a second one. See "Doing a thing once" above.
    requestId: str | None = Field(default=None, max_length=64)


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
def build_blind_schedule(small_blind: int, big_blind: int) -> list[dict[str, int]]:
    """Blind levels derived from the opening stakes.

    Multiplying both blinds by the same ladder keeps the host's chosen ratio
    (usually 1:2) and keeps every level on round numbers.
    """
    return [
        {"smallBlind": small_blind * m, "bigBlind": big_blind * m}
        for m in BLIND_MULTIPLIERS
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
# becomes ``sum(stacks) + pot == issued - withdrawn``, it still holds on every
# hand, and it is still the thing that catches a bug that moves chips wrongly.
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


def _entry_stack(room: dict[str, Any]) -> int:
    """What somebody turning up mid-tournament sits down behind.

    The average is not sentiment: by level nine a starting stack is a handful
    of big blinds, so somebody arriving on it is not really playing. It is
    taken over the players still in, because averaging in the busted would hand
    the latecomer less than anybody actually has.
    """
    start = int(room["startingChips"])
    if room.get("lateEntryChips") != "average":
        return start
    live = [room["players"][pid]["chips"] for pid in _eligible_player_ids(room)]
    return max(start, round(sum(live) / len(live))) if live else start


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


def _remove_from_table(room: dict[str, Any], player_id: str, withdraw: bool) -> None:
    """Take somebody out of the game, keeping the books straight.

    Their record stays — the final standings look players up by id, and
    deleting them outright turns the podium into a KeyError — but the seat, the
    chips and the credential all go. ``withdraw`` says whether the stack leaves
    the table with them, which is the difference between going home and being
    knocked out.
    """
    player = room["players"][player_id]
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
    return [
        pid
        for pid in room["order"]
        if room["players"][pid]["chips"] > 0
        and not room["players"][pid].get("sittingOut")
    ]


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
    hand_ids = room.get("handPlayerIds") or []
    room["actorId"] = (
        hand_ids[state.actor_index]
        if live and state.actor_index < len(hand_ids)
        else None
    )


def _can_sit_out(room: dict[str, Any], player: dict[str, Any]) -> bool:
    """Whether benching this player still leaves a playable table.

    Heads-up, sitting the absent player out would leave one eligible player and
    two positive stacks: the tournament can neither deal nor declare a winner,
    and it hangs forever. Leaving them in is also the truer outcome — the blinds
    eat their stack and they bust out, exactly as they would in a real
    tournament for walking away from the table.
    """
    remaining = [
        pid for pid in _eligible_player_ids(room) if pid != player.get("id")
    ]
    return len(remaining) >= 2


def _arm_auto_deal(room: dict[str, Any]) -> None:
    """Schedule the next deal, unless the table is stopped."""
    seconds = int(room.get("autoDealSeconds", AUTO_DEAL_SECONDS) or 0)
    if seconds and not _is_paused(room):
        room["autoDealAt"] = time.time() + seconds
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
    """Players in posting order, small blind first, as pokerkit expects.

    Heads-up the button *is* the small blind, so it opens the hand. Otherwise
    the small blind is the next seat along and the button acts last.
    """
    i = eligible.index(button_id)
    if len(eligible) == 2:
        return [button_id, eligible[(i + 1) % 2]]
    return eligible[i + 1 :] + eligible[: i + 1]


def _start_hand(room: dict[str, Any]) -> None:
    now = time.time()
    room["autoDealAt"] = None
    eligible = _eligible_player_ids(room)
    if len(eligible) < 2:
        _finish_tournament(room)
        raise fastapi.HTTPException(
            400, "Need at least two players with chips to start a hand."
        )
    _apply_level(room, now)
    button_id = _next_button(room, eligible)
    room["buttonId"] = button_id
    hand_ids = _seat_order(button_id, eligible)  # index 0 == small blind
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
        )
        positions = {
            "sb": 0,
            "bb": 1,
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
    # Hole cards are fixed for the whole hand in Hold'em, so snapshot them at
    # deal time. pokerkit mucks the losing hand at showdown (clearing its
    # cards), but we still want to reveal every non-folded hand.
    room["handHoleCards"] = [poker.hole_cards(state, i) for i in range(len(hand_ids))]
    # Cards players chose to turn over last hand. Showing is for the hand it
    # belongs to; a new deal takes them back off the table.
    room["shownSeats"] = {}
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
    went_to_showdown = (len(hand_ids) - len(folded_seats)) >= 2
    board = poker.board_cards(state)
    stored_holes = room.get("handHoleCards") or []

    # Read off the engine rather than netted out of the deltas: winning a pot
    # and finishing ahead are different questions once side pots exist. See
    # poker.pushed_amounts.
    pushed = poker.pushed_amounts(state, len(hand_ids))

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
        if went_to_showdown and i not in folded_seats and i < len(stored_holes):
            made = poker.evaluate_hand(stored_holes[i], board)
            if made:
                entry["handName"] = made["name"]
                entry["handCards"] = made["cards"]
        results.append(entry)

    room["lastResults"] = results
    room["phase"] = "handover"
    room["actionDeadline"] = None
    room["actorId"] = None
    # Before the busts are recorded: the bonus is a transfer that can empty a
    # stack, and a player taken to zero by it is out like any other.
    _pay_seven_deuce(room)
    # Anybody who said goodbye mid-hand goes now, with whatever the hand left
    # them. Waiting until the hand was over is the whole point: a seat cannot
    # be pulled out from under a pot that is half played.
    for pid in [p for p in room["order"] if room["players"][p].get("leaving")]:
        _remove_from_table(room, pid, withdraw=True)
    _record_busts(room)
    # One player holding every chip ends the tournament.
    if len(_eligible_player_ids(room)) < 2:
        _finish_tournament(room)
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
    """Whether the whole table has seen this seat's hand."""
    hand_ids = room.get("handPlayerIds") or []
    folded = set(room.get("foldedSeats", []))
    if (len(hand_ids) - len(folded)) >= 2 and seat not in folded:
        return True  # shown down
    return len(set(room.get("shownSeats", {}).get(str(seat), []))) >= 2


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
            "chips": room["players"][pid]["chips"],
        }
        for place, pid in enumerate(ranking, start=1)
    ]
    room["phase"] = "finished"
    room["actionDeadline"] = None
    room["autoDealAt"] = None


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
    poker.apply_action(state, action)

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
    """When the next hand deals itself."""
    if room.get("phase") != "handover" or _is_paused(room):
        return None
    return room.get("autoDealAt") or None


def _scheduled_break_end(room: dict[str, Any]) -> float | None:
    """When a break is over and the table starts itself again."""
    return room.get("breakUntil") or None


def _scheduled_leaver(room: dict[str, Any]) -> float | None:
    """Whether somebody who has already left is holding up the hand.

    Due immediately, not on the shot clock: they said goodbye, so making the
    table wait twenty seconds for a decision nobody is going to make is the
    thing this exists to avoid.
    """
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    actor = room.get("actorId")
    if actor is None:
        return None
    return 0.0 if room["players"].get(actor, {}).get("leaving") else None


def _scheduled_preaction(room: dict[str, Any]) -> float | None:
    """Whether the player to act has already said what they want to do.

    Due at once. Waiting even a second would give back the pace this exists to
    buy, and there is nothing to wait for: the decision was made before the
    turn arrived.
    """
    if room.get("phase") != "hand" or not room.get("stateB64"):
        return None
    return 0.0 if _pre_action_for(room, room.get("actorId")) else None


def _scheduled_close(room: dict[str, Any]) -> float | None:
    """When a table that has run out of players finally gives up waiting."""
    return room.get("closeAt") or None


def _run_clock(room: dict[str, Any]) -> bool:
    return _apply_timeouts(room) is not None


def _run_leaver(room: dict[str, Any]) -> bool:
    """Play out the hand for somebody who has gone.

    Checking when it is free and folding when it is not — the same rule the
    shot clock uses, because it is the same situation and any other rule would
    give away chips that are still theirs until the hand ends. pokerkit will
    not let a player fold a hand they can see the next card of for nothing,
    which is why this cannot simply fold every time. It runs at once rather
    than on the clock, so the rest of the table is not kept waiting.
    """
    state = poker.loads(room["stateB64"])
    if poker.is_hand_over(state) or state.actor_index is None:
        return False
    seat = state.actor_index
    legal = poker.legal_actions(state)
    action = "call" if legal["canCheckOrCall"] and not legal["callAmount"] else "fold"
    if action == "fold" and not legal["canFold"]:
        action = "call"
    poker.apply_action(state, action)
    if action == "fold":
        folded = room.setdefault("foldedSeats", [])
        if seat not in folded:
            folded.append(seat)
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
        poker.apply_action(state, action, None)
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


def _run_close(room: dict[str, Any]) -> bool:
    room["closeAt"] = None
    _finish_tournament(room)
    return True


def _run_break_end(room: dict[str, Any]) -> bool:
    _resume_table(room, time.time())
    if room.get("phase") == "handover":
        _arm_auto_deal(room)
    return True


def _run_deal(room: dict[str, Any]) -> bool:
    now = time.time()
    # A break interrupts the deal rather than the hand: stopping the table
    # between hands is the only version of "back in ten minutes" that does not
    # abandon a half-played pot.
    if _break_due(room, now):
        _start_break(room, now)
        return True
    if _no_more_hands(room):
        _finish_tournament(room, by_chips=True)
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
    ("leaver", _scheduled_leaver, _run_leaver),
    # Before the clock, deliberately: a player who has already decided is not
    # out of time, and running the clock first would fold a hand they told us
    # they wanted to play.
    ("preaction", _scheduled_preaction, _run_preaction),
    ("clock", _scheduled_clock, _run_clock),
    ("deal", _scheduled_deal, _run_deal),
    ("close", _scheduled_close, _run_close),
)


def _work_due(room: dict[str, Any], now: float) -> list[str]:
    """Everything this room should already have done by ``now``."""
    due = []
    for name, when, _ in _SCHEDULE:
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
    changed = False
    for name, when, run in _SCHEDULE:
        at = when(room)
        if at is not None and now >= at:
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
    actor_id: str | None = None
    legal: dict[str, Any] | None = None
    street = "lobby"

    state = None
    shown_down = False
    hand_ids: list[str] = room.get("handPlayerIds", []) or []
    if room.get("stateB64"):
        state = poker.loads(room["stateB64"])
        board = poker.board_cards(state)
        pot = poker.pot_total(state, room["handStartStacks"])
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
        went_to_showdown = (len(hand_ids) - len(folded_seats)) >= 2
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
            reveal = (pid == viewer_id) or (hand_over and went_to_showdown and not folded)
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
                "timedOut": i in timed_out_seats,
            }
    else:
        engine_by_pid = {}

    for pid in room["order"]:
        p = room["players"][pid]
        entry = {
            "id": pid,
            "name": p["name"],
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
            "maxSeats": MAX_SEATS,
            "actionSeconds": int(room.get("actionSeconds") or 0),
            "anteMode": room.get("anteMode", "off"),
            "ante": _ante_for(room),
            "straddle": bool(room.get("straddle")),
            "bombPotEvery": int(room.get("bombPotEvery") or 0),
            # Whether the hand on the table right now is a bomb pot.
            "bombPot": bool(room.get("bombPot")),
            "sevenDeuce": int(room.get("sevenDeuce") or 0),
            "levelMinutes": int(room.get("levelMinutes") or 0),
            "autoDealSeconds": int(room.get("autoDealSeconds") or 0),
            # The table is stopped: no deals, and the blind clock is held still.
            "paused": _is_paused(room),
            "breakEveryLevels": int(room.get("breakEveryLevels") or 0),
            "breakMinutes": int(room.get("breakMinutes") or 0),
            # No hand after this one. Shown to everybody, not just the host:
            # knowing it is the last hand changes how it is played.
            "lastHand": bool(room.get("lastHand")),
            # Coming and going, and whether either door is still open.
            "allowLeaving": bool(room.get("allowLeaving", True)),
            "lateEntryOpen": _late_entry_open(room, now),
            "rebuyOpen": _rebuy_open(room, now),
            "addOn": bool(room.get("addOn")),
            "timeBankSeconds": int(room.get("timeBankSeconds") or 0),
        },
        # The decision on the table is being paid for out of the actor's bank.
        # Everybody sees it, because "they are into their time bank" is what
        # the table would say out loud and it is why the countdown restarted.
        "bankRunning": bool(room.get("bankRunning")),
        "players": players_out,
        "board": board,
        "pot": pot,
        "street": street,
        "actorId": actor_id,
        "legal": legal,
        "lastResults": room.get("lastResults", []),
        "standings": room.get("standings", []),
        # Whether this hand was actually shown down. The table can't infer it
        # from the phase: a hand won by folds also ends in "handover", and
        # treating that as a showdown puts the winner's cards on screen for the
        # player next to them to read.
        "wentToShowdown": shown_down,
        # Who collected the 7-2 bonus this hand, and what it came to.
        "sevenDeuceWin": room.get("sevenDeuceWin"),
        # The bonus is there for the taking but the cards are still down.
        "sevenDeucePending": _seven_deuce_pending(room, viewer_id),
        # What *this* viewer has said they will do, and nobody else's. A table
        # that could see who has already folded in advance would be playing a
        # different game: half the information in poker is what somebody has
        # not decided yet.
        "preAction": _pre_action_for(room, viewer_id),
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


@app.post("/rooms")
async def create_room(body: CreateRoomBody) -> dict[str, Any]:
    if body.bigBlind <= body.smallBlind:
        raise fastapi.HTTPException(400, "Big blind must be larger than small blind.")
    if body.startingChips < body.bigBlind * 2:
        raise fastapi.HTTPException(
            400, "Starting chips should be at least twice the big blind."
        )

    room_id = _new_id()
    host_id = secrets.token_urlsafe(12)
    host_token = _new_token()
    now = time.time()
    room = {
        "id": room_id,
        "name": body.name,
        "hostId": host_id,
        "passwordHash": _hash_password(body.password),
        "smallBlind": body.smallBlind,
        "bigBlind": body.bigBlind,
        "startingChips": body.startingChips,
        "phase": "lobby",
        "handNumber": 0,
        "order": [host_id],
        "players": {
            host_id: {
                "id": host_id,
                "name": body.hostName,
                "seat": 0,
                "chips": body.startingChips,
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
        # Tournament clocks.
        "blindSchedule": build_blind_schedule(body.smallBlind, body.bigBlind),
        "levelMinutes": body.levelMinutes,
        "levelIndex": 0,
        # Stays None until the first hand is dealt, so waiting in the lobby
        # never burns a blind level.
        "levelStartedAt": None,
        "actionSeconds": body.actionSeconds,
        "anteMode": body.anteMode,
        "straddle": body.straddle,
        "bombPotEvery": body.bombPotEvery,
        "sevenDeuce": body.sevenDeuce,
        "actionDeadline": None,
        "autoDealSeconds": AUTO_DEAL_SECONDS,
        "autoDealAt": None,
        # The table is stopped: no deals, and the blind clock is held still.
        "paused": False,
        "autoDealPaused": False,
        "pausedAt": None,
        "breakEveryLevels": body.breakEveryLevels,
        "breakMinutes": body.breakMinutes,
        "breakUntil": None,
        "breaksTaken": 0,
        # The host has called it: no hand after the one being played.
        "lastHand": False,
        "lastHandNumber": None,
        # Coming and going. See "Chips on and off the table".
        "lateEntryLevels": body.lateEntryLevels,
        "lateEntryChips": body.lateEntryChips,
        "allowLeaving": body.allowLeaving,
        "rebuyLevels": body.rebuyLevels,
        "rebuysPerPlayer": body.rebuysPerPlayer,
        "addOn": body.addOn,
        "timeBankSeconds": body.timeBankSeconds,
        # Whether the decision on the table is being paid for out of the
        # actor's bank rather than the shot clock. See ``_open_the_time_bank``.
        "bankRunning": False,
        # Every chip ever put on this table, and every chip taken off it. What
        # replaces "starting stack times players" once people can arrive, leave
        # and buy back in — see ``_chips_balance``.
        "chipsIssued": body.startingChips,
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
    await save_room(room)
    return {
        "roomId": room_id,
        "playerId": host_id,
        "token": host_token,
        "isHost": True,
    }


@app.post("/rooms/{room_id}/join")
async def join_room(
    room_id: str,
    body: JoinBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Take a seat.

    Three ways this can be called and only one of them creates anything:

      * a device that already holds a credential for this table is somebody
        coming back, and gets the seat it already has;
      * a request whose name the room has already answered is a retry after a
        lost response, and gets the same answer again;
      * anything else is a new player, and gets a chair.

    Without the first two, a response lost on the way home costs the retry a
    second seat — and the first seat is unrecoverable, because the only proof
    it belonged to anybody went missing with the response.
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

        if not _verify_password(body.password, room["passwordHash"]):
            raise fastapi.HTTPException(403, "Incorrect room password.")

        seen = _receipt(room, body.requestId)
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
        _keep_receipt(room, body.requestId, {"playerId": player_id, "token": token})
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
            # Nobody has played a hand, so there is nothing to place them in.
            # They simply were not here.
            room["chipsWithdrawn"] = int(room.get("chipsWithdrawn", 0)) + int(
                room["players"][body.targetId]["chips"]
            )
            room["order"] = [pid for pid in room["order"] if pid != body.targetId]
            room["players"].pop(body.targetId, None)
        else:
            # The same door somebody uses to leave of their own accord: the
            # record stays for the podium, the seat and the chips go, and the
            # button steps back rather than being cleared.
            _remove_from_table(room, body.targetId, withdraw=True)

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
        elif in_the_hand:
            player["leaving"] = True
        else:
            _remove_from_table(room, body.playerId, withdraw=True)
            if len(_eligible_player_ids(room)) < 2:
                _finish_tournament(room)
        _keep_receipt(room, body.requestId, {})
        await save_room(room)
        # Built for the host rather than the leaver: the caller may no longer
        # be anybody this table can show a view to.
        return _build_view(room, room["hostId"])


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

        _issue_chips(room, body.playerId, int(room["startingChips"]))
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
async def watch_room(room_id: str, body: WatchBody) -> dict[str, Any]:
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
    if not _verify_password(body.password, room["passwordHash"]):
        raise fastapi.HTTPException(403, "Incorrect room password.")
    return {
        "roomId": room_id,
        "playerId": f"watch-{secrets.token_urlsafe(9)}",
        "token": room["watchToken"],
        "isHost": False,
        "spectator": True,
    }


class ShowBody(BaseModel):
    playerId: str
    # Which of your two cards to turn over: [0], [1] or both.
    indices: list[int] = Field(min_length=1, max_length=2)
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
    """Turn your own cards face up after the hand.

    Half of what makes a home game a home game: the bluff nobody would believe
    unless you prove it, and the single card shown to keep them guessing. Only
    your own hand, only the one just played, and only until the next deal.

    There is no way back. Once a card is public the table has seen it, so the
    client asks before sending rather than offering an undo that cannot exist.
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
        if room["phase"] != "handover":
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

        try:
            poker.apply_action(state, body.action, body.amount)
        except poker.ActionError as exc:
            raise fastapi.HTTPException(400, str(exc))

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
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        player = room["players"][body.playerId]

        if body.action == "clear":
            player.pop("preAction", None)
            _keep_receipt(room, body.requestId, {})
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
        _keep_receipt(room, body.requestId, {})
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/sit")
async def toggle_sit_out(
    room_id: str,
    body: ActionBody,
    x_player_token: str | None = fastapi.Header(default=None),
) -> dict[str, Any]:
    """Toggle a player's sitting-out status (applies from the next hand)."""
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        p = room["players"].get(body.playerId)
        if not p:
            raise fastapi.HTTPException(404, "Player not found.")
        # A toggle is the one shape where a retry is worse than useless: it
        # undoes itself, so the player ends up sitting in when they asked to sit
        # out and nothing on screen explains why.
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        going_out = not p.get("sittingOut")
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
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        _authenticate(room, body.playerId, x_player_token)
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can change this.")
        if _receipt(room, body.requestId):
            return _build_view(room, body.playerId)
        now = time.time()

        if body.action == "pause":
            _pause_table(room, now)
        elif body.action == "resume":
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
        _keep_receipt(room, body.requestId, {})
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

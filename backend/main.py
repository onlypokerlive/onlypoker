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


def _new_id(n: int = 6) -> str:
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(n))


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


class JoinBody(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=64)


class ActionBody(BaseModel):
    playerId: str
    action: str
    amount: int | None = None
    # Which hand the decision was made for. Required on /action — see
    # ``take_action``. Declared optional here only so the field can be rejected
    # with a readable message instead of a validation dump.
    handNumber: int | None = None


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
    index, started = _projected_level(room, now)
    room["levelIndex"] = index
    room["levelStartedAt"] = started
    level = schedule[index]
    room["smallBlind"] = level["smallBlind"]
    room["bigBlind"] = level["bigBlind"]


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


def _set_action_deadline(room: dict[str, Any], state, now: float) -> None:
    """Arm the shot clock for whoever is to act (or disarm it)."""
    seconds = int(room.get("actionSeconds") or 0)
    if seconds and state.status and state.actor_index is not None:
        room["actionDeadline"] = now + seconds
    else:
        room["actionDeadline"] = None


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
    """Schedule the next deal, unless the host paused between hands."""
    seconds = int(room.get("autoDealSeconds", AUTO_DEAL_SECONDS) or 0)
    if seconds and not room.get("autoDealPaused"):
        room["autoDealAt"] = time.time() + seconds
    else:
        room["autoDealAt"] = None


def _auto_deal_due(room: dict[str, Any]) -> bool:
    return bool(
        room.get("phase") == "handover"
        and room.get("autoDealAt")
        and not room.get("autoDealPaused")
        and time.time() >= room["autoDealAt"]
    )


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
    room["stateB64"] = poker.dumps(state)
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

    results = []
    for i, pid in enumerate(hand_ids):
        final = int(state.stacks[i])
        delta = final - room["handStartStacks"][i]
        room["players"][pid]["chips"] = final
        entry = {"playerId": pid, "name": room["players"][pid]["name"], "delta": delta}
        if went_to_showdown and i not in folded_seats and i < len(stored_holes):
            made = poker.evaluate_hand(stored_holes[i], board)
            if made:
                entry["handName"] = made["name"]
                entry["handCards"] = made["cards"]
        results.append(entry)

    room["lastResults"] = results
    room["phase"] = "handover"
    room["actionDeadline"] = None
    _record_busts(room)
    # One player holding every chip ends the tournament.
    if len(_eligible_player_ids(room)) < 2:
        _finish_tournament(room)
    else:
        _arm_auto_deal(room)


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


def _finish_tournament(room: dict[str, Any]) -> None:
    """Close the room once at most one player still has chips."""
    survivors = [pid for pid in room["order"] if room["players"][pid]["chips"] > 0]
    if len(survivors) > 1:
        return
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

    seat = state.actor_index
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

    room["stateB64"] = poker.dumps(state)
    if poker.is_hand_over(state):
        _settle_hand(room, state)
    else:
        _set_action_deadline(room, state, now)
    return {"seat": seat, "action": action}


def _tick(room: dict[str, Any]) -> bool:
    """Bring the room up to date with the wall clock. True if it changed.

    Nothing runs in the background on a serverless host, so both automatic
    behaviours — folding an expired decision and dealing the next hand — happen
    here, driven by whichever request happens to arrive next.
    """
    changed = _apply_timeouts(room) is not None
    if _auto_deal_due(room):
        try:
            _start_hand(room)
        except fastapi.HTTPException:
            # Not enough players to continue: leave it to the host.
            room["autoDealAt"] = None
        changed = True
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
                "chips": int(state.stacks[i]),
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
            "levelMinutes": int(room.get("levelMinutes") or 0),
            "autoDealSeconds": int(room.get("autoDealSeconds") or 0),
            "autoDealPaused": bool(room.get("autoDealPaused")),
        },
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
        "level": _level_view(room, now),
        # Every clock is an absolute server timestamp; the client subtracts
        # serverTime to stay correct even when a device's clock is off.
        "actionDeadline": room.get("actionDeadline"),
        "autoDealAt": room.get("autoDealAt"),
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
        "actionDeadline": None,
        "autoDealSeconds": AUTO_DEAL_SECONDS,
        "autoDealAt": None,
        "autoDealPaused": False,
        "bustOrder": [],
        "standings": [],
        # Seat holding the button. Advances one seat per hand; see _next_button.
        "buttonId": None,
    }
    await save_room(room)
    return {"roomId": room_id, "playerId": host_id, "isHost": True}


@app.post("/rooms/{room_id}/join")
async def join_room(room_id: str, body: JoinBody) -> dict[str, Any]:
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        if not _verify_password(body.password, room["passwordHash"]):
            raise fastapi.HTTPException(403, "Incorrect room password.")
        if room["phase"] != "lobby":
            raise fastapi.HTTPException(
                400, "This tournament has already started. Ask the host for a new table."
            )
        if len(room["order"]) >= MAX_SEATS:
            raise fastapi.HTTPException(400, "This room is full.")

        player_id = secrets.token_urlsafe(12)
        seat = len(room["order"])
        room["players"][player_id] = {
            "id": player_id,
            "name": body.name,
            "seat": seat,
            "chips": room["startingChips"],
            "sittingOut": False,
            "lastSeen": time.time(),
        }
        room["order"].append(player_id)
        await save_room(room)
    return {"roomId": room_id, "playerId": player_id, "isHost": False}


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
    # Still a private table. Watching is not a way around the password.
    if not _verify_password(body.password, room["passwordHash"]):
        raise fastapi.HTTPException(403, "Incorrect room password.")
    return {
        "roomId": room_id,
        "playerId": f"watch-{secrets.token_urlsafe(9)}",
        "isHost": False,
        "spectator": True,
    }


class ShowBody(BaseModel):
    playerId: str
    # Which of your two cards to turn over: [0], [1] or both.
    indices: list[int] = Field(min_length=1, max_length=2)


@app.post("/rooms/{room_id}/show")
async def show_cards(room_id: str, body: ShowBody) -> dict[str, Any]:
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
        if room["phase"] != "handover":
            raise fastapi.HTTPException(400, "There is no hand to show right now.")
        hand_ids = room.get("handPlayerIds") or []
        if body.playerId not in hand_ids:
            raise fastapi.HTTPException(403, "You were not in that hand.")
        seat = hand_ids.index(body.playerId)
        held = len((room.get("handHoleCards") or [[]])[seat])
        if any(i < 0 or i >= held for i in body.indices):
            raise fastapi.HTTPException(400, "You do not have that card.")
        shown = room.setdefault("shownSeats", {})
        # Adding rather than replacing: showing one card and then the other is
        # a normal thing to do, and the first one is already public.
        shown[str(seat)] = sorted(set(shown.get(str(seat), [])) | set(body.indices))
        await save_room(room)
        return _build_view(room, body.playerId)


@app.get("/rooms/{room_id}/rabbit")
async def rabbit_hunt(room_id: str) -> dict[str, Any]:
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
    if room["phase"] not in ("handover", "finished") or not room.get("stateB64"):
        raise fastapi.HTTPException(400, "Wait for the hand to finish.")
    state = poker.loads(room["stateB64"])
    if not poker.is_hand_over(state):
        raise fastapi.HTTPException(400, "Wait for the hand to finish.")
    return {"handNumber": room["handNumber"], "streets": poker.would_have_come(state)}


@app.get("/rooms/{room_id}/state")
async def get_state(room_id: str, playerId: str | None = None) -> dict[str, Any]:
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")

    now = time.time()
    player = room["players"].get(playerId) if playerId else None
    # Heartbeat so other players can see who is connected. Throttled because
    # every seated client polls this route continuously.
    stale_heartbeat = bool(
        player and now - player.get("lastSeen", 0) >= HEARTBEAT_MIN_INTERVAL
    )
    clock_expired = bool(
        room.get("phase") == "hand"
        and room.get("actionDeadline")
        and now >= room["actionDeadline"] + TIMEOUT_GRACE
    )

    if stale_heartbeat or clock_expired or _auto_deal_due(room):
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
async def start_hand(room_id: str, body: ActionBody) -> dict[str, Any]:
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can start a hand.")
        if room["phase"] == "hand":
            raise fastapi.HTTPException(400, "A hand is already in progress.")
        if room["phase"] == "finished":
            raise fastapi.HTTPException(400, "This tournament is over.")
        try:
            _start_hand(room)
        except fastapi.HTTPException:
            # _start_hand may have closed the tournament before refusing.
            await save_room(room)
            raise
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/action")
async def take_action(room_id: str, body: ActionBody) -> dict[str, Any]:
    # An action belongs to the hand it was decided in, and an action that does
    # not name its hand cannot be shown to belong to the one in progress. It is
    # rejected before anything is read or written, so a client on an old bundle
    # gets a clear error instead of playing somebody else's cards.
    if body.handNumber is None:
        raise fastapi.HTTPException(
            400,
            "This action did not say which hand it was for. Reload the table and "
            "try again.",
        )
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
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

        room["stateB64"] = poker.dumps(state)
        if poker.is_hand_over(state):
            _settle_hand(room, state)  # state kept for the showdown reveal
        else:
            _set_action_deadline(room, state, time.time())
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/sit")
async def toggle_sit_out(room_id: str, body: ActionBody) -> dict[str, Any]:
    """Toggle a player's sitting-out status (applies from the next hand)."""
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        p = room["players"].get(body.playerId)
        if not p:
            raise fastapi.HTTPException(404, "Player not found.")
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
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/autodeal")
async def set_auto_deal(room_id: str, body: ActionBody) -> dict[str, Any]:
    """Host control for the pause between hands.

    ``action`` is "pause" to stop dealing automatically, anything else to
    resume. Pausing mid-countdown cancels the pending deal.
    """
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        if body.playerId != room["hostId"]:
            raise fastapi.HTTPException(403, "Only the host can change this.")
        room["autoDealPaused"] = body.action == "pause"
        if room["phase"] == "handover":
            _arm_auto_deal(room)
        else:
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

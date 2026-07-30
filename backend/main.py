"""Texas Hold'em backend.

FastAPI service that runs the pokerkit engine and stores all room / game state
in Upstash Redis. The frontend talks to this via ``/api/*`` (Vercel strips the
prefix, so routes here are declared without it).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Any

import fastapi
import fastapi.middleware.cors
from pydantic import BaseModel, Field
from upstash_redis.asyncio import Redis

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
redis = Redis(url=_REDIS_URL, token=_REDIS_TOKEN)

ROOM_TTL = 60 * 60 * 24  # 24h
MAX_SEATS = 9


# --------------------------------------------------------------------------- #
# Redis helpers
# --------------------------------------------------------------------------- #
def _room_key(room_id: str) -> str:
    return f"holdem:room:{room_id}"


def _lock_key(room_id: str) -> str:
    return f"holdem:lock:{room_id}"


async def load_room(room_id: str) -> dict[str, Any] | None:
    raw = await redis.get(_room_key(room_id))
    if not raw:
        return None
    return json.loads(raw)


async def save_room(room: dict[str, Any]) -> None:
    await redis.set(_room_key(room["id"]), json.dumps(room), ex=ROOM_TTL)


class _RoomLock:
    """Best-effort distributed lock so two simultaneous actions can't corrupt
    a hand. Falls through after a short wait rather than blocking forever."""

    def __init__(self, room_id: str):
        self.key = _lock_key(room_id)
        self.token = secrets.token_hex(8)

    async def __aenter__(self):
        for _ in range(50):
            ok = await redis.set(self.key, self.token, nx=True, ex=5)
            if ok:
                return self
            await asyncio.sleep(0.1)
        # Give up waiting and proceed; 5s TTL guarantees eventual recovery.
        return self

    async def __aexit__(self, *exc):
        try:
            if await redis.get(self.key) == self.token:
                await redis.delete(self.key)
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


class JoinBody(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=64)


class ActionBody(BaseModel):
    playerId: str
    action: str
    amount: int | None = None


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


def _start_hand(room: dict[str, Any]) -> None:
    eligible = _eligible_player_ids(room)
    if len(eligible) < 2:
        raise fastapi.HTTPException(
            400, "Need at least two players with chips to start a hand."
        )
    n = len(eligible)
    k = room["handNumber"] % n
    hand_ids = eligible[k:] + eligible[:k]  # index 0 == small blind
    start_stacks = [room["players"][pid]["chips"] for pid in hand_ids]
    state = poker.create_hand(start_stacks, room["smallBlind"], room["bigBlind"])

    room["handPlayerIds"] = hand_ids
    room["handStartStacks"] = start_stacks
    room["positions"] = poker.initial_positions(state)
    # Seat indices (within handPlayerIds) of players who folded this hand.
    # Tracked explicitly because pokerkit clears every player's status once the
    # hand ends, so the final state can't distinguish a fold from a showdown
    # loss.
    room["foldedSeats"] = []
    # Hole cards are fixed for the whole hand in Hold'em, so snapshot them at
    # deal time. pokerkit mucks the losing hand at showdown (clearing its
    # cards), but we still want to reveal every non-folded hand.
    room["handHoleCards"] = [poker.hole_cards(state, i) for i in range(len(hand_ids))]
    room["stateB64"] = poker.dumps(state)
    room["phase"] = "hand"
    room["lastResults"] = []
    room["handNumber"] += 1

    # A hand can immediately be over if only blinds create an all-in etc.
    if poker.is_hand_over(state):
        _settle_hand(room, state)


def _settle_hand(room: dict[str, Any], state) -> None:
    hand_ids = room["handPlayerIds"]
    results = []
    for i, pid in enumerate(hand_ids):
        final = int(state.stacks[i])
        delta = final - room["handStartStacks"][i]
        room["players"][pid]["chips"] = final
        results.append({"playerId": pid, "name": room["players"][pid]["name"], "delta": delta})
    room["lastResults"] = results
    room["phase"] = "handover"


# --------------------------------------------------------------------------- #
# View building (per-player redaction)
# --------------------------------------------------------------------------- #
def _build_view(room: dict[str, Any], viewer_id: str | None) -> dict[str, Any]:
    players_out: list[dict[str, Any]] = []
    board: list[str] = []
    pot = 0
    actor_id: str | None = None
    legal: dict[str, Any] | None = None
    street = "lobby"

    state = None
    hand_ids: list[str] = room.get("handPlayerIds", []) or []
    if room.get("stateB64"):
        state = poker.loads(room["stateB64"])
        board = poker.board_cards(state)
        pot = poker.pot_total(state, room["handStartStacks"])
        street = poker.street_name(state)
        pos = room.get("positions") or poker.initial_positions(state)
        sb_i, bb_i, button_i = pos["sb"], pos["bb"], pos["button"]
        actor_i = state.actor_index
        if actor_i is not None:
            actor_id = hand_ids[actor_i]
        viewer_index = hand_ids.index(viewer_id) if viewer_id in hand_ids else None
        hand_over = poker.is_hand_over(state)
        if viewer_index is not None and actor_i == viewer_index:
            legal = poker.legal_actions(state)

        folded_seats = set(room.get("foldedSeats", []))
        stored_holes = room.get("handHoleCards") or []
        # A showdown only happens when at least two players reach the end
        # without folding. If everyone else folded, the winner keeps cards hidden.
        went_to_showdown = (len(hand_ids) - len(folded_seats)) >= 2
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
            engine_by_pid[pid] = {
                "index": i,
                "inHand": in_hand,
                "folded": folded,
                "bet": int(state.bets[i]),
                "isActor": actor_i == i,
                "isButton": i == button_i,
                "isSmallBlind": i == sb_i,
                "isBigBlind": i == bb_i,
                "cardsCount": 0 if folded else len(hole),
                "cards": hole if reveal else None,
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
            "connected": (time.time() - p.get("lastSeen", 0)) < 15,
            "index": None,
            "inHand": False,
            "folded": False,
            "bet": 0,
            "isActor": False,
            "isButton": False,
            "isSmallBlind": False,
            "isBigBlind": False,
            "cardsCount": 0,
            "cards": None,
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
        },
        "players": players_out,
        "board": board,
        "pot": pot,
        "street": street,
        "actorId": actor_id,
        "legal": legal,
        "lastResults": room.get("lastResults", []),
        "you": next((p for p in players_out if p["id"] == viewer_id), None),
    }


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
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
        if len(room["order"]) >= MAX_SEATS:
            raise fastapi.HTTPException(400, "This room is full.")

        player_id = secrets.token_urlsafe(12)
        seat = len(room["order"])
        room["players"][player_id] = {
            "id": player_id,
            "name": body.name,
            "seat": seat,
            # Players who join mid-game start with the configured stack and can
            # play from the next hand.
            "chips": room["startingChips"],
            "sittingOut": False,
            "lastSeen": time.time(),
        }
        room["order"].append(player_id)
        await save_room(room)
    return {"roomId": room_id, "playerId": player_id, "isHost": False}


@app.get("/rooms/{room_id}/state")
async def get_state(room_id: str, playerId: str | None = None) -> dict[str, Any]:
    room = await load_room(room_id)
    if not room:
        raise fastapi.HTTPException(404, "Room not found.")
    # Heartbeat so other players can see who is connected.
    if playerId and playerId in room["players"]:
        room["players"][playerId]["lastSeen"] = time.time()
        await save_room(room)
    return _build_view(room, playerId)


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
        _start_hand(room)
        await save_room(room)
        return _build_view(room, body.playerId)


@app.post("/rooms/{room_id}/action")
async def take_action(room_id: str, body: ActionBody) -> dict[str, Any]:
    async with _RoomLock(room_id):
        room = await load_room(room_id)
        if not room:
            raise fastapi.HTTPException(404, "Room not found.")
        if room["phase"] != "hand" or not room.get("stateB64"):
            raise fastapi.HTTPException(400, "There is no hand in progress.")

        hand_ids = room["handPlayerIds"]
        if body.playerId not in hand_ids:
            raise fastapi.HTTPException(403, "You are not seated in this hand.")

        state = poker.loads(room["stateB64"])
        viewer_index = hand_ids.index(body.playerId)
        if state.actor_index != viewer_index:
            raise fastapi.HTTPException(409, "It is not your turn.")

        try:
            poker.apply_action(state, body.action, body.amount)
        except poker.ActionError as exc:
            raise fastapi.HTTPException(400, str(exc))

        if body.action == "fold":
            folded = room.setdefault("foldedSeats", [])
            if viewer_index not in folded:
                folded.append(viewer_index)

        if poker.is_hand_over(state):
            room["stateB64"] = poker.dumps(state)  # keep for showdown reveal
            _settle_hand(room, state)
        else:
            room["stateB64"] = poker.dumps(state)
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
        p["sittingOut"] = not p.get("sittingOut")
        await save_room(room)
        return _build_view(room, body.playerId)

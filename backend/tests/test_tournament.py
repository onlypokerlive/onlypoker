"""End-to-end tests for the tournament rules layered on top of pokerkit.

The two clocks (blind levels and the per-action shot clock) are driven by
``time.time()`` inside ``main``, so the tests swap in a clock they control and
step it forward instead of sleeping.
"""

from __future__ import annotations

import os
import pathlib
import random
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.pop("KV_REST_API_URL", None)
os.environ.pop("UPSTASH_REDIS_REST_URL", None)

import main  # noqa: E402
import poker  # noqa: E402


class FakeClock:
    """Stand-in for the ``time`` module, exposing only what main.py uses."""

    def __init__(self, start: float = 1_700_000_000.0):
        self.now = start

    def time(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr(main, "time", fake)
    return fake


@pytest.fixture
def client():
    main.redis = main.devstore.LocalStore()  # a fresh store per test
    with TestClient(main.asgi_app) as c:
        yield c


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
# Tokens handed out at the door, kept per test so helpers can prove who they
# are without every call site threading it through.
TOKENS: dict[str, str] = {}


def auth(player_id):
    return {main.PLAYER_TOKEN_HEADER: TOKENS.get(player_id, "")}


def create_room(client, **overrides):
    body = {
        "name": "Test table",
        "hostName": "Host",
        "startingChips": 1000,
        "smallBlind": 5,
        "bigBlind": 10,
        "password": "secret",
        "levelMinutes": 10,
        "actionSeconds": 20,
    }
    body.update(overrides)
    res = client.post("/api/rooms", json=body)
    assert res.status_code == 200, res.text
    out = res.json()
    TOKENS[out["playerId"]] = out["token"]
    return out


def join(client, room_id, name, password="secret"):
    res = client.post(
        f"/api/rooms/{room_id}/join", json={"name": name, "password": password}
    )
    assert res.status_code == 200, res.text
    out = res.json()
    TOKENS[out["playerId"]] = out["token"]
    return out


def state(client, room_id, player_id):
    res = client.get(
        f"/api/rooms/{room_id}/state",
        params={"playerId": player_id},
        headers=auth(player_id),
    )
    assert res.status_code == 200, res.text
    return res.json()


def start(client, room_id, host_id):
    return client.post(
        f"/api/rooms/{room_id}/start",
        headers=auth(host_id),
        json={"playerId": host_id, "action": "start"},
    )


def hand_number(client, room_id):
    """Current hand number, read straight from the store.

    Deliberately not through ``GET /state``: that route also runs the clocks,
    and several tests below depend on nothing ticking between two steps.
    """
    return client.portal.call(main.load_room, room_id)["handNumber"]


def turn_id(client, room_id):
    """The moment the room is at, read straight from the store. See ``hand_number``."""
    return client.portal.call(main.load_room, room_id).get("turnId", 0)


def act(client, room_id, player_id, action, amount=None, hand=None, turn=None):
    return client.post(
        f"/api/rooms/{room_id}/action",
        headers=auth(player_id),
        json={
            "playerId": player_id,
            "action": action,
            "amount": amount,
            # Every real client stamps its hand and the moment it was looking
            # at; the helper does the same so the tests exercise the path
            # players actually take.
            "handNumber": hand_number(client, room_id) if hand is None else hand,
            "turnId": turn_id(client, room_id) if turn is None else turn,
        },
    )


def table(client, players=2, **overrides):
    """Create a room with `players` seats and return (room_id, [ids...])."""
    host = create_room(client, **overrides)
    ids = [host["playerId"]]
    for i in range(players - 1):
        ids.append(join(client, host["roomId"], f"P{i + 1}")["playerId"])
    return host["roomId"], ids


# --------------------------------------------------------------------------- #
# Deployment safety
# --------------------------------------------------------------------------- #
def test_deploying_without_a_store_fails_loudly():
    """On Vercel the in-memory fallback would silently lose every room.

    Each serverless invocation gets a fresh process, so rooms would appear and
    vanish at random. Refusing to boot is the only honest behaviour.
    """
    import subprocess

    env = {k: v for k, v in os.environ.items() if "REDIS" not in k and "KV_" not in k}
    env["VERCEL"] = "1"
    result = subprocess.run(
        [sys.executable, "-c", "import main"],
        cwd=str(pathlib.Path(__file__).resolve().parents[1]),
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode != 0
    assert "Upstash" in result.stderr


# --------------------------------------------------------------------------- #
# Blind levels
# --------------------------------------------------------------------------- #
def test_blind_schedule_keeps_the_hosts_ratio():
    schedule = main.build_blind_schedule(5, 10)
    assert schedule[0] == {"smallBlind": 5, "bigBlind": 10}
    assert schedule[1] == {"smallBlind": 10, "bigBlind": 20}
    assert all(s["bigBlind"] == s["smallBlind"] * 2 for s in schedule)
    # Strictly increasing, so a level always costs more than the last.
    assert all(
        b["smallBlind"] > a["smallBlind"] for a, b in zip(schedule, schedule[1:])
    )

    odd = main.build_blind_schedule(25, 75)  # 1:3 ratio is preserved too
    assert odd[1] == {"smallBlind": 50, "bigBlind": 150}


def test_blind_clock_does_not_run_in_the_lobby(client, clock):
    room_id, ids = table(client, 2, levelMinutes=1)
    clock.advance(600)  # ten minutes of waiting around
    view = state(client, room_id, ids[0])
    assert view["level"]["number"] == 1
    assert view["level"]["secondsLeft"] is None  # clock starts on the first deal

    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["level"]["number"] == 1
    assert view["level"]["secondsLeft"] == 60


def test_blinds_rise_one_level_per_period(client, clock):
    room_id, ids = table(client, 2, levelMinutes=1, actionSeconds=0)
    start(client, room_id, ids[0])
    assert state(client, room_id, ids[0])["room"]["bigBlind"] == 10

    clock.advance(61)
    view = state(client, room_id, ids[0])
    # Mid-hand the old level still applies; the new one is flagged as pending.
    assert view["room"]["bigBlind"] == 10
    assert view["level"]["pending"]["bigBlind"] == 20

    fold_until_hand_over(client, room_id, ids)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["room"]["smallBlind"] == 10
    assert view["room"]["bigBlind"] == 20
    assert view["level"]["number"] == 2
    assert view["level"]["pending"] is None


def test_a_long_gap_skips_straight_to_the_right_level(client, clock):
    room_id, ids = table(client, 2, levelMinutes=1, actionSeconds=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    clock.advance(60 * 5 + 1)  # five levels' worth of chatting between hands
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["level"]["number"] == 6
    assert view["room"]["bigBlind"] == main.BLIND_MULTIPLIERS[5] * 10


def test_level_zero_minutes_freezes_the_blinds(client, clock):
    room_id, ids = table(client, 2, levelMinutes=0, actionSeconds=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    clock.advance(60 * 60)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["room"]["bigBlind"] == 10
    assert view["level"]["secondsLeft"] is None


# --------------------------------------------------------------------------- #
# Shot clock
# --------------------------------------------------------------------------- #
def test_deadline_is_armed_for_the_player_to_act(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["actionDeadline"] == pytest.approx(view["serverTime"] + 20)
    assert view["room"]["actionSeconds"] == 20


def test_expired_clock_folds_a_player_facing_a_bet(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    actor = view["actorId"]

    clock.advance(30)
    # Somebody else's poll is what enforces the clock — nobody has to be online.
    other = next(p for p in ids if p != actor)
    view = state(client, room_id, other)
    folded = next(p for p in view["players"] if p["id"] == actor)
    assert folded["folded"] is True
    assert folded["timedOut"] is True
    assert view["actorId"] != actor


def test_expired_clock_checks_when_checking_is_free(client, clock):
    room_id, ids = table(client, 2)
    start(client, room_id, ids[0])
    # Heads-up preflop the small blind acts first; calling closes the action to
    # the big blind, who can then check for free.
    view = state(client, room_id, ids[0])
    sb = view["actorId"]
    assert act(client, room_id, sb, "call").status_code == 200

    view = state(client, room_id, sb)
    bb = view["actorId"]
    assert view["legal"] is None or view["actorId"] == bb

    clock.advance(30)
    view = state(client, room_id, sb)
    big_blind_player = next(p for p in view["players"] if p["id"] == bb)
    assert big_blind_player["folded"] is False  # checked, not folded
    assert big_blind_player["timedOut"] is True
    assert view["street"] == "flop"


def test_clock_grace_period_lets_a_late_action_through(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    clock.advance(21)  # past the deadline, inside the grace window
    assert act(client, room_id, actor, "call").status_code == 200


def test_acting_after_the_clock_expired_is_rejected_clearly(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    clock.advance(60)
    res = act(client, room_id, actor, "call")
    assert res.status_code == 409
    assert "time ran out" in res.json()["detail"].lower()


def test_an_action_cannot_land_on_a_later_hand(client, clock):
    """A decision stamped with a finished hand must not play the next one."""
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    stale_hand = state(client, room_id, ids[0])["room"]["handNumber"]
    fold_until_hand_over(client, room_id, ids)

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "hand"
    assert view["room"]["handNumber"] == stale_hand + 1

    actor = view["actorId"]
    res = act(client, room_id, actor, "call", hand=stale_hand)
    assert res.status_code == 409
    assert "already over" in res.json()["detail"]
    # The new hand is untouched: it is still that player's turn.
    assert state(client, room_id, ids[0])["actorId"] == actor


def test_dealing_never_happens_inside_an_action(client, clock):
    """The action route must not deal, or a late action plays the fresh hand."""
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    clock.advance(main.AUTO_DEAL_SECONDS + 1)  # a deal is due but nobody polled

    res = act(client, room_id, ids[0], "call")
    assert res.status_code == 400
    assert "no hand in progress" in res.json()["detail"].lower()


def test_zero_seconds_disables_the_shot_clock(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["actionDeadline"] is None
    actor = view["actorId"]
    clock.advance(60 * 10)
    view = state(client, room_id, ids[0])
    assert view["actorId"] == actor  # still waiting, nobody was auto-folded


def test_each_player_gets_a_full_window_after_a_timeout(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    clock.advance(30)
    view = state(client, room_id, ids[0])
    # The next player's clock starts when the previous one is resolved, not at
    # the moment the first deadline passed.
    assert view["actionDeadline"] == pytest.approx(view["serverTime"] + 20)


# --------------------------------------------------------------------------- #
# Tournament lifecycle
# --------------------------------------------------------------------------- #
def test_the_door_closes_when_the_host_said_it_would(client, clock):
    """It used to close on the first deal. Now the host decides — see B3.

    Late entry off means exactly the old behaviour, which is why that is what
    this asserts: it is the setting a host picks when they want the table
    locked, and it has to still work.
    """
    room_id, ids = table(client, 2, lateEntryLevels=0)
    start(client, room_id, ids[0])
    res = client.post(
        f"/api/rooms/{room_id}/join", json={"name": "Latecomer", "password": "secret"}
    )
    assert res.status_code == 400
    assert "past the point" in res.json()["detail"]


def test_last_player_standing_wins_the_tournament(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0)
    start(client, room_id, ids[0])
    # Push everyone all-in until one stack owns the table.
    for _ in range(60):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] in ("handover", "finished"):
            if view["room"]["phase"] == "finished":
                break
            if start(client, room_id, ids[0]).status_code != 200:
                break
            continue
        actor = view["actorId"]
        legal = state(client, room_id, actor)["legal"]
        if legal and legal["canRaise"]:
            act(client, room_id, actor, "raise", legal["maxRaise"])
        else:
            act(client, room_id, actor, "call")

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    standings = view["standings"]
    assert [s["place"] for s in standings] == [1, 2]
    assert standings[0]["chips"] == 2000
    assert standings[1]["chips"] == 0
    # The hand that ends a tournament is the one everybody talks about, so its
    # result has to survive the close — the table shows it beside the podium.
    assert len(view["lastResults"]) == 2
    assert any(r["delta"] > 0 for r in view["lastResults"])


def test_the_hand_that_ends_the_night_is_played_out_like_any_other(client, clock):
    """The most-watched hand of the night used to be the one nobody saw.

    Settling replaced the table with a scoreboard in the same response that
    dealt the last card: no showdown, no pot crossing the felt, no seeing what
    it was won with. The hand that decides everything got less of a look at it
    than the hand before it. Now it takes the same pause every other hand does,
    and the standings come after.
    """
    room_id, ids = table(client, 2, actionSeconds=0)
    start(client, room_id, ids[0])
    ending = None
    for _ in range(80):
        view = state(client, room_id, ids[0])
        phase = view["room"]["phase"]
        if phase == "finished":
            break
        if phase == "handover":
            room = client.portal.call(main.load_room, room_id)
            if room.get("finishAt"):
                ending = view
                break
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
            continue
        actor = view["actorId"]
        legal = state(client, room_id, actor)["legal"]
        if legal and legal["canRaise"]:
            act(client, room_id, actor, "raise", legal["maxRaise"])
        else:
            act(client, room_id, actor, "call")

    assert ending, "the tournament never came down to one player"
    # Still a table, with the hand that just ended sitting on it.
    assert ending["room"]["phase"] == "handover"
    assert len(ending["lastResults"]) == 2
    assert ending["potAtEnd"] > 0, "and the pot is still in the middle"
    assert not ending["standings"], "the podium comes afterwards, not instead"

    clock.advance(main.HANDOVER_MAX_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert [s["place"] for s in view["standings"]] == [1, 2]


def play_to_the_end(client, clock, room_id, ids):
    """Shove every hand until somebody has all the chips."""
    for _ in range(120):
        view = state(client, room_id, ids[0])
        phase = view["room"]["phase"]
        if phase == "finished":
            return view
        if phase == "handover":
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
            continue
        actor = view["actorId"]
        if not actor:
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
            continue
        legal = state(client, room_id, actor)["legal"]
        if legal and legal["canRaise"]:
            act(client, room_id, actor, "raise", legal["maxRaise"])
        else:
            act(client, room_id, actor, "call")
    raise AssertionError("the tournament never came down to one player")


def again(client, room_id, player_id, request_id="again:1"):
    return client.post(
        f"/api/rooms/{room_id}/again",
        headers=auth(player_id),
        json={"playerId": player_id, "action": "again", "requestId": request_id},
    )


def test_the_table_can_play_another_one(client, clock):
    """The end of a tournament is not the end of an evening.

    Everybody is still in the room and the chips are still on the table, so
    "again?" is the only thing anybody says at that moment — and the app's
    answer was a podium with nothing on it to press.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    finished = play_to_the_end(client, clock, room_id, ids)
    assert finished["room"]["phase"] == "finished"
    hands = finished["room"]["handNumber"]
    assert hands > 0

    assert again(client, room_id, ids[0]).status_code == 200
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "lobby"
    assert view["room"]["handNumber"] == 0
    assert not view["standings"], "last night's podium is not this night's"
    # Everybody is back, on the same seat, with a full stack.
    assert len(view["players"]) == 3
    for player in view["players"]:
        assert player["chips"] == view["room"]["startingChips"]
        assert player["out"] is False
        assert player["rebuys"] == 0
    assert books_balance(client, room_id)

    # And it plays: the whole point is that this is a table, not a receipt.
    assert start(client, room_id, ids[0]).status_code == 200
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_only_the_host_can_deal_another_one(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    play_to_the_end(client, clock, room_id, ids)
    assert again(client, room_id, ids[1]).status_code == 403
    # And not while one is still being played.
    room_id2, ids2 = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id2, ids2[0])
    refused = again(client, room_id2, ids2[0])
    assert refused.status_code == 400
    assert "still going" in refused.json()["detail"]


def test_two_taps_on_play_again_are_one_tournament(client, clock):
    """A retry lands on a room that is already a lobby.

    Checking the phase before the receipt would answer the second tap with
    "this tournament is still going" — about a tournament the first tap ended.
    And a second rack-up mid-hand would put everybody's chips back while a hand
    was being played.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    play_to_the_end(client, clock, room_id, ids)
    assert again(client, room_id, ids[0], "again:room:41").status_code == 200
    assert start(client, room_id, ids[0]).status_code == 200
    # The same tap arriving late, with a hand on the table.
    assert again(client, room_id, ids[0], "again:room:41").status_code == 200
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"
    assert books_balance(client, room_id)


def test_a_new_tournament_does_not_answer_with_the_last_ones_receipts(client, clock):
    """Hand numbers start again, and requests are named by hand number.

    So a receipt kept across the reset is a name the next tournament will use
    again — and the first player to fold on hand 1 would be answered with
    whatever somebody did on hand 1 last time, which is a fold that never
    happened.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    play_to_the_end(client, clock, room_id, ids)
    # A decision from the tournament that just ended, named the way the client
    # names one: the player, the hand it was made in, and the turn.
    room = client.portal.call(main.load_room, room_id)
    stale = f"a:{ids[1]}:1:7"
    main._keep_receipt(room, stale, {"ok": True})
    client.portal.call(main.save_room, room)

    again(client, room_id, ids[0], "again:room:9")
    room = client.portal.call(main.load_room, room_id)
    assert stale not in room["receipts"]
    assert list(room["receipts"]) == ["again:room:9"]


def test_placings_follow_bust_order(clock):
    """Busting later is a better finish, and the survivor takes first place."""
    room = {
        "order": ["a", "b", "c"],
        "players": {
            "a": {"name": "Ana", "chips": 0},
            "b": {"name": "Ben", "chips": 3000},
            "c": {"name": "Cal", "chips": 0},
        },
        "bustOrder": ["c"],  # Cal was already out; Ana busts in this hand
        "phase": "handover",
    }
    main._finish_tournament(room)
    assert room["phase"] == "finished"
    assert [(s["place"], s["name"]) for s in room["standings"]] == [
        (1, "Ben"),
        (2, "Ana"),
        (3, "Cal"),
    ]


def test_players_busting_on_the_same_hand_are_split_by_stack(clock):
    """The shorter stack was all-in for less, so it goes out first."""
    room = {
        "order": ["big", "small", "winner"],
        "players": {
            "big": {"name": "Big", "chips": 0},
            "small": {"name": "Small", "chips": 0},
            "winner": {"name": "Win", "chips": 3000},
        },
        "handPlayerIds": ["big", "small", "winner"],
        "handStartStacks": [800, 200, 2000],
        "bustOrder": [],
        "phase": "handover",
    }
    main._record_busts(room)
    # Busting later is better, so the bust list runs shortest stack first.
    assert room["bustOrder"] == ["small", "big"]

    main._finish_tournament(room)
    assert [(s["place"], s["name"]) for s in room["standings"]] == [
        (1, "Win"),
        (2, "Big"),
        (3, "Small"),
    ]


def test_finished_tournament_cannot_deal_another_hand(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0)
    start(client, room_id, ids[0])
    # Bust one player outright so the room has to close itself.
    room = client.portal.call(main.load_room, room_id)
    room["players"][ids[1]]["chips"] = 0
    room["phase"] = "handover"
    main._finish_tournament(room)
    client.portal.call(main.save_room, room)

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert view["standings"][0]["playerId"] == ids[0]

    res = start(client, room_id, ids[0])
    assert res.status_code == 400
    assert "over" in res.json()["detail"].lower()


# --------------------------------------------------------------------------- #
# Dealing the next hand
# --------------------------------------------------------------------------- #
def test_next_hand_is_dealt_without_the_host(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"
    # Everybody folded, so there is nothing on the table to read.
    assert view["autoDealAt"] == pytest.approx(
        view["serverTime"] + main.HANDOVER_FOLD_SECONDS
    )

    clock.advance(main.HANDOVER_MAX_SECONDS + 1)
    # A player who is not the host polling is enough to get the cards out.
    view = state(client, room_id, ids[1])
    assert view["room"]["phase"] == "hand"
    assert view["room"]["handNumber"] == 2


def play_to_showdown(client, room_id, ids):
    """Call and check whoever is to act until the hand ends with cards up."""
    for _ in range(60):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand":
            return view
        actor = view["actorId"]
        if actor is None:
            return view
        if act(client, room_id, actor, "check").status_code != 200:
            act(client, room_id, actor, "call")
    raise AssertionError("hand did not finish")


def handover_pause(client, room_id, player_id):
    view = state(client, room_id, player_id)
    assert view["room"]["phase"] == "handover"
    return view["autoDealAt"] - view["serverTime"]


def test_a_showdown_is_held_longer_than_a_hand_nobody_showed(client, clock):
    """The pause exists to be read, so it is as long as there is to read.

    One number for both cases is wrong in both directions at once: eight
    seconds of nothing after a fold-around — which is most hands — and the same
    eight to take in a showdown, an all-in and a knockout at once.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    play_to_showdown(client, room_id, ids)

    pause = handover_pause(client, room_id, ids[0])
    assert pause == pytest.approx(main.HANDOVER_SHOWDOWN_SECONDS)
    assert pause > main.HANDOVER_FOLD_SECONDS


def test_an_all_in_gets_long_enough_to_watch_the_board_come(client, clock):
    """The client deals an all-in board out card by card (``use-runout``).

    If the pause is only as long as a normal showdown, the next hand takes the
    board away while the reveal is still running — which turns the one hand an
    hour worth watching into the one hand nobody gets to see.
    """
    # Two halves, because heads-up an all-in usually ends the tournament and
    # there is no handover left to measure. First: the signal exists on the
    # wire — the action log is where the pause reads it from.
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    # Their own view: `legal` is only filled in for the player it belongs to,
    # and heads-up the first to act is the button, which is not the host.
    legal = state(client, room_id, actor)["legal"]
    res = act(client, room_id, actor, "raise", legal["maxRaise"])
    assert res.status_code == 200, res.text
    assert any(entry["allIn"] for entry in actions(client, room_id, ids[0]))

    # Second: the pause spends it.
    room = {
        "autoDealSeconds": main.AUTO_DEAL_SECONDS,
        "handPlayerIds": ["a", "b"],
        "foldedSeats": [],
        "actionLog": [{"allIn": True}],
        "boardResults": [],
        "lastResults": [],
        "players": {"a": {"chips": 10}, "b": {"chips": 10}},
    }
    assert main._handover_seconds(room) == (
        main.HANDOVER_SHOWDOWN_SECONDS + main.HANDOVER_ALL_IN_SECONDS
    )


def test_the_pause_stops_where_reading_stops(client, clock):
    """However the reasons add up, past this nobody is reading — they are waiting."""
    room = {
        "autoDealSeconds": main.AUTO_DEAL_SECONDS,
        "handPlayerIds": ["a", "b", "c"],
        "foldedSeats": [],
        "actionLog": [{"allIn": True}],
        "boardResults": [{"cards": []}, {"cards": []}],
        "lastResults": [{"playerId": "a"}],
        "players": {"a": {"chips": 0}, "b": {"chips": 10}, "c": {"chips": 10}},
    }
    assert main._handover_seconds(room) == main.HANDOVER_MAX_SECONDS


def test_a_hand_nobody_showed_is_not_paced_by_what_happened_in_it(client, clock):
    """A fold-around has nothing to read whatever went on before the last fold.

    Written down because the obvious implementation adds the all-in bonus to
    every hand that contained one, and the hand where somebody shoves and takes
    it down uncalled is exactly the hand with nothing to look at.
    """
    room = {
        "autoDealSeconds": main.AUTO_DEAL_SECONDS,
        "handPlayerIds": ["a", "b"],
        "foldedSeats": [1],
        "actionLog": [{"allIn": True}],
        "boardResults": [],
        "lastResults": [],
        "players": {"a": {"chips": 10}, "b": {"chips": 10}},
    }
    assert main._handover_seconds(room) == main.HANDOVER_FOLD_SECONDS


def test_host_can_pause_and_resume_dealing(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    res = client.post(
        f"/api/rooms/{room_id}/table",
        headers=auth(ids[0]),
        json={"playerId": ids[0], "action": "pause"}
    )
    assert res.status_code == 200
    assert res.json()["autoDealAt"] is None

    clock.advance(60)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"  # still waiting, as asked
    assert view["room"]["paused"] is True

    client.post(
        f"/api/rooms/{room_id}/table",
        headers=auth(ids[0]),
        json={"playerId": ids[0], "action": "resume"}
    )
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_only_the_host_can_pause_dealing(client, clock):
    room_id, ids = table(client, 2)
    res = client.post(
        f"/api/rooms/{room_id}/table",
        headers=auth(ids[1]),
        json={"playerId": ids[1], "action": "pause"}
    )
    assert res.status_code == 403


def test_dealing_stops_when_the_tournament_is_over(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    room["players"][ids[1]]["chips"] = 0
    room["phase"] = "handover"
    main._finish_tournament(room)
    client.portal.call(main.save_room, room)

    clock.advance(60)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert view["autoDealAt"] is None


# --------------------------------------------------------------------------- #
# Sitting out the absent
# --------------------------------------------------------------------------- #
def test_repeated_timeouts_sit_a_player_out(client, clock):
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])

    auto_sat_out = None
    for _ in range(40):
        clock.advance(25)
        view = state(client, room_id, ids[0])
        auto_sat_out = [p for p in view["players"] if p["autoSatOut"]]
        if auto_sat_out:
            break
    assert auto_sat_out, "nobody was sat out after repeatedly missing turns"
    assert all(p["sittingOut"] for p in auto_sat_out)


def test_acting_clears_the_missed_turn_count(client, clock):
    """Only *consecutive* misses count — playing a hand wipes the slate."""
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    # Put them one strike short of the bench.
    room = client.portal.call(main.load_room, room_id)
    room["players"][actor]["missedTurns"] = main.AUTO_SIT_OUT_TIMEOUTS - 1
    client.portal.call(main.save_room, room)

    assert act(client, room_id, actor, "call").status_code == 200

    room = client.portal.call(main.load_room, room_id)
    assert room["players"][actor]["missedTurns"] == 0
    assert not room["players"][actor].get("sittingOut")


def test_the_last_strike_is_what_sits_them_out(client, clock):
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    room = client.portal.call(main.load_room, room_id)
    room["players"][actor]["missedTurns"] = main.AUTO_SIT_OUT_TIMEOUTS - 1
    client.portal.call(main.save_room, room)

    clock.advance(25)  # let the clock take the decision instead
    view = state(client, room_id, ids[0])
    benched = next(p for p in view["players"] if p["id"] == actor)
    assert benched["sittingOut"] is True
    assert benched["autoSatOut"] is True


def test_walking_away_heads_up_costs_the_blinds_and_not_the_table(client, clock):
    """Benching used to deadlock a heads-up table. Now it just costs money.

    Sitting somebody out removed them from the deal, so heads-up it left one
    eligible player and two live stacks: nothing to deal, nobody to crown. The
    old answer was to refuse to bench them at all. The real answer is that
    being away from the table does not take you out of the hand — you are dealt
    in and the blinds take the stack, which is what walking away from a real
    tournament costs you.
    """
    # Four big blinds each, so the blinds get where they are going in a few
    # hands rather than fifty. Nothing else about this depends on the size.
    room_id, ids = table(
        client, 2, smallBlind=50, bigBlind=100, startingChips=400, levelMinutes=0
    )
    start(client, room_id, ids[0])

    # One of them is here and playing; the other never answers. Both walking
    # away is a different case — see the test below — and would stop the deal.
    benched = False
    for _ in range(200):
        view = state(client, room_id, ids[0])
        benched = benched or any(p["autoSatOut"] for p in view["players"])
        phase = view["room"]["phase"]
        if phase == "finished":
            break
        if phase == "handover" or not view["actorId"]:
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
        elif view["actorId"] == ids[0]:
            act(client, room_id, ids[0], "call")
        else:
            clock.advance(30)  # nobody there to answer

    view = state(client, room_id, ids[0])
    # The clock benched them, which it used to refuse to do heads-up...
    assert benched, "the absent player was protected from being benched"
    # ...and being benched did not save them: they were blinded out, and the
    # table reached an end rather than hanging with two live stacks.
    assert view["room"]["phase"] == "finished", "the table hung instead of ending"
    assert [s["place"] for s in view["standings"]] == [1, 2]
    assert books_balance(client, room_id)


def test_sitting_out_heads_up_is_allowed_and_still_ends(client, clock):
    """It used to be refused, because it stranded the table. It no longer does.

    Refusing was the right answer to the wrong rule: an absent player was
    skipped by the deal, so heads-up there was nothing left to deal. Now they
    are dealt in and blinded, so stepping away is always allowed — and it costs
    the same thing it costs anywhere else.
    """
    room_id, ids = table(
        client, 2, smallBlind=50, bigBlind=100, startingChips=400,
        actionSeconds=0, levelMinutes=0,
    )
    start(client, room_id, ids[0])

    view = state(client, room_id, ids[1])
    assert view["you"]["canSitOut"] is True
    res = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[1]),
        json={"playerId": ids[1], "action": "sit"},
    )
    assert res.status_code == 200
    assert any(p["sittingOut"] for p in state(client, room_id, ids[0])["players"])

    # And the table keeps going without them until it has a winner. The absent
    # seat is never *waited on*: the schedule answers for it, so it can show as
    # the actor on the poll that dealt the hand and never on the one after —
    # which is what `_run_away` is for, and what a shot clock ticking down on an
    # empty chair would not be.
    waited = 0
    worst_wait = 0
    for _ in range(200):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] == "finished":
            break
        if view["room"]["phase"] == "handover" or not view["actorId"]:
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
            continue
        if view["actorId"] != ids[0]:
            waited += 1
            worst_wait = max(worst_wait, waited)
            continue
        waited = 0
        act(client, room_id, ids[0], "call")
    assert state(client, room_id, ids[0])["room"]["phase"] == "finished"
    assert worst_wait <= 1, f"the table waited {worst_wait} polls on an empty seat"
    assert books_balance(client, room_id)


def play_hands(client, clock, room_id, ids, hands):
    """Play `hands` hands out, with whoever is present calling everything.

    Not `fold_until_hand_over`: folding everybody hands the pot to the one
    player who is not folding, and when that player is the one sitting out the
    blinds they paid come straight back. A test of what being away costs has to
    let the people who are there contest the pot.

    Returns how many hands actually finished.
    """
    done = 0
    for _ in range(hands * 30):
        if done >= hands:
            break
        view = state(client, room_id, ids[0])
        phase = view["room"]["phase"]
        if phase == "finished":
            break
        if phase == "handover":
            done += 1
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
            continue
        actor = view["actorId"]
        if not actor:
            clock.advance(main.HANDOVER_MAX_SECONDS + 1)
            continue
        # Never acted for: the schedule answers for anybody who is not here.
        if room_players(client, room_id)[actor].get("sittingOut"):
            continue
        act(client, room_id, actor, "call")
    return done


def room_players(client, room_id):
    return client.portal.call(main.load_room, room_id)["players"]


def test_sitting_out_does_not_dodge_the_blinds(client, clock):
    """The whole of it, in one arithmetic.

    Sitting out used to take a player out of the deal, so they posted nothing
    while everybody else posted — which makes stepping away the cheapest move
    at the table. Wait out a level from the sofa and come back with the same
    stack the people who kept playing have been paying for. The bigger the
    blinds, the better it gets.
    """
    room_id, ids = table(
        client, 3, smallBlind=50, bigBlind=100, startingChips=3000,
        actionSeconds=0, levelMinutes=0,
    )
    away = ids[2]
    client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(away),
        json={"playerId": away, "action": "sit"},
    )
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    # Dealt in, which is the whole of it. Skipped by the deal they pay nothing.
    assert away in room["handPlayerIds"]
    before = room["players"][away]["chips"]

    # Six hands the two present players actually contest, so the absent one
    # folds rather than winning by default. Three-handed, the blinds reach
    # every seat twice over six hands.
    played = play_hands(client, clock, room_id, ids, 6)
    assert played >= 6, f"only got through {played} hands"

    room = client.portal.call(main.load_room, room_id)
    after = room["players"][away]["chips"]
    assert after < before, "the absent player paid nothing while everybody else did"
    # They folded every hand, so what they are down is the blinds that reached
    # them and never more than that.
    assert before - after <= 6 * (room["smallBlind"] + room["bigBlind"])
    assert books_balance(client, room_id)


def test_an_absent_player_is_blinded_all_the_way_out(client, clock):
    """Far enough that it ends: they bust, and the tournament records it.

    Paying the blinds is only the honest rule if it eventually costs the seat.
    A player who bleeds to zero and then sits there for ever is a table that
    cannot finish.
    """
    room_id, ids = table(
        client, 3, smallBlind=50, bigBlind=100, startingChips=400,
        actionSeconds=0, levelMinutes=0,
    )
    away = ids[2]
    client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(away),
        json={"playerId": away, "action": "sit"},
    )
    start(client, room_id, ids[0])
    play_hands(client, clock, room_id, ids, 20)

    room = client.portal.call(main.load_room, room_id)
    assert room["players"][away]["chips"] == 0, "the blinds never finished the job"
    assert away in room["bustOrder"] or room["phase"] == "finished"
    assert books_balance(client, room_id)


def test_a_table_where_everybody_stepped_away_stops_dealing(client, clock):
    """The brake on the rule above.

    Blinding an absent player down is right while there is a table to be absent
    from. Dealing hand after hand into an empty room is the app playing the
    tournament by itself and handing the result to whoever comes back first.
    The appointment stays set, so the first person back finds a hand due.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    for pid in ids:
        client.post(
            f"/api/rooms/{room_id}/sit",
            headers=auth(pid),
            json={"playerId": pid, "action": "sit"},
        )

    room = client.portal.call(main.load_room, room_id)
    assert room["autoDealAt"] is not None, "the appointment was cancelled, not held"
    assert main._scheduled_deal(room) is None, "it dealt into an empty room"

    clock.advance(main.HANDOVER_MAX_SECONDS + 10)
    assert state(client, room_id, ids[0])["room"]["phase"] == "handover"

    # One of them comes back, and the hand that was due is dealt at once.
    client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[0]),
        json={"playerId": ids[0], "action": "in"},
    )
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_sitting_out_stays_available_once_a_third_player_is_seated(client, clock):
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[1])
    assert view["you"]["canSitOut"] is True
    res = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[1]),
        json={"playerId": ids[1], "action": "sit"}
    )
    assert res.status_code == 200
    assert res.json()["you"]["sittingOut"] is True


def test_an_action_must_say_which_hand_it_is_for(client, clock):
    """A client that omits the stamp is refused, not trusted.

    The stamp was optional "so older clients keep working", which is precisely
    the case it had to catch: a stale tab replays an action into whatever hand
    happens to be running now.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    res = client.post(
        f"/api/rooms/{room_id}/action",
        headers=auth(actor),
        json={"playerId": actor, "action": "call"}
    )
    assert res.status_code == 400
    assert "which hand" in res.json()["detail"]
    # Nothing moved: it is still that player's turn.
    assert state(client, room_id, ids[0])["actorId"] == actor


def test_a_writer_that_lost_its_lease_cannot_overwrite_a_newer_room(client, clock):
    """Holding the lock at the start of a request proves nothing at the end.

    A slow store or a paused function can outlive the lease; by then somebody
    else may have taken it and dealt. The write itself has to be conditional on
    still owning the lock, or the late writer lands a stale room on top.
    """
    room_id, _ = table(client, 2)

    async def scenario():
        stale = await main.load_room(room_id)
        async with main._RoomLock(room_id) as lock:
            # The lease expires while this request is still working.
            await main.redis.delete(lock.key)

            # Somebody else picks the room up and moves it on.
            async with main._RoomLock(room_id):
                fresh = await main.load_room(room_id)
                fresh["name"] = "Moved on"
                await main.save_room(fresh)

            stale["name"] = "Stale"
            with pytest.raises(main.LockLost):
                await main.save_room(stale)
        return (await main.load_room(room_id))["name"]

    assert client.portal.call(scenario) == "Moved on"


def test_releasing_a_lock_never_deletes_the_next_holders(client):
    """Unlocking used to be GET-then-DELETE, which is two decisions, not one.

    Near expiry the value read is not the value deleted: the lease lapses, the
    next writer takes the key, and the previous holder deletes *their* lock —
    leaving the room unguarded while somebody believes they hold it.
    """

    async def scenario():
        first = main._RoomLock("ROOM")
        await first.__aenter__()
        await main.redis.delete(first.key)  # the lease lapses

        second = main._RoomLock("ROOM")
        await second.__aenter__()

        await first.__aexit__()  # must be a no-op now
        still_locked = await main.redis.get(main._lock_key("ROOM"))
        await second.__aexit__()
        return still_locked, second.token, await main.redis.get(main._lock_key("ROOM"))

    held, token, after = client.portal.call(scenario)
    assert held == token, "the previous holder deleted somebody else's lock"
    assert after is None, "the owner could not release its own lock"


def test_acting_undoes_a_bench_the_clock_imposed(client, clock):
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    room = client.portal.call(main.load_room, room_id)
    room["players"][actor]["sittingOut"] = True
    room["players"][actor]["autoSatOut"] = True
    client.portal.call(main.save_room, room)

    assert act(client, room_id, actor, "call").status_code == 200

    room = client.portal.call(main.load_room, room_id)
    assert room["players"][actor]["sittingOut"] is False
    assert room["players"][actor]["autoSatOut"] is False


def test_a_manual_sit_out_survives_acting(client, clock):
    """Choosing to sit out is not undone by finishing the current hand."""
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    room = client.portal.call(main.load_room, room_id)
    room["players"][actor]["sittingOut"] = True
    room["players"][actor]["autoSatOut"] = False
    client.portal.call(main.save_room, room)

    assert act(client, room_id, actor, "call").status_code == 200
    room = client.portal.call(main.load_room, room_id)
    assert room["players"][actor]["sittingOut"] is True


def test_sitting_back_in_restarts_the_deal_countdown(client, clock):
    """Coming back is what makes the table playable — it must re-arm dealing."""
    room_id, ids = table(client, 3, levelMinutes=0, actionSeconds=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    # Bench two of the three, leaving the table unable to deal.
    room = client.portal.call(main.load_room, room_id)
    for pid in ids[1:]:
        room["players"][pid]["sittingOut"] = True
    room["autoDealAt"] = None
    client.portal.call(main.save_room, room)

    clock.advance(120)
    assert state(client, room_id, ids[0])["room"]["phase"] == "handover"

    res = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[1]),
        json={"playerId": ids[1], "action": "sit"}
    )
    assert res.status_code == 200
    assert res.json()["autoDealAt"] is not None, "returning did not restart dealing"

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_sitting_back_in_clears_the_auto_sit_out(client, clock):
    room_id, ids = table(client, 3, levelMinutes=0)
    start(client, room_id, ids[0])
    for _ in range(40):
        clock.advance(25)
        view = state(client, room_id, ids[0])
        benched = [p for p in view["players"] if p["autoSatOut"]]
        if benched:
            break
    assert benched
    pid = benched[0]["id"]

    res = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(pid),
        json={"playerId": pid, "action": "sit"})
    assert res.status_code == 200
    me = next(p for p in res.json()["players"] if p["id"] == pid)
    assert me["sittingOut"] is False
    assert me["autoSatOut"] is False


# --------------------------------------------------------------------------- #
# Naming the winning hand
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "hole, board, expected",
    [
        (["Ah", "Kh"], ["Qh", "Jh", "Th", "2c", "3d"], "Royal flush"),
        (["9h", "8h"], ["7h", "6h", "5h", "2c", "3d"], "Straight flush, five to nine"),
        (["As", "Ad"], ["Ac", "Ah", "5h", "2c", "3d"], "Four of a kind, aces"),
        (["Ks", "Kd"], ["Kc", "3h", "3s", "2c", "7d"], "Full house, kings over threes"),
        (["As", "9s"], ["2s", "5s", "Ks", "7c", "3d"], "Flush, ace high"),
        (["Ad", "2h"], ["3s", "4c", "5d", "Kh", "9c"], "Straight, ace to five"),
        (["Td", "Jh"], ["Qs", "Kc", "Ad", "2h", "3c"], "Straight, ten to ace"),
        (["Qd", "6h"], ["Qs", "6c", "2d", "Jh", "9c"], "Two pair, queens and sixes"),
        (["Jd", "Jh"], ["2s", "6c", "9d", "Kh", "3c"], "Pair of jacks"),
        (["Ad", "9h"], ["2s", "6c", "Jd", "Kh", "3c"], "Ace high"),
        (["7d", "7h"], ["7s", "6c", "Jd", "Kh", "3c"], "Three of a kind, sevens"),
    ],
)
def test_hand_names(hole, board, expected):
    import poker

    assert poker.evaluate_hand(hole, board)["name"] == expected


def test_hand_name_is_none_before_the_river():
    import poker

    assert poker.evaluate_hand(["Ad", "9h"], ["2s"]) is None


def test_the_showdown_names_the_hands_it_turned_over(client, clock):
    """Every hand the showdown made face up, named, with the five that made it.

    Not every hand that reached it: `lastResults` says what a player was
    holding, so it answers to the same rule the cards do.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    # Nobody folds, so the hand is shown down.
    for _ in range(20):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand":
            break
        act(client, room_id, view["actorId"], "call")

    room = client.portal.call(main.load_room, room_id)
    face_up = {room["handPlayerIds"][s] for s in room["showSeats"]}
    assert face_up, "the hand was checked down; somebody had to show"
    results = state(client, room_id, ids[0])["lastResults"]
    assert len(results) == 2
    for entry in results:
        if entry["playerId"] in face_up:
            assert entry["handName"], f"no hand name for {entry['name']}"
            assert len(entry["handCards"]) == 5


def test_a_mucked_hand_is_not_named_in_the_results(client, clock):
    """The muck has to hold in the panel that comes up after every hand.

    `players[].cards` was filtered carefully and `lastResults` was not, so the
    hand a player threw away face down was named — with the five cards that
    made it — for the other players and for anybody watching. Everything on
    screen respected the muck except the one thing everybody reads.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    room = showdown_between(
        client, room_id, ids, {0: ["2c", "3d"], 1: ["As", "Ks"], 2: ["4h", "5h"]}
    )
    # Seat 2 is the worst hand and collected nothing, so it never turned over.
    assert 2 not in set(room["showSeats"])
    mucked = room["handPlayerIds"][2]

    for watcher in (room["handPlayerIds"][0], room["handPlayerIds"][1]):
        entry = next(
            r for r in state(client, room_id, watcher)["lastResults"]
            if r["playerId"] == mucked
        )
        assert "handName" not in entry
        assert "handCards" not in entry
        # What they are entitled to: who was in it and what it cost them.
        assert entry["name"] and "delta" in entry and "won" in entry

    # There is no anonymous spectator to check: the room is private and every
    # viewer is somebody at the table, which is why the two above are the
    # audience this has to hold against.
    assert client.get(f"/api/rooms/{room_id}/state").status_code == 403

    # Its owner still sees their own, which is the whole point of a muck.
    mine = next(
        r for r in state(client, room_id, mucked)["lastResults"]
        if r["playerId"] == mucked
    )
    assert mine["handCards"] and mine["handName"]


def test_a_hand_won_by_folding_names_nothing(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    view = state(client, room_id, ids[0])
    # No showdown happened, so no hand is revealed or named.
    assert all("handName" not in entry for entry in view["lastResults"])
    # And the table must be told, or it flips the winner's own cards face up.
    assert view["wentToShowdown"] is False


def test_a_shown_down_hand_says_so(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    for _ in range(20):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand":
            break
        act(client, room_id, view["actorId"], "call")
    assert state(client, room_id, ids[0])["wentToShowdown"] is True


def test_showdown_flag_is_false_while_a_hand_is_running(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    assert state(client, room_id, ids[0])["wentToShowdown"] is False


# --------------------------------------------------------------------------- #
# House rules: the 7-2 game
# --------------------------------------------------------------------------- #
def fold_everyone_but(client, room_id, winner):
    """Hand the pot to ``winner`` by folding the rest out.

    Two things make this fiddlier than it sounds. Preflop the button acts
    *first*, so "fold whoever is to act" would fold the very player meant to
    win. And nobody can fold when checking is free — so the winner has to put
    in a raise, or the big blind simply checks and the hand carries on to a
    showdown instead of being won on a fold.
    """
    raised = False
    for _ in range(20):
        view = state(client, room_id, winner)
        if view["room"]["phase"] != "hand" or not view["actorId"]:
            return view
        actor = view["actorId"]
        if actor == winner:
            legal = view["legal"]
            if not raised and legal and legal["canRaise"]:
                act(client, room_id, actor, "raise", legal["minRaise"])
                raised = True
            else:
                act(client, room_id, actor, "call")
            continue
        if act(client, room_id, actor, "fold").status_code != 200:
            act(client, room_id, actor, "call")
    raise AssertionError("hand did not finish")


# Something nobody could mistake for seven-deuce, for the seats a test is not
# interested in. Without it a random deal occasionally hands a second player a
# real 7-2 offsuit — a bit under one hand in a hundred — and a test that was
# asserting on one claimant quietly starts failing once a fortnight for a
# reason that has nothing to do with the code.
BLAND = ["Ac", "Kd"]


def rig_hand(client, room_id, seat, hole, others=BLAND):
    """Deal a known hand into a seat. The engine has already dealt; we only
    change the snapshot the settlement reads, which is what the rule uses.

    Every *other* seat is dealt something bland at the same time, so the test
    is asserting about the hand it planted rather than about the deck.
    """
    room = client.portal.call(main.load_room, room_id)
    for i in range(len(room["handHoleCards"])):
        room["handHoleCards"][i] = list(hole if i == seat else others)
    client.portal.call(main.save_room, room)
    return room


def showdown_leader(room):
    """The seat that will take the pot, worked out from the finished board.

    Only correct once all five cards are out — which is exactly when the tests
    below use it, on the last betting round, so the hand it names is the hand
    that wins.
    """
    from pokerkit import StandardHighHand

    board = "".join(main.poker.board_cards(main.poker.loads(room["stateB64"])))
    folded = set(room.get("foldedSeats", []))
    best = best_seat = None
    for seat, hole in enumerate(room["handHoleCards"]):
        if seat in folded:
            continue
        hand = StandardHighHand.from_game("".join(hole), board)
        if best is None or hand > best:
            best, best_seat = hand, seat
    return best_seat


def check_down_with_seven_deuce_for_the_winner(client, room_id, ids):
    """Play a hand to showdown, putting 7-2 in the hand that ends up winning.

    Deliberately without touching the settlement: the rig goes into the hole
    card snapshot on the river, *before* the last action, so the payout has to
    come out of ``_settle_hand`` on its own. A test that calls
    ``_pay_seven_deuce`` by hand would pass just as happily with that call
    deleted from the settlement, which is the one thing it claims to check.
    """
    dealt = list(client.portal.call(main.load_room, room_id)["handHoleCards"])
    for _ in range(30):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or not view["actorId"]:
            break
        if len(view["board"]) == 5:
            room = client.portal.call(main.load_room, room_id)
            # Restored first, so the leader is worked out from the hand that
            # was actually dealt rather than from the last rig.
            room["handHoleCards"] = list(dealt)
            leader = showdown_leader(room)
            # And everybody else is given something bland, so a deal that
            # happens to contain a second seven-deuce cannot turn this into a
            # two-claimant split once a fortnight.
            room["handHoleCards"] = [
                ["7h", "2c"] if i == leader else list(BLAND)
                for i in range(len(dealt))
            ]
            client.portal.call(main.save_room, room)
        act(client, room_id, view["actorId"], "call")
    return state(client, room_id, ids[0])


def test_seven_deuce_pays_out_at_showdown_without_anyone_asking(client, clock):
    """Shown down, the cards are already public, so the bonus needs no claim."""
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    before = {p["id"]: p["chips"] for p in state(client, room_id, ids[0])["players"]}
    start(client, room_id, ids[0])
    view = check_down_with_seven_deuce_for_the_winner(client, room_id, ids)

    assert view["wentToShowdown"]
    assert view["sevenDeuceWin"] is not None
    winner = view["sevenDeuceWin"]["playerId"]
    assert view["sevenDeuceWin"]["amount"] == 40  # two big blinds from each loser

    # Every stack moved by the bonus on top of whatever the pot did. Netting the
    # pot out again leaves exactly the transfer.
    pot_delta = {r["playerId"]: r["delta"] for r in view["lastResults"]}
    for player in view["players"]:
        moved = player["chips"] - before[player["id"]] - pot_delta[player["id"]]
        assert moved == (40 if player["id"] == winner else -20)


def test_winning_a_side_pot_counts_even_when_the_hand_lost_money(client, clock):
    """Winning a pot and finishing ahead are different questions.

    A short stack shoves for 90 while two others put in 100 each. The main pot
    is 270 and the side pot is 20. If the short stack takes the main and one of
    the others takes the side, that second player *won a pot* and is still 80
    down on the deal. Netting their stack calls them a loser and the 7-2 in
    their hand never gets paid.
    """
    room = {
        "handPlayerIds": ["short", "sider", "loser"],
        "foldedSeats": [],
        "lastResults": [
            {"playerId": "short", "delta": 180, "won": 270},
            {"playerId": "sider", "delta": -80, "won": 20},
            {"playerId": "loser", "delta": -100, "won": 0},
        ],
    }
    assert main._hand_winners(room) == {"short", "sider"}


def test_the_pot_pushes_are_read_off_the_engine(client, clock):
    """``won`` has to be the engine's answer, not a guess reconstructed here.

    Whatever left the players' stacks arrived somewhere, so the pushes add up
    to the pot — and every chip pushed went to somebody who was still in the
    hand.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    started = client.portal.call(main.load_room, room_id)["handStartStacks"]
    view = check_down_with_seven_deuce_for_the_winner(client, room_id, ids)

    room = client.portal.call(main.load_room, room_id)
    results = {r["playerId"]: r for r in view["lastResults"]}
    won = [results[pid]["won"] for pid in room["handPlayerIds"]]
    staked = sum(started) - sum(
        room["players"][pid]["chips"] - results[pid]["won"]
        for pid in room["handPlayerIds"]
    )
    assert sum(won) == staked
    assert sum(w > 0 for w in won) >= 1
    folded = set(room["foldedSeats"])
    assert all(w == 0 for seat, w in enumerate(won) if seat in folded)


def test_seven_deuce_is_claimed_by_showing_a_pot_won_by_folding(client, clock):
    """The whole point of the rule: the prize is for the bluff.

    A pot won by everyone folding is a pot nobody saw, so collecting means
    turning the 7-2 over. Keeping it face down means keeping the secret and
    passing on the money.
    """
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    # Whoever will win by folds gets the worst hand in poker.
    winner_seat = room["handPlayerIds"].index(room["handPlayerIds"][-1])
    rig_hand(client, room_id, winner_seat, ["7h", "2c"])
    winner = room["handPlayerIds"][winner_seat]

    fold_everyone_but(client, room_id, winner)

    view = state(client, room_id, winner)
    assert view["room"]["phase"] == "handover"
    assert view["sevenDeuceWin"] is None      # nothing yet: cards still down
    assert view["sevenDeucePending"] is True  # but it is there for the taking

    before = {p["id"]: p["chips"] for p in view["players"]}
    res = show(client, room_id, winner, [0, 1])
    assert res.status_code == 200
    after = state(client, room_id, winner)
    assert after["sevenDeuceWin"]["playerId"] == winner
    assert after["sevenDeuceWin"]["amount"] == 2 * 10 * 2  # two payers, 2 BB each
    seats = {p["id"]: p["chips"] for p in after["players"]}
    for pid in before:
        if pid == winner:
            assert seats[pid] == before[pid] + 40
        elif pid in room["handPlayerIds"]:
            assert seats[pid] == before[pid] - 20


def test_keeping_the_seven_deuce_face_down_collects_nothing(client, clock):
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    winner = room["handPlayerIds"][-1]
    rig_hand(client, room_id, len(room["handPlayerIds"]) - 1, ["7h", "2c"])
    fold_everyone_but(client, room_id, winner)
    # Showing only one card is not proof of anything.
    show(client, room_id, winner, [0])
    assert state(client, room_id, winner)["sevenDeuceWin"] is None


def test_a_chopped_pot_still_counts_as_winning_with_seven_deuce(client, clock):
    """An exact chop hands each side back what they put in.

    Measured on the delta alone, nobody "won" — so the rule quietly skipped
    every split pot, which is not a rare enough case to leave undefined.
    """
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    # Two players chop; the third folded.
    room["foldedSeats"] = [2]
    # Every seat, not just the one being planted: a random deal that hands
    # somebody else a real seven-deuce would make this a two-claimant split.
    for i in range(len(room["handHoleCards"])):
        room["handHoleCards"][i] = ["7h", "2c"] if i == 0 else list(BLAND)
    room["lastResults"] = [
        {"playerId": room["handPlayerIds"][0], "name": "a", "delta": 0},
        {"playerId": room["handPlayerIds"][1], "name": "b", "delta": 0},
        {"playerId": room["handPlayerIds"][2], "name": "c", "delta": -10},
    ]
    # Both halves of a chop collected, so the showdown turned both over. Part of
    # the state being planted and not a detail: the bonus is paid on cards the
    # table has seen, and reaching a showdown is not the same as being shown.
    room["showSeats"] = [0, 1]
    room["sevenDeucePaid"] = False
    before = {pid: p["chips"] for pid, p in room["players"].items()}
    main._pay_seven_deuce(room)

    winner = room["handPlayerIds"][0]
    assert room["sevenDeuceWin"]["playerId"] == winner
    assert room["players"][winner]["chips"] == before[winner] + 40
    assert sum(p["chips"] for p in room["players"].values()) == sum(before.values())


def test_two_seven_deuces_chopping_do_not_charge_each_other(client, clock):
    """Rare, but the arithmetic has to close: they split what the rest pay."""
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    room["foldedSeats"] = []
    room["handHoleCards"][0] = ["7h", "2c"]
    room["handHoleCards"][1] = ["7d", "2s"]
    room["lastResults"] = [
        {"playerId": room["handPlayerIds"][0], "name": "a", "delta": 0},
        {"playerId": room["handPlayerIds"][1], "name": "b", "delta": 0},
        {"playerId": room["handPlayerIds"][2], "name": "c", "delta": -20},
    ]
    room["showSeats"] = [0, 1]
    room["sevenDeucePaid"] = False
    before = {pid: p["chips"] for pid, p in room["players"].items()}
    main._pay_seven_deuce(room)

    a, b, c = room["handPlayerIds"]
    # The single payer owes each of them, and neither claimant pays anything.
    assert room["players"][c]["chips"] == before[c] - 40
    assert room["players"][a]["chips"] + room["players"][b]["chips"] == (
        before[a] + before[b] + 40
    )
    assert sum(p["chips"] for p in room["players"].values()) == sum(before.values())


def test_the_seven_deuce_bonus_is_only_paid_once(client, clock):
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    winner = room["handPlayerIds"][-1]
    rig_hand(client, room_id, len(room["handPlayerIds"]) - 1, ["7h", "2c"])
    fold_everyone_but(client, room_id, winner)

    show(client, room_id, winner, [0, 1])
    once = {p["id"]: p["chips"] for p in state(client, room_id, winner)["players"]}
    show(client, room_id, winner, [0, 1])  # tapping it again must change nothing
    twice = {p["id"]: p["chips"] for p in state(client, room_id, winner)["players"]}
    assert once == twice
    assert sum(once.values()) == 3000


def test_a_seven_deuce_bonus_that_busts_someone_takes_them_out(client, clock):
    """The trap: a transfer on top of the pot can empty a stack.

    A player taken to zero by the bonus has to leave like anyone else, or the
    tournament carries a ghost with no chips and never ends.
    """
    room_id, ids = table(client, 3, sevenDeuce=5, actionSeconds=0, levelMinutes=0)
    room = client.portal.call(main.load_room, room_id)
    room["players"][ids[1]]["chips"] = 30  # less than the 50-chip bonus
    client.portal.call(main.save_room, room)
    start(client, room_id, ids[0])

    room = client.portal.call(main.load_room, room_id)
    winner = room["handPlayerIds"][-1]
    rig_hand(client, room_id, len(room["handPlayerIds"]) - 1, ["7d", "2s"])
    fold_everyone_but(client, room_id, winner)
    show(client, room_id, winner, [0, 1])

    view = state(client, room_id, ids[0])
    short = next(p for p in view["players"] if p["id"] == ids[1])
    assert short["chips"] == 0
    assert short["out"] is True
    # Nobody ever owes chips they do not have, so the table still balances.
    assert sum(p["chips"] for p in view["players"]) == 2030


def test_the_rule_is_off_unless_the_host_turns_it_on(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    rig_hand(client, room_id, len(room["handPlayerIds"]) - 1, ["7h", "2c"])
    winner = room["handPlayerIds"][-1]
    fold_everyone_but(client, room_id, winner)
    show(client, room_id, winner, [0, 1])
    view = state(client, room_id, ids[0])
    assert view["sevenDeuceWin"] is None
    assert view["sevenDeucePending"] is False


def test_an_unclaimed_seven_deuce_is_never_broadcast(client, clock):
    """Telling the table a bonus is pending tells them what the winner holds.

    The rule only means anything because showing is a decision: prove the
    bluff and take the money, or keep the secret and let it go. A flag every
    seat can see makes that choice for them before they make it.
    """
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    seat = len(room["handPlayerIds"]) - 1
    rig_hand(client, room_id, seat, ["7h", "2c"])
    winner = room["handPlayerIds"][seat]
    fold_everyone_but(client, room_id, winner)

    assert state(client, room_id, winner)["sevenDeucePending"] is True
    for pid in room["handPlayerIds"]:
        if pid != winner:
            assert state(client, room_id, pid)["sevenDeucePending"] is False
    # And not to somebody watching from behind the table either.
    viewer = watch(client, room_id).json()["playerId"]
    assert state(client, room_id, viewer)["sevenDeucePending"] is False


def test_a_bomb_pot_replaces_the_ante_rather_than_stacking_on_it(client, clock):
    """Both configured is a real combination, and it needs one answer.

    A bomb pot already puts everybody in for the same amount, so charging an
    ante on top would be two forced bets for one hand. The bomb wins.
    """
    room_id, ids = table(
        client, 3, bombPotEvery=1, anteMode="bb", actionSeconds=0, levelMinutes=0
    )
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["pot"] == 3 * 10 * main.BOMB_POT_BLINDS
    assert all(p["chips"] == 1000 - 10 * main.BOMB_POT_BLINDS for p in view["players"])


def test_a_stack_too_short_for_the_bomb_ante_goes_all_in_for_it(client, clock):
    room_id, ids = table(client, 3, bombPotEvery=1, actionSeconds=0, levelMinutes=0)
    room = client.portal.call(main.load_room, room_id)
    room["players"][ids[1]]["chips"] = 7  # the bomb ante is 20
    client.portal.call(main.save_room, room)
    start(client, room_id, ids[0])

    view = state(client, room_id, ids[0])
    assert view["street"] == "flop"
    assert len(view["board"]) == 3
    assert chips_in_play(client, room_id) == 2007


def test_a_stack_too_short_for_the_straddle_goes_all_in_for_it(client, clock):
    room_id, ids = table(client, 3, straddle=True, actionSeconds=0, levelMinutes=0)
    room = client.portal.call(main.load_room, room_id)
    for pid in room["order"]:
        room["players"][pid]["chips"] = 12  # the straddle is 20
    client.portal.call(main.save_room, room)
    start(client, room_id, ids[0])
    assert chips_in_play(client, room_id) == 36


def test_a_heads_up_bomb_pot_still_reaches_the_flop(client, clock):
    room_id, ids = table(client, 2, bombPotEvery=1, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["street"] == "flop"
    assert chips_in_play(client, room_id) == 2000


@pytest.mark.parametrize(
    "hole, expected",
    [
        (["7h", "2c"], True),
        (["2c", "7h"], True),
        (["7h", "2h"], False),   # suited is not the 7-2 game
        (["7h", "3c"], False),
        (["Ah", "Kc"], False),
    ],
)
def test_what_counts_as_seven_deuce(hole, expected):
    assert main._is_seven_deuce(hole) is expected


# --------------------------------------------------------------------------- #
# House rules: straddle and bomb pots
# --------------------------------------------------------------------------- #
def test_the_straddle_posts_blind_and_acts_last(client, clock):
    """Two big blinds from under the gun, and the action starts past them."""
    room_id, ids = table(client, 4, straddle=True)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    view = state(client, room_id, ids[0])
    seats = {p["id"]: p for p in view["players"]}

    sb, bb, utg, button = [seats[pid] for pid in room["handPlayerIds"]]
    assert (sb["bet"], bb["bet"], utg["bet"]) == (5, 10, 20)
    assert utg["isStraddle"] is True
    # The straddler bought the last word preflop, so the button opens.
    assert view["actorId"] == button["id"]


def test_the_straddler_is_not_mistaken_for_the_big_blind(client, clock):
    """The reason positions stopped being deduced from the posted bets.

    Reading them back off the table takes the largest forced bet for the big
    blind, which with a straddle is simply wrong — and it is wrong on screen,
    on every seat badge at the table.
    """
    room_id, ids = table(client, 4, straddle=True)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    seats = {p["id"]: p for p in state(client, room_id, ids[0])["players"]}
    straddler = seats[room["handPlayerIds"][2]]
    assert straddler["isBigBlind"] is False
    assert seats[room["handPlayerIds"][1]]["isBigBlind"] is True
    # And the old deduction really would have got it wrong.
    engine_guess = main.poker.initial_positions(main.poker.loads(room["stateB64"]))
    assert engine_guess["bb"] != room["positions"]["bb"]


def test_heads_up_has_no_straddle_to_post(client, clock):
    """Both seats are already blinds; there is no under the gun to be."""
    room_id, ids = table(client, 2, straddle=True)
    start(client, room_id, ids[0])
    bets = sorted(p["bet"] for p in state(client, room_id, ids[0])["players"])
    assert bets == [5, 10]


def test_a_bomb_pot_skips_preflop_and_starts_on_the_flop(client, clock):
    room_id, ids = table(client, 3, bombPotEvery=1, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])

    assert view["room"]["bombPot"] is True
    assert len(view["board"]) == 3          # straight to the flop
    assert view["street"] == "flop"
    assert view["pot"] == 3 * 10 * main.BOMB_POT_BLINDS
    assert all(p["chips"] == 1000 - 10 * main.BOMB_POT_BLINDS for p in view["players"])
    # Everyone paid the same, so nobody is a blind.
    assert not any(p["isSmallBlind"] or p["isBigBlind"] for p in view["players"])
    assert chips_in_play(client, room_id) == 3000


def test_nobody_ever_sees_the_phantom_preflop_of_a_bomb_pot(client, clock):
    """It is checked around inside _start_hand, before the room is ever saved."""
    room_id, ids = table(client, 3, bombPotEvery=1, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    # The very first stored state of the hand is already on the flop.
    assert len(main.poker.board_cards(main.poker.loads(room["stateB64"]))) == 3


def test_bomb_pots_land_on_the_hands_the_host_asked_for(client, clock):
    room_id, ids = table(client, 3, bombPotEvery=3, actionSeconds=0, levelMinutes=0)
    seen = []
    for _ in range(6):
        start(client, room_id, ids[0])
        room = client.portal.call(main.load_room, room_id)
        seen.append((room["handNumber"], room["bombPot"]))
        fold_until_hand_over(client, room_id, ids)
    assert [hand for hand, bomb in seen if bomb] == [3, 6]


def test_a_bomb_pot_still_plays_out_normally_after_the_flop(client, clock):
    room_id, ids = table(client, 3, bombPotEvery=1, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] in ("handover", "finished")
    assert chips_in_play(client, room_id) == 3000


# --------------------------------------------------------------------------- #
# Antes
# --------------------------------------------------------------------------- #
def chips_in_play(client, room_id):
    """Every chip on the table: stacks, the pot, and what is out on the felt."""
    view = state(client, room_id, client.portal.call(main.load_room, room_id)["hostId"])
    return sum(p["chips"] for p in view["players"]) + view["pot"] + sum(
        p["bet"] for p in view["players"]
    )


def test_no_ante_by_default(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    assert state(client, room_id, ids[0])["room"]["ante"] == 0
    assert chips_in_play(client, room_id) == 3000


def test_the_big_blind_ante_is_posted_by_one_player_for_the_table(client, clock):
    """One seat posts for everyone — the modern structure.

    It also needs ``ante_trimming_status`` off: trimming exists to equalise
    antes between players, so with it on a one-player ante is quietly trimmed
    to nothing and never posted at all.
    """
    room_id, ids = table(client, 3, anteMode="bb")
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["room"]["ante"] == 10

    room = client.portal.call(main.load_room, room_id)
    seats = {p["id"]: p for p in view["players"]}
    bb = seats[room["handPlayerIds"][1]]
    others = [seats[pid] for pid in room["handPlayerIds"][2:]]
    # Blind plus ante out of the big blind's stack, and nothing from the rest.
    assert bb["chips"] == 1000 - 10 - 10
    assert all(p["chips"] == 1000 for p in others)
    assert view["pot"] == 10  # the ante is collected; the blinds are still out
    assert chips_in_play(client, room_id) == 3000


def test_a_table_wide_ante_is_taken_from_everyone(client, clock):
    room_id, ids = table(client, 3, anteMode="all", smallBlind=40, bigBlind=80)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["room"]["ante"] == 10  # an eighth of the big blind
    assert view["pot"] == 30
    assert chips_in_play(client, room_id) == 3000


def test_the_ante_climbs_with_the_blinds(client, clock):
    """Tied to the big blind, so it follows the ladder without its own setting."""
    room_id, ids = table(client, 3, anteMode="bb", levelMinutes=1, actionSeconds=0)
    start(client, room_id, ids[0])
    assert state(client, room_id, ids[0])["room"]["ante"] == 10
    fold_until_hand_over(client, room_id, ids)
    clock.advance(61)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    assert view["room"]["bigBlind"] == 20
    assert view["room"]["ante"] == 20


def test_a_stack_too_short_for_the_ante_posts_what_it_has(client, clock):
    """The end of a tournament is exactly when antes start to bite."""
    room_id, ids = table(client, 3, anteMode="bb", actionSeconds=0, levelMinutes=0)
    room = client.portal.call(main.load_room, room_id)
    # Leave the seat that will post the ante with less than it owes.
    room["players"][ids[1]]["chips"] = 6
    client.portal.call(main.save_room, room)
    start(client, room_id, ids[0])
    assert chips_in_play(client, room_id) == 2006


# --------------------------------------------------------------------------- #
# Removing a player
# --------------------------------------------------------------------------- #
def kick(client, room_id, host, target):
    return client.post(
        f"/api/rooms/{room_id}/kick",
        headers=auth(host),
        json={"playerId": host, "targetId": target},
    )


def test_the_host_can_remove_a_player_between_hands(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    assert kick(client, room_id, ids[0], ids[2]).status_code == 200
    view = state(client, room_id, ids[0])
    assert [p["id"] for p in view["players"]] == ids[:2]


def test_nobody_is_removed_from_a_live_hand(client, clock):
    """Pulling a seat out from under a half-played pot is worse than waiting."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    res = kick(client, room_id, ids[0], ids[2])
    assert res.status_code == 400
    assert "finish" in res.json()["detail"]


def test_only_the_host_shows_anyone_the_door(client, clock):
    room_id, ids = table(client, 3)
    assert kick(client, room_id, ids[1], ids[2]).status_code == 403


def test_the_host_cannot_remove_themselves(client, clock):
    room_id, ids = table(client, 3)
    assert kick(client, room_id, ids[0], ids[0]).status_code == 400


def test_a_removed_player_still_has_a_finishing_place(client, clock):
    """Leaving early is still a finish. Forgetting them rewrites the night.

    Checking bustOrder alone proves nothing a player would ever see — what
    matters is the podium at the end, so this reads that instead.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    kick(client, room_id, ids[0], ids[2])
    kick(client, room_id, ids[0], ids[1])

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    places = {s["playerId"]: s["place"] for s in view["standings"]}
    assert set(places) == set(ids)
    # Removed later is a better finish than removed earlier.
    assert places[ids[1]] < places[ids[2]]


def test_removing_the_button_keeps_the_blinds_going_round(client, clock):
    """Not just "the next hand deals" — it has to deal to the *right* seat.

    Clearing the button on the way out sends it to an arbitrary place and the
    blinds stop rotating evenly, which is the exact defect this file already
    fixed once.
    """
    room_id, ids = table(client, 4, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    button = room["buttonId"]
    if button == ids[0]:
        pytest.skip("the host holds the button; they cannot remove themselves")

    # Whoever sits after the button, skipping the seat that is leaving.
    seating = list(room["order"])
    at = seating.index(button)
    expected = next(
        seating[(at + step) % len(seating)]
        for step in range(1, len(seating))
        if seating[(at + step) % len(seating)] != button
    )

    assert kick(client, room_id, ids[0], button).status_code == 200
    assert start(client, room_id, ids[0]).status_code == 200
    after = client.portal.call(main.load_room, room_id)
    # The button carries on to the seat that was next, not to wherever the
    # arithmetic happens to land.
    assert after["buttonId"] == expected


def test_a_seat_freed_in_the_lobby_is_handed_to_the_next_arrival(client, clock):
    """Two people must never share a seat, and no seat may exceed the table.

    Numbering from the size of the table hands the next arrival a chair that is
    already occupied. Numbering from the highest one used avoids that and
    creates the opposite problem — seats climb past the nine this table has,
    and keep climbing with every arrival and departure.
    """
    room_id, ids = table(client, 3)
    assert kick(client, room_id, ids[0], ids[1]).status_code == 200
    late = join(client, room_id, "Late")["playerId"]

    room = client.portal.call(main.load_room, room_id)
    seats = [room["players"][pid]["seat"] for pid in room["order"]]
    assert len(set(seats)) == len(seats), "two players cannot share a chair"
    assert all(0 <= s < main.MAX_SEATS for s in seats)
    assert room["players"][late]["seat"] == 1  # the chair that was freed

    # And churn does not run the numbers away: fill, empty, refill.
    for _ in range(main.MAX_SEATS - len(room["order"])):
        join(client, room_id, "Filler")
    room = client.portal.call(main.load_room, room_id)
    assert sorted(room["players"][pid]["seat"] for pid in room["order"]) == list(
        range(main.MAX_SEATS)
    )


def test_being_shown_the_door_is_not_undone_by_pressing_join(client, clock):
    """Otherwise removing somebody lasts until they tap the button again.

    The password is no help here: everybody at the table has it, including the
    person who was just asked to leave. The credential is the only thing that
    tells that device from a stranger's, so it is the thing that has to be
    turned away.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0, lateEntryLevels=9)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert kick(client, room_id, ids[0], ids[2]).status_code == 200

    res = client.post(
        f"/api/rooms/{room_id}/join",
        headers=auth(ids[2]),
        json={"name": "Back Again", "password": "secret"},
    )
    assert res.status_code == 410
    assert "removed you" in res.json()["detail"]
    assert len(client.portal.call(main.load_room, room_id)["order"]) == 2


def test_being_shown_the_door_in_the_lobby_shuts_it_too(client, clock):
    """Kicked before a card is dealt is still kicked."""
    room_id, ids = table(client, 3)
    assert kick(client, room_id, ids[0], ids[2]).status_code == 200
    res = client.post(
        f"/api/rooms/{room_id}/join",
        headers=auth(ids[2]),
        json={"name": "Back Again", "password": "secret"},
    )
    assert res.status_code == 410


def test_leaving_of_your_own_accord_leaves_the_door_open(client, clock):
    """Going home early is not a ban.

    Both doors mark the record the same way — the seat and the chips go — so
    the one thing that separates them has to be written down, or changing your
    mind about an early night is refused as if the host had thrown you out.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0, lateEntryLevels=9)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert leave(client, room_id, ids[2]).status_code == 200

    res = client.post(
        f"/api/rooms/{room_id}/join",
        headers=auth(ids[2]),
        json={"name": "Changed My Mind", "password": "secret"},
    )
    assert res.status_code == 200
    assert res.json()["playerId"] != ids[2], "a closed seat, so a new one"
    assert len(client.portal.call(main.load_room, room_id)["order"]) == 3


def test_a_chair_empties_when_its_player_goes(client, clock):
    """A record is a memory; it does not keep sitting in the chair.

    Counting every record ever created runs a nine-seat table out of seats
    after nine departures — and it is the *replacements* who are turned away,
    at a table with two people at it.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0, lateEntryLevels=9)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    going = ids[2]
    for _ in range(main.MAX_SEATS + 2):
        assert leave(client, room_id, going).status_code == 200
        going = join(client, room_id, "Next")["playerId"]

    room = client.portal.call(main.load_room, room_id)
    seats = [room["players"][pid]["seat"] for pid in room["order"]]
    assert len(room["order"]) == 3
    assert len(set(seats)) == len(seats), "two players cannot share a chair"
    assert all(0 <= s < main.MAX_SEATS for s in seats)


def test_nobody_is_removed_once_the_podium_is_written(client, clock):
    """The placings are already decided. Removing somebody now rewrites them.

    A player kicked after the end would be recorded with a zeroed stack and
    re-ranked, which quietly demotes whoever won the night.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    # Both challengers run out of chips, so the next deal has nowhere to go and
    # the tournament closes itself.
    room = client.portal.call(main.load_room, room_id)
    for pid in ids[1:]:
        room["players"][pid]["chips"] = 0
    client.portal.call(main.save_room, room)
    assert start(client, room_id, ids[0]).status_code == 400

    before = client.portal.call(main.load_room, room_id)["standings"]
    assert before, "the tournament has to be over for this to mean anything"
    res = kick(client, room_id, ids[0], ids[1])
    assert res.status_code == 400
    assert "already over" in res.json()["detail"]
    assert client.portal.call(main.load_room, room_id)["standings"] == before


def test_removing_the_second_to_last_player_ends_the_tournament(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    kick(client, room_id, ids[0], ids[1])
    kick(client, room_id, ids[0], ids[2])
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert view["standings"][0]["playerId"] == ids[0]


# --------------------------------------------------------------------------- #
# Spectators
# --------------------------------------------------------------------------- #
def watch(client, room_id, password="secret"):
    res = client.post(f"/api/rooms/{room_id}/watch", json={"password": password})
    if res.status_code == 200:
        out = res.json()
        TOKENS[out["playerId"]] = out["token"]
    return res


def test_a_spectator_sees_the_table_but_nobody_s_cards(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    viewer = watch(client, room_id).json()["playerId"]

    view = state(client, room_id, viewer)
    assert view["you"] is None
    assert view["legal"] is None
    # Every hand at the table is somebody else's.
    assert all(p["cards"] is None for p in view["players"])
    assert all(p["cardsCount"] == 2 for p in view["players"])


def test_a_spectator_sees_a_showdown_like_everyone_else(client, clock):
    """Cards turned face up are public. A spectator is part of that public."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    viewer = watch(client, room_id).json()["playerId"]
    fold_until_hand_over(client, room_id, ids)

    view = state(client, room_id, viewer)
    if view["wentToShowdown"]:
        assert any(p["cards"] for p in view["players"])


def test_watching_still_needs_the_password(client, clock):
    room_id, _ = table(client, 2)
    assert watch(client, room_id, password="wrong").status_code == 403


def test_a_spectator_never_joins_the_table(client, clock):
    room_id, ids = table(client, 3)
    before = client.portal.call(main.load_room, room_id)
    viewer = watch(client, room_id).json()["playerId"]
    # Polling as a spectator runs the clocks, which is fine and wanted — but it
    # must never write them into the room.
    state(client, room_id, viewer)
    after = client.portal.call(main.load_room, room_id)
    assert list(after["players"]) == list(before["players"])
    assert after["order"] == before["order"]
    assert viewer not in after["players"]


def test_spectators_do_not_use_up_seats(client, clock):
    room_id, _ = table(client, main.MAX_SEATS)
    assert watch(client, room_id).status_code == 200


# --------------------------------------------------------------------------- #
# Showing cards
# --------------------------------------------------------------------------- #
def show(client, room_id, player_id, indices, hand=None):
    return client.post(
        f"/api/rooms/{room_id}/show",
        headers=auth(player_id),
        json={
            "playerId": player_id,
            "indices": indices,
            # Every real client stamps the hand it meant; so does the helper.
            "handNumber": hand_number(client, room_id) if hand is None else hand,
        },
    )


def seat_of(client, room_id, player_id, viewer):
    return next(p for p in state(client, room_id, viewer)["players"] if p["id"] == player_id)


def test_you_can_turn_over_one_card_and_keep_the_other(client, clock):
    """Showing one card is a move, not a half-measure — it has to be possible."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    shower = room["handPlayerIds"][0]
    real = room["handHoleCards"][0]

    assert show(client, room_id, shower, [0]).status_code == 200
    watcher = next(p for p in ids if p != shower)
    seen = seat_of(client, room_id, shower, watcher)
    assert seen["cards"] == [real[0], None]

    # The second card can follow; the first one is already public.
    assert show(client, room_id, shower, [1]).status_code == 200
    assert seat_of(client, room_id, shower, watcher)["cards"] == real


def test_showing_is_only_ever_your_own_hand(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    a, b = room["handPlayerIds"][0], room["handPlayerIds"][1]
    # There is no field for whose hand to show, and that is the point: the
    # route only ever acts on the caller's own seat.
    show(client, room_id, a, [0, 1])
    assert seat_of(client, room_id, b, a)["cards"] is None


def test_a_new_deal_takes_shown_cards_back_off_the_table(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    shower = room["handPlayerIds"][0]
    show(client, room_id, shower, [0, 1])

    start(client, room_id, ids[0])
    watcher = next(p for p in ids if p != shower)
    assert seat_of(client, room_id, shower, watcher)["cards"] is None


def test_showing_says_which_hand_it_meant(client, clock):
    """A request delayed in the network is about the hand it was made for.

    Without a stamp, "show my bluff" that arrives late becomes "turn over the
    hand I am about to play" — the same failure /action already guards against.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    shower = room["handPlayerIds"][0]

    unstamped = client.post(
        f"/api/rooms/{room_id}/show",
        headers=auth(shower),
        json={"playerId": shower, "indices": [0]},
    )
    assert unstamped.status_code == 400
    # A stamp from an earlier hand is refused rather than applied to this one.
    assert show(client, room_id, shower, [0], hand=room["handNumber"] - 1).status_code == 409
    assert seat_of(client, room_id, shower, ids[1])["cards"] is None


def test_somebody_removed_from_the_table_cannot_still_collect(client, clock):
    """The 7-2 pays into a stack. Somebody shown the door has not got one.

    Their id stays in the hand that was played, so the seat check alone lets
    them claim afterwards — and the bonus then moves chips off the table into
    a player who has already left.
    """
    room_id, ids = table(client, 4, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    seat = len(room["handPlayerIds"]) - 1
    winner = room["handPlayerIds"][seat]
    if winner == ids[0]:
        pytest.skip("the host cannot remove themselves")
    rig_hand(client, room_id, seat, ["7h", "2c"])
    fold_everyone_but(client, room_id, winner)

    total_before = sum(
        p["chips"] for p in state(client, room_id, ids[0])["players"]
    )
    assert kick(client, room_id, ids[0], winner).status_code == 200
    assert show(client, room_id, winner, [0, 1]).status_code == 410

    view = state(client, room_id, ids[0])
    assert view["sevenDeuceWin"] is None
    # Only the chips the removal itself took with it.
    assert sum(p["chips"] for p in view["players"]) < total_before


def test_a_live_hand_cannot_be_shown_while_it_is_being_played(client, clock):
    """The one thing showing must never do is help somebody still deciding."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    res = show(client, room_id, room["handPlayerIds"][0], [0])
    assert res.status_code == 400


def fold_the_actor(client, room_id, viewer):
    """Fold whoever is on the clock and return their id. The hand carries on."""
    actor = state(client, room_id, viewer)["actorId"]
    assert act(client, room_id, actor, "fold").status_code == 200
    return actor


def test_a_folded_player_picks_what_to_show_without_it_reaching_the_table(client, clock):
    """The decision is made on the fold; the cards cannot appear until the end.

    Both halves matter. Asking two minutes later, when the pot has been pushed
    and the table has moved on, is asking at the wrong moment — but a card
    turned over while there is still betting to come is a card the players
    still in the hand get to use.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    folder = fold_the_actor(client, room_id, ids[0])
    watcher = next(p for p in ids if p != folder)

    assert show(client, room_id, folder, [0]).status_code == 200
    # Nobody can see it, and that includes the fact that it was asked for.
    assert seat_of(client, room_id, folder, watcher)["cards"] is None
    assert seat_of(client, room_id, folder, watcher)["shownIndices"] == []
    assert seat_of(client, room_id, folder, watcher)["pendingShowIndices"] == []
    # You can see your own plan, which is the only way to change your mind.
    assert seat_of(client, room_id, folder, folder)["pendingShowIndices"] == [0]


def test_the_card_a_folded_player_picked_turns_over_when_the_hand_settles(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    folder = fold_the_actor(client, room_id, ids[0])
    real = client.portal.call(main.load_room, room_id)["handHoleCards"][
        client.portal.call(main.load_room, room_id)["handPlayerIds"].index(folder)
    ]
    assert show(client, room_id, folder, [1]).status_code == 200

    fold_until_hand_over(client, room_id, ids)
    watcher = next(p for p in ids if p != folder)
    assert seat_of(client, room_id, folder, watcher)["cards"] == [None, real[1]]


def test_a_plan_to_show_can_be_taken_back_while_it_is_still_a_plan(client, clock):
    """Nothing has happened yet, so the undo is real — and a decision you
    cannot reverse is one nobody will risk making in the two seconds they
    have."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    folder = fold_the_actor(client, room_id, ids[0])

    show(client, room_id, folder, [0, 1])
    assert show(client, room_id, folder, []).status_code == 200
    assert seat_of(client, room_id, folder, folder)["pendingShowIndices"] == []

    fold_until_hand_over(client, room_id, ids)
    watcher = next(p for p in ids if p != folder)
    assert seat_of(client, room_id, folder, watcher)["cards"] is None


def test_after_the_hand_there_is_nothing_to_take_back(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    shower = client.portal.call(main.load_room, room_id)["handPlayerIds"][0]
    assert show(client, room_id, shower, []).status_code == 400


def test_somebody_who_was_not_in_the_hand_cannot_show(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    # With no chips in front of them they are not dealt in — which is now the
    # only way to be at the table and out of the hand. Sitting out is not: an
    # absent player is dealt in and blinded like everybody else.
    bust(client, room_id, ids[2])
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert show(client, room_id, ids[2], [0]).status_code == 403


# --------------------------------------------------------------------------- #
# Rabbit hunt
# --------------------------------------------------------------------------- #
def test_the_rabbit_hunt_deals_the_board_that_never_came(client, clock):
    """It has to be the real board, or the feature is a lie worth nothing.

    pokerkit burns a card before every street, so the flop is not the top three
    cards off the deck — it is the three after the burn. This walks the same
    deck the engine would have and checks it against what the engine actually
    deals when the hand is allowed to continue.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])

    # Read the deck mid-hand, then let the same hand run on and compare.
    room = client.portal.call(main.load_room, room_id)
    state = main.poker.loads(room["stateB64"])
    predicted = main.poker.would_have_come(state)
    assert [s["street"] for s in predicted] == ["flop", "turn", "river"]

    # Play the hand out on a copy of the very same state, so the engine deals
    # the board it would have dealt. Comparing against a hand that ended
    # preflop compares against an empty list, which passes however wrong the
    # burn arithmetic is — that is what the first version of this test did.
    replay = main.poker.loads(room["stateB64"])
    guard = 0
    while replay.status and replay.actor_index is not None and guard < 60:
        replay.check_or_call()
        guard += 1
    board = main.poker.board_cards(replay)
    assert len(board) == 5, "the replay has to reach the river to prove anything"
    dealt = [c for street in predicted for c in street["cards"]]
    assert dealt == board


def test_the_rabbit_hunt_only_covers_the_streets_still_missing(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    res = client.get(f"/api/rooms/{room_id}/rabbit", headers=auth(ids[0]))
    assert res.status_code == 200, res.text
    board = state(client, room_id, ids[0])["board"]
    expected = {0: 3, 3: 2, 4: 1, 5: 0}[len(board)]
    assert len(res.json()["streets"]) == expected


def test_the_rabbit_hunt_refuses_to_run_while_anyone_can_still_act(client, clock):
    """The deck it reads from is the unplayed future.

    Serving it mid-hand would hand a player the turn card before they bet on
    it, which is the one way this feature could break the game.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    res = client.get(f"/api/rooms/{room_id}/rabbit", headers=auth(ids[0]))
    assert res.status_code == 400
    assert "finish" in res.json()["detail"]


def test_the_rabbit_hunt_does_not_touch_the_room(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    before = client.portal.call(main.load_room, room_id)
    client.get(f"/api/rooms/{room_id}/rabbit", headers=auth(ids[0]))
    assert client.portal.call(main.load_room, room_id) == before


# --------------------------------------------------------------------------- #
# The button
# --------------------------------------------------------------------------- #
def _deal_sequence(seats, busts=None):
    """Small blind for each of ten hands, with players leaving along the way.

    ``busts`` maps a hand number to the player who is gone from that hand on.
    """
    busts = busts or {}
    room = {"order": list(seats), "buttonId": None}
    field = list(seats)
    small_blinds = []
    for hand in range(10):
        if hand in busts:
            field = [p for p in field if p != busts[hand]]
        room["buttonId"] = main._next_button(room, field)
        small_blinds.append((main._seat_order(room["buttonId"], field)[0], list(field)))
    return small_blinds


def test_the_button_advances_one_seat_per_hand():
    assert [sb for sb, _ in _deal_sequence("ABCDE")] == list("ABCDEABCDE")


def test_the_button_keeps_advancing_when_a_player_busts():
    """Losing a player must not send the button backwards or skip a live seat.

    Deriving the opening seat from ``handNumber % len(eligible)`` — which is what
    this used to do — jumped to an arbitrary seat every time the field changed
    size, so the blinds stopped going round evenly.
    """
    sequence = _deal_sequence("ABCDE", busts={6: "C"})
    for (previous, _), (current, field) in zip(sequence, sequence[1:]):
        if previous not in field:
            continue  # they left; the button moved past their empty seat
        expected = field[(field.index(previous) + 1) % len(field)]
        assert current == expected, f"{previous} -> {current}, expected {expected}"


def test_everyone_still_at_the_table_pays_the_same_blinds():
    sequence = _deal_sequence("ABCDE", busts={6: "C"})
    survivors = [p for p in "ABDE"]
    counts = [sum(1 for sb, _ in sequence if sb == p) for p in survivors]
    assert max(counts) - min(counts) <= 1, dict(zip(survivors, counts))


def test_heads_up_the_button_is_the_small_blind(client, clock):
    """Heads-up the button posts the small blind and acts first preflop.

    Asserted against the **money and the action**, not against the seat order.
    The old version of this test checked `_seat_order` returned the button
    first, which was the plan — and the plan was wrong, because pokerkit
    reverses the blinds with two players. Every assertion passed while the
    dealer posted the big blind, the other player posted the small, and the big
    blind opened the hand. A test that only checks what we meant cannot catch
    being wrong about what the engine does.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    seats = {p["id"]: p for p in view["players"]}
    button = next(p for p in view["players"] if p["isButton"])

    assert button["isSmallBlind"] is True, "heads-up the button is the small blind"
    assert button["isBigBlind"] is False
    # The money, which is the half that was wrong.
    assert button["bet"] == view["room"]["smallBlind"]
    other = next(p for p in view["players"] if not p["isButton"])
    assert other["isBigBlind"] is True
    assert other["bet"] == view["room"]["bigBlind"]
    # And the action: the button opens before the flop.
    assert view["actorId"] == button["id"], "the button acts first preflop"
    assert seats[view["actorId"]]["isSmallBlind"] is True


def test_heads_up_the_button_acts_last_after_the_flop(client, clock):
    """The other half of the rule, and the half that changes hands.

    Preflop the button is in first because they are the small blind; from the
    flop on they are last, because position follows the button and not the
    blind. Getting the seat order backwards swaps both at once, so both are
    checked.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    button_id = next(p["id"] for p in view["players"] if p["isButton"])

    act(client, room_id, button_id, "call")  # button completes
    view = state(client, room_id, ids[0])
    act(client, room_id, view["actorId"], "call")  # big blind checks their option

    view = state(client, room_id, ids[0])
    assert len(view["board"]) == 3, view["board"]
    assert view["actorId"] != button_id, "the big blind is first to act on the flop"


def test_heads_up_the_big_blind_ante_comes_out_of_the_big_blind(client, clock):
    """Which is a different seat heads-up than at a full table.

    ``create_hand`` posts it by index, and heads-up index 0 is the big blind
    rather than index 1 — so the obvious constant takes it off the button.
    """
    room_id, ids = table(client, 2, anteMode="bb", actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    big = next(p for p in view["players"] if p["isBigBlind"])
    button = next(p for p in view["players"] if p["isButton"])
    ante = view["room"]["ante"]
    assert ante > 0
    # The big blind is down their blind and the ante; the button only their own.
    assert big["chips"] == view["room"]["startingChips"] - big["bet"] - ante
    assert button["chips"] == view["room"]["startingChips"] - button["bet"]


def test_the_seat_order_is_what_pokerkit_posts_blinds_in():
    """The unit underneath, stated in the direction that is actually true."""
    # Three or more: small blind first, button last.
    assert main._seat_order("D", ["A", "B", "C", "D"]) == ["A", "B", "C", "D"]
    assert main._seat_order("B", ["A", "B", "C", "D"]) == ["C", "D", "A", "B"]
    # Heads-up: the *non*-button seat first, because pokerkit charges index 0
    # the big blind with two players.
    assert main._seat_order("A", ["A", "B"]) == ["B", "A"]
    assert main._seat_order("B", ["A", "B"]) == ["A", "B"]


def test_positions_are_recorded_not_deduced(client, clock):
    """The seat order is built small-blind-first, so the positions are known.

    Reading them back off the posted bets only works while blinds are the only
    forced bets on the table — a straddle or a bomb pot ante breaks that.
    """
    room_id, ids = table(client, 4)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    assert room["positions"] == {"sb": 0, "bb": 1, "button": 3, "straddle": -1}
    assert room["handPlayerIds"][3] == room["buttonId"]

    view = state(client, room_id, ids[0])
    seats = {p["id"]: p for p in view["players"]}
    assert seats[room["handPlayerIds"][0]]["isSmallBlind"] is True
    assert seats[room["handPlayerIds"][1]]["isBigBlind"] is True
    assert seats[room["buttonId"]]["isButton"] is True


def test_the_button_survives_the_field_changing_size(client, clock):
    """End to end, with somebody stepping out halfway — the discriminating case.

    A field that never changes size rotates correctly under either algorithm.
    Sitting a player out is the cheap way to change it mid-run.
    """
    room_id, ids = table(client, 4, actionSeconds=0, levelMinutes=0)
    seen = []
    for hand in range(6):
        start(client, room_id, ids[0])
        room = client.portal.call(main.load_room, room_id)
        seen.append((room["handPlayerIds"][0], list(room["handPlayerIds"])))
        fold_until_hand_over(client, room_id, ids)
        if hand == 1:
            assert client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[3]),
        json={"playerId": ids[3], "action": "sit"},
            ).status_code == 200

    assert all(a[0] != b[0] for a, b in zip(seen, seen[1:])), seen
    for (previous, _), (current, field) in zip(seen, seen[1:]):
        if previous not in field:
            continue
        expected = field[(field.index(previous) + 1) % len(field)]
        assert current == expected, f"{previous} -> {current}, expected {expected}"


# --------------------------------------------------------------------------- #
# Stacks
# --------------------------------------------------------------------------- #
def test_a_wager_comes_off_the_stack_straight_away(client, clock):
    """The number under a name has to be what that player could still bet.

    The room's copy of everyone's chips is only rewritten when the hand
    settles, so the view reads the engine instead. Serving the stored copy
    showed every stack as it was before the first blind went in, for the whole
    hand.
    """
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])

    view = state(client, room_id, ids[0])
    sb = next(p for p in view["players"] if p["isSmallBlind"])
    bb = next(p for p in view["players"] if p["isBigBlind"])
    assert (sb["chips"], sb["bet"]) == (995, 5)
    assert (bb["chips"], bb["bet"]) == (990, 10)

    actor = view["actorId"]
    assert act(client, room_id, actor, "raise", 100).status_code == 200
    raiser = next(
        p for p in state(client, room_id, ids[0])["players"] if p["id"] == actor
    )
    assert (raiser["chips"], raiser["bet"]) == (900, 100)


def test_an_all_in_player_reads_as_empty_before_the_hand_ends(client, clock):
    """Nothing left behind the line is what makes the all-in badge appear."""
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    assert act(client, room_id, actor, "raise", 1000).status_code == 200

    shoved = next(
        p for p in state(client, room_id, ids[0])["players"] if p["id"] == actor
    )
    assert (shoved["chips"], shoved["bet"]) == (0, 1000)
    # Broke for this hand, not eliminated: the pot has not been pushed yet.
    assert shoved["out"] is False
    assert shoved["inHand"] is True


def test_the_stack_settles_to_the_stored_total_once_the_hand_is_over(client, clock):
    """The two sources of truth must agree the moment the hand closes."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    view = state(client, room_id, ids[0])
    stored = client.portal.call(main.load_room, room_id)["players"]
    for player in view["players"]:
        assert player["chips"] == stored[player["id"]]["chips"]
    assert sum(p["chips"] for p in view["players"]) == 3000


# --------------------------------------------------------------------------- #
# Who is who
# --------------------------------------------------------------------------- #
def test_naming_a_seat_does_not_get_you_into_it(client, clock):
    """The hole this closes: every id at the table is public, by necessity.

    Clients need them to say whose seat is whose, so the table hands them out
    to anyone who asks. When the id was also the credential, that meant the
    room code alone was enough to read the seating off an anonymous request,
    put somebody else's id on the next one, and be dealt their hand.
    """
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])

    # The harder case: somebody who legitimately got in as an onlooker. They
    # have the password, so redaction is the only thing between them and
    # everybody's cards.
    ticket = {main.PLAYER_TOKEN_HEADER: watch(client, room_id).json()["token"]}
    seen = client.get(f"/api/rooms/{room_id}/state", headers=ticket).json()
    stolen = [p["id"] for p in seen["players"]]
    assert ids[1] in stolen, "ids are public; that is the premise"

    impersonated = client.get(
        f"/api/rooms/{room_id}/state", params={"playerId": ids[1]}, headers=ticket
    ).json()
    assert impersonated["you"] is None
    assert all(p["cards"] is None for p in impersonated["players"])


def test_the_room_code_alone_does_not_open_the_table(client, clock):
    """The code gets forwarded and screenshotted; the password does not.

    Watching through the front door asks for one, so reading the same table
    over the API has to as well.
    """
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    assert client.get(f"/api/rooms/{room_id}/state").status_code == 403
    assert client.get(f"/api/rooms/{room_id}/rabbit").status_code == 403
    assert client.get(
        f"/api/rooms/{room_id}/state",
        headers={main.PLAYER_TOKEN_HEADER: "not-a-real-key"},
    ).status_code == 403


def test_a_borrowed_id_cannot_act(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    stamped = {
        "playerId": actor,
        "action": "fold",
        "amount": None,
        "handNumber": hand_number(client, room_id),
        "turnId": turn_id(client, room_id),
    }

    res = client.post(f"/api/rooms/{room_id}/action", json=stamped)
    assert res.status_code == 403
    # Somebody else's credential is no better than none at all.
    other = next(p for p in ids if p != actor)
    res = client.post(
        f"/api/rooms/{room_id}/action", headers=auth(other), json=stamped
    )
    assert res.status_code == 403
    assert state(client, room_id, ids[0])["actorId"] == actor


def test_a_borrowed_host_id_cannot_deal_or_remove_anyone(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    bare = {"playerId": ids[0], "action": "start"}
    assert client.post(f"/api/rooms/{room_id}/start", json=bare).status_code == 403
    assert client.post(
        f"/api/rooms/{room_id}/kick", json={"playerId": ids[0], "targetId": ids[1]}
    ).status_code == 403


def test_nobody_can_turn_over_somebody_elses_hand(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    victim = room["handPlayerIds"][0]
    res = client.post(
        f"/api/rooms/{room_id}/show", json={"playerId": victim, "indices": [0, 1]}
    )
    assert res.status_code == 403


def test_a_credential_is_never_sent_to_the_table(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    body = client.get(
        f"/api/rooms/{room_id}/state", params={"playerId": ids[0]}, headers=auth(ids[0])
    ).text
    for pid in ids:
        assert TOKENS[pid] not in body


def test_being_shown_the_door_takes_the_key_with_it(client, clock):
    """A removed player keeps their record. They must not keep their access.

    The record stays because the final standings look players up by id, so
    deleting them outright turns the podium into a KeyError. But a record is a
    memory of somebody who was here, and treating it as a live credential means
    the host removes a player who then carries on reading the table, sitting
    back in, and polling as if nothing had happened.

    Refused as Gone rather than Forbidden, every way in, and the difference is
    not tidiness. A device told "no" throws away the credential it was refused
    with — right for a key the table has never known, and exactly wrong here,
    because that credential is the only thing that tells this device from a
    stranger's at the front door. Forget it and the person who was just removed
    is a new arrival who knows the password.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert kick(client, room_id, ids[0], ids[2]).status_code == 200

    gone = ids[2]
    reading = client.get(
        f"/api/rooms/{room_id}/state", params={"playerId": gone}, headers=auth(gone)
    )
    assert reading.status_code == 410
    sitting = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(gone),
        json={"playerId": gone, "action": "sit"},
    )
    assert sitting.status_code == 410
    assert "removed" in sitting.json()["detail"].lower()
    # And the table itself is unchanged by the attempt.
    room = client.portal.call(main.load_room, room_id)
    assert gone not in room["order"]


def test_going_home_is_not_being_shown_the_door(client, clock):
    """Both close the seat. Only one of them is meant to be permanent.

    A device that left of its own accord should forget its credential and be
    able to walk back in; a device that was removed should keep it and be told
    why. Same record shape, opposite answers, so the difference has to be
    written down rather than inferred.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert leave(client, room_id, ids[2]).status_code == 200

    reading = client.get(
        f"/api/rooms/{room_id}/state", params={"playerId": ids[2]}, headers=auth(ids[2])
    )
    assert reading.status_code == 403
    assert "removed" not in reading.json()["detail"].lower()


def test_a_table_from_before_the_credential_split_closes_every_door(client, clock):
    """One refusal, one status code, whichever way the room is reached.

    Failing closed in four different shapes — a 401 here, a 500 there, a 200
    that then cannot read anything — is how a client ends up in a state nobody
    wrote a screen for. The worst of them was a join that succeeded, took a
    seat, handed out a key, and had every subsequent request reject it.
    """
    room_id, ids = table(client, 2)
    room = client.portal.call(main.load_room, room_id)
    room.pop("watchToken")
    for player in room["players"].values():
        player.pop("token", None)
    client.portal.call(main.save_room, room)

    doors = [
        client.get(f"/api/rooms/{room_id}/state"),
        client.get(f"/api/rooms/{room_id}/rabbit"),
        client.post(f"/api/rooms/{room_id}/watch", json={"password": "secret"}),
        client.post(
            f"/api/rooms/{room_id}/join", json={"name": "Late", "password": "secret"}
        ),
        client.post(
            f"/api/rooms/{room_id}/start", json={"playerId": ids[0], "action": "start"}
        ),
    ]
    assert [d.status_code for d in doors] == [401] * len(doors)
    assert all("Start a new one" in d.json()["detail"] for d in doors)
    # And the refused join really did not seat anybody.
    assert len(client.portal.call(main.load_room, room_id)["order"]) == 2


# --------------------------------------------------------------------------- #
# Running it twice
# --------------------------------------------------------------------------- #
def shove(client, room_id, ids):
    """Fold one out and get the other two all-in preflop.

    Three-handed rather than heads-up on purpose: an all-in between the last
    two players ends the tournament as soon as one of them busts, and every
    assertion below would then be about the podium rather than about the
    boards.
    """
    first = state(client, room_id, ids[0])["actorId"]
    act(client, room_id, first, "fold")
    for _ in range(6):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or not view["actorId"]:
            break
        legal = state(client, room_id, view["actorId"])["legal"]
        if legal and legal["canRaise"]:
            act(client, room_id, view["actorId"], "raise", legal["maxRaise"])
        elif legal and legal["canCheckOrCall"]:
            act(client, room_id, view["actorId"], "call")
        else:
            break
        if state(client, room_id, ids[0])["runoutSeats"]:
            break
    return state(client, room_id, ids[0])


def say(client, room_id, player_id, answer):
    return client.post(
        f"/api/rooms/{room_id}/runout",
        headers=auth(player_id),
        json={
            "playerId": player_id,
            "action": answer,
            "handNumber": hand_number(client, room_id),
        },
    )


def test_the_offer_only_appears_when_the_chips_are_already_in(client, clock):
    room_id, ids = table(client, 3, runItTwice=True, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    assert state(client, room_id, ids[0])["runoutSeats"] == []

    view = shove(client, room_id, ids)
    assert len(view["runoutSeats"]) == 2, "only the players still in it"
    assert view["runoutDeadline"] == pytest.approx(clock.now + main.RUNOUT_SECONDS)
    assert view["room"]["phase"] == "hand", "waiting, not settled"


def test_everybody_has_to_agree_for_a_second_board(client, clock):
    room_id, ids = table(client, 3, runItTwice=True, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    asked = shove(client, room_id, ids)["runoutSeats"]

    for pid in asked:
        assert say(client, room_id, pid, "twice").status_code == 200

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"
    assert len(view["boards"]) == 2
    assert all(len(b) == 5 for b in view["boards"])
    assert view["boards"][0] != view["boards"][1]
    # And the pot went out in two halves, to whoever took each board. Which
    # board went to whom is the whole point of the second one, and it is not
    # something the final stacks can tell you: winning both and chopping both
    # come out identically.
    assert len(view["boardResults"]) == 2
    assert all(r["winners"] for r in view["boardResults"])
    paid = {r["name"] for r in view["lastResults"] if r["won"] > 0}
    for board in view["boardResults"]:
        assert set(board["winners"]) <= paid
    assert sum(r["delta"] for r in view["lastResults"]) == 0, "chips conserved"

    # What each seat put in is what it was pushed less what it ended up up or
    # down by. Both all-in players put in everything they had, and the pot came
    # back out across the two boards.
    room = client.portal.call(main.load_room, room_id)
    started = dict(zip(room["handPlayerIds"], room["handStartStacks"]))
    staked = {r["playerId"]: r["won"] - r["delta"] for r in view["lastResults"]}
    for pid in asked:
        assert staked[pid] == started[pid], "all-in is the whole stack"
    assert sum(staked.values()) == sum(r["won"] for r in view["lastResults"])
    assert books_balance(client, room_id)


def test_one_refusal_runs_it_once(client, clock):
    room_id, ids = table(client, 3, runItTwice=True, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    asked = shove(client, room_id, ids)["runoutSeats"]
    say(client, room_id, asked[0], "twice")
    say(client, room_id, asked[1], "once")

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"
    assert len(view["boards"]) == 1


def test_nobody_answering_runs_it_once_rather_than_holding_the_table(client, clock):
    """Somebody walks off to the kitchen with the chips already in. Silence and
    a refusal come to the same thing, which is what makes this safe."""
    room_id, ids = table(client, 3, runItTwice=True, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    shove(client, room_id, ids)

    clock.advance(main.RUNOUT_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"
    assert len(view["boards"]) == 1
    assert view["runoutSeats"] == []


def test_a_table_without_the_rule_is_never_asked(client, clock):
    room_id, ids = table(client, 3, runItTwice=False, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = shove(client, room_id, ids)
    assert view["runoutSeats"] == []
    assert view["room"]["phase"] == "handover"
    assert len(view["boards"]) == 1


def test_nobody_outside_the_hand_gets_a_say(client, clock):
    room_id, ids = table(client, 3, runItTwice=True, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = shove(client, room_id, ids)
    assert view["runoutSeats"], "the offer has to be out for this to mean anything"
    outsider = next(p for p in ids if p not in view["runoutSeats"])
    res = say(client, room_id, outsider, "twice")
    assert res.status_code == 409
    assert "asking you" in res.json()["detail"]


def test_folding_for_free_stays_impossible_in_cash_mode(client, clock):
    """Running it twice needs cash-game mode, which lets a player fold a hand
    they could check. Legal everywhere, pointless everywhere, and offering it
    would just be a button that throws away a free card."""
    room_id, ids = table(client, 3, runItTwice=True, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    for _ in range(6):
        view = state(client, room_id, ids[0])
        actor = view["actorId"]
        if not actor:
            break
        legal = state(client, room_id, actor)["legal"]
        if legal and legal["canCheckOrCall"] and legal["callAmount"] == 0:
            assert legal["canFold"] is False
            assert act(client, room_id, actor, "fold").status_code == 400
            return
        act(client, room_id, actor, "call")
    # Everybody calling preflop always comes round to the big blind with
    # nothing to call — that is what the big blind is — so this line is only
    # reached when the free check has stopped happening, which is the
    # behaviour under test. Skipping on it is a green tick for the bug.
    raise AssertionError("the big blind never got a free option in cash mode")


# --------------------------------------------------------------------------- #
# Deciding before your turn
# --------------------------------------------------------------------------- #
def plan(client, room_id, player_id, action, hand=None):
    return client.post(
        f"/api/rooms/{room_id}/preaction",
        headers=auth(player_id),
        json={
            "playerId": player_id,
            "action": action,
            "handNumber": hand_number(client, room_id) if hand is None else hand,
        },
    )


def waiting_on(client, room_id):
    return state(client, room_id, client.portal.call(main.load_room, room_id)["hostId"])[
        "actorId"
    ]


def next_to_act(client, room_id, actor):
    """Whoever the engine will ask after ``actor``, without asking it twice."""
    room = client.portal.call(main.load_room, room_id)
    order = room["handPlayerIds"]
    return order[(order.index(actor) + 1) % len(order)]


def test_a_plan_is_carried_out_on_somebody_elses_poll(client, clock):
    """Nothing runs in the background, so this is the only way it can work —
    and it is the same way the shot clock already works."""
    room_id, ids = table(client, 3, actionSeconds=30, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)

    assert plan(client, room_id, planner, "call-any").status_code == 200
    assert act(client, room_id, actor, "call").status_code == 200

    # No poll from the planner, and no clock expiring: their turn came and went.
    view = state(client, room_id, ids[0])
    assert view["actorId"] != planner


def test_a_plan_beats_the_shot_clock(client, clock):
    """A player who has already decided is not out of time. Running the clock
    first would fold a hand they told us they wanted to play."""
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    plan(client, room_id, planner, "call-any")

    clock.advance(60)  # the clock is long gone by the time anybody looks
    act(client, room_id, actor, "call")
    room = client.portal.call(main.load_room, room_id)
    seat = room["handPlayerIds"].index(planner)
    assert seat not in room["foldedSeats"], "called, not folded"
    assert seat not in room["timedOutSeats"]


def test_a_plain_check_lapses_when_somebody_bets(client, clock):
    """The instruction was for a free card. This is not that, so the player is
    asked rather than committed to something they did not agree to."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    plan(client, room_id, planner, "check")

    legal = state(client, room_id, actor)["legal"]
    act(client, room_id, actor, "raise", legal["minRaise"])

    view = state(client, room_id, ids[0])
    assert view["actorId"] == planner, "asked, not folded and not called"
    assert state(client, room_id, planner)["preAction"] is None


def test_check_fold_folds_into_a_bet_and_checks_when_it_is_free(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    plan(client, room_id, planner, "check-fold")

    legal = state(client, room_id, actor)["legal"]
    act(client, room_id, actor, "raise", legal["minRaise"])

    room = client.portal.call(main.load_room, room_id)
    state(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    assert room["handPlayerIds"].index(planner) in room["foldedSeats"]


def test_a_plan_is_for_one_decision_not_for_the_rest_of_the_hand(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    plan(client, room_id, planner, "call-any")
    act(client, room_id, actor, "call")
    state(client, room_id, ids[0])

    assert state(client, room_id, planner)["preAction"] is None
    room = client.portal.call(main.load_room, room_id)
    assert "preAction" not in room["players"][planner]


def test_the_same_plan_can_be_made_again_later_in_the_hand(client, clock):
    """A plan is for one decision, so making it again is a new decision.

    Which is exactly where naming the request after the intent — "check, this
    hand" — goes wrong: it is the same name on the turn as it was on the flop,
    and answering a name already seen plans nothing while telling the player it
    worked. They then sit there waiting for a decision they think they made.

    Sent here with the name a client that still writes one would use, because
    that is what the room has to survive.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0, bombPotEvery=1)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    hand = hand_number(client, room_id)

    def plan_named(action):
        return client.post(
            f"/api/rooms/{room_id}/preaction",
            headers=auth(planner),
            json={
                "playerId": planner,
                "action": action,
                "handNumber": hand,
                "requestId": f"p:{planner}:{hand}:{action}",
            },
        )

    assert plan_named("check").status_code == 200
    act(client, room_id, actor, "call")
    state(client, room_id, ids[0])  # the flop check fires and is used up
    assert state(client, room_id, planner)["preAction"] is None

    # Same hand, next street, same intention — and it has to take.
    while waiting_on(client, room_id) == planner:
        act(client, room_id, planner, "call")
    assert plan_named("check").status_code == 200
    assert state(client, room_id, planner)["preAction"] == "check"


def test_taking_a_plan_back_and_making_it_again_works(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)

    assert plan(client, room_id, planner, "call-any").status_code == 200
    assert plan(client, room_id, planner, "clear").status_code == 200
    assert state(client, room_id, planner)["preAction"] is None
    assert plan(client, room_id, planner, "call-any").status_code == 200
    assert state(client, room_id, planner)["preAction"] == "call-any"


def test_three_plans_resolve_in_one_go(client, clock):
    """The whole point is pace. Resolving one per poll would take three and a
    half seconds to do what should be instant."""
    # A bomb pot starts on the flop with nobody facing anything, which is the
    # cleanest way to have three players in a row who can all check.
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0, bombPotEvery=1)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    for pid in ids:
        if pid != actor:
            assert plan(client, room_id, pid, "check").status_code == 200

    act(client, room_id, actor, "call")  # a check, in the engine's vocabulary
    before = client.portal.call(main.load_room, room_id)["turnId"]

    state(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    # One tick, one saved state — the rest of the street went round inside it.
    assert room["turnId"] == before + 1
    assert len(main.poker.board_cards(main.poker.loads(room["stateB64"]))) == 4


def test_a_plan_never_carries_into_the_next_hand(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    hand = hand_number(client, room_id)
    plan(client, room_id, planner, "call-any")

    # A plan made for a hand that ends before it fires is simply gone.
    fold_until_hand_over(client, room_id, ids)
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    state(client, room_id, ids[0])
    assert hand_number(client, room_id) == hand + 1
    assert state(client, room_id, planner)["preAction"] is None

    stale = plan(client, room_id, planner, "call-any", hand=hand)
    assert stale.status_code == 409


def test_a_plan_is_nobody_elses_business(client, clock):
    """Half the information in poker is what somebody has not decided yet."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    plan(client, room_id, planner, "check-fold")

    assert state(client, room_id, planner)["preAction"] == "check-fold"
    for watcher in ids:
        if watcher != planner:
            assert state(client, room_id, watcher)["preAction"] is None
    body = client.get(
        f"/api/rooms/{room_id}/state",
        params={"playerId": actor},
        headers=auth(actor),
    ).text
    assert "check-fold" not in body


def test_a_plan_can_be_taken_back(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    plan(client, room_id, planner, "call-any")
    assert plan(client, room_id, planner, "clear").status_code == 200
    assert state(client, room_id, planner)["preAction"] is None

    act(client, room_id, actor, "call")
    assert waiting_on(client, room_id) == planner


def test_you_cannot_plan_your_way_through_your_own_turn(client, clock):
    """That is not a plan, it is an action — and a second way to make the same
    decision, racing the first."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    res = plan(client, room_id, actor, "call-any")
    assert res.status_code == 409
    assert "your turn" in res.json()["detail"]


def test_an_unknown_plan_is_refused(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    actor = waiting_on(client, room_id)
    planner = next_to_act(client, room_id, actor)
    assert plan(client, room_id, planner, "call-100").status_code == 400


# --------------------------------------------------------------------------- #
# The time bank
# --------------------------------------------------------------------------- #
def bank_of(client, room_id, player_id):
    view = state(client, room_id, player_id)
    return next(p["timeBank"] for p in view["players"] if p["id"] == player_id)


def test_the_bank_opens_by_itself_when_the_clock_runs_out(client, clock):
    """A bank that has to be claimed is a bank the player who needed it forgot.

    They are staring at a decision, not at the interface. So the shot clock
    running out hands over the bank instead of playing the hand for them.
    """
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=60)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    clock.advance(25)  # past the clock and its grace
    view = state(client, room_id, ids[1])
    assert view["actorId"] == actor, "not folded — that is the whole point"
    assert view["bankRunning"] is True
    assert view["actionDeadline"] == pytest.approx(clock.now + 60)


def test_the_bank_pays_for_exactly_what_it_was_used_for(client, clock):
    """Nothing decrements anywhere in this file — every clock is a deadline and
    the answer is worked out when somebody asks. So what is left of the bank is
    read back off that deadline, not counted down."""
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=60)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    clock.advance(25)
    state(client, room_id, ids[1])  # somebody's poll opens the bank
    clock.advance(18)  # they think about it for eighteen seconds
    assert act(client, room_id, actor, "call").status_code == 200
    assert bank_of(client, room_id, actor) == 42

    # And the next decision starts on the shot clock again, not on what is left.
    view = state(client, room_id, ids[0])
    assert view["bankRunning"] is False
    assert view["actionDeadline"] == pytest.approx(view["serverTime"] + 20)


def test_running_the_bank_dry_plays_the_hand(client, clock):
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=30)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]

    clock.advance(25)
    state(client, room_id, ids[1])  # the bank opens
    clock.advance(35)  # and runs out too
    view = state(client, room_id, ids[1])
    assert view["actorId"] != actor
    assert bank_of(client, room_id, actor) == 0
    assert view["bankRunning"] is False


def test_the_bank_is_spent_once_and_lasts_the_tournament(client, clock):
    """Not per hand and not per decision: a fixed amount for the night, which
    is what makes spending it a decision at all."""
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=60)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    clock.advance(25)
    state(client, room_id, ids[1])
    clock.advance(30)
    act(client, room_id, actor, "call")
    spent_once = bank_of(client, room_id, actor)
    assert spent_once == 30

    # Round to them again, and they only have what they had left.
    for _ in range(8):
        view = state(client, room_id, ids[0])
        if view["actorId"] == actor or not view["actorId"]:
            break
        act(client, room_id, view["actorId"], "call")
    if state(client, room_id, ids[0])["actorId"] == actor:
        clock.advance(25)
        view = state(client, room_id, ids[1])
        assert view["bankRunning"] is True
        assert view["actionDeadline"] == pytest.approx(clock.now + spent_once)


def test_no_bank_means_the_clock_still_folds_you(client, clock):
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=0)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    clock.advance(25)
    view = state(client, room_id, ids[1])
    assert view["actorId"] != actor
    assert view["bankRunning"] is False


def test_a_player_who_has_left_does_not_spend_their_bank(client, clock):
    """They are not thinking about it. Making the table wait out a bank for
    somebody who has gone home is the opposite of what the bank is for."""
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=60)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    leave(client, room_id, actor)

    view = state(client, room_id, ids[1])
    assert view["actorId"] != actor, "played out at once, not on any clock"
    assert view["bankRunning"] is False


# --------------------------------------------------------------------------- #
# Coming and going
# --------------------------------------------------------------------------- #
def leave(client, room_id, player_id):
    return client.post(
        f"/api/rooms/{room_id}/leave",
        headers=auth(player_id),
        json={"playerId": player_id, "action": "leave"},
    )


def buy(client, room_id, player_id, what="rebuy"):
    return client.post(
        f"/api/rooms/{room_id}/rebuy",
        headers=auth(player_id),
        json={"playerId": player_id, "action": what},
    )


def bust(client, room_id, victim):
    """Take a player to zero the way the game would: somebody else wins it.

    Never by deleting the chips. The ledger below is the whole point of these
    tests, and a stack that evaporates out of band would break it for a reason
    that has nothing to do with the code under test.
    """
    room = client.portal.call(main.load_room, room_id)
    winner = next(pid for pid in room["order"] if pid != victim)
    room["players"][winner]["chips"] += room["players"][victim]["chips"]
    room["players"][victim]["chips"] = 0
    client.portal.call(main.save_room, room)


def books_balance(client, room_id):
    """The invariant that replaces "starting stack times players".

    Every chip on the table — stacks, the pot, and what is out on the felt —
    against every chip ever issued to it less every chip taken off. Arriving,
    leaving and buying back in all break the old check; this one has to survive
    every one of them, or a bug that moves chips wrongly stops being visible.
    """
    room = client.portal.call(main.load_room, room_id)
    view = state(client, room_id, room["hostId"])
    on_table = (
        sum(p["chips"] for p in view["players"])
        + view["pot"]
        + sum(p["bet"] for p in view["players"])
    )
    return on_table == main._chips_balance(room)


def test_the_pot_is_still_reported_after_it_has_been_pushed(client, clock):
    """Two facts, and folding them into one breaks whichever it is folded into.

    `pot` is chips that have left the stacks and are not on the felt, so once
    the engine pushes them it is zero and has to be — the books add up only if
    nothing is counted in the middle *and* in a stack. But a table with nothing
    in the middle cannot rake the last street in or push a pot out, and both of
    those happen after the number goes to zero. So the hand that is over
    reports what it came to as well, separately, and the two never overlap.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = fold_until_hand_over(client, room_id, ids)

    assert view["room"]["phase"] == "handover"
    assert view["pot"] == 0, "the chips are in the winner's stack now"
    assert view["potAtEnd"] > 0, "and this is what they came to"
    assert view["potAtEnd"] == sum(r["won"] for r in view["lastResults"])
    assert books_balance(client, room_id), "counted once, not twice"

    # And it belongs to the hand it happened in.
    clock.advance(main.HANDOVER_MAX_SECONDS + 1)
    start(client, room_id, ids[0])
    assert state(client, room_id, ids[0])["potAtEnd"] == 0


def test_a_latecomer_plays_from_the_next_deal_not_this_one(client, clock):
    room_id, ids = table(client, 3, lateEntryLevels=4, actionSeconds=0, levelMinutes=10)
    start(client, room_id, ids[0])
    seated = client.portal.call(main.load_room, room_id)["handPlayerIds"]

    late = join(client, room_id, "Late")["playerId"]
    room = client.portal.call(main.load_room, room_id)
    assert room["handPlayerIds"] == seated, "never into a hand already running"
    assert late in room["order"]
    assert books_balance(client, room_id)

    fold_until_hand_over(client, room_id, ids)
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    state(client, room_id, ids[0])
    assert late in client.portal.call(main.load_room, room_id)["handPlayerIds"]
    assert books_balance(client, room_id)


def test_the_door_shuts_at_the_level_the_host_chose(client, clock):
    room_id, ids = table(client, 2, lateEntryLevels=2, levelMinutes=1, actionSeconds=0)
    start(client, room_id, ids[0])
    assert (
        client.post(
            f"/api/rooms/{room_id}/join", json={"name": "In time", "password": "secret"}
        ).status_code
        == 200
    )

    clock.advance(60 * 2 + 1)  # into level three
    res = client.post(
        f"/api/rooms/{room_id}/join", json={"name": "Too late", "password": "secret"}
    )
    assert res.status_code == 400
    assert "past the point" in res.json()["detail"]


def test_a_latecomer_can_sit_down_behind_what_the_table_is_playing(client, clock):
    """A starting stack at level nine is a handful of blinds, not a seat."""
    room_id, ids = table(
        client, 3, lateEntryLevels=99, lateEntryChips="average", actionSeconds=0
    )
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    for pid, chips in zip(room["order"], (4000, 3000, 2000)):
        room["players"][pid]["chips"] = chips
    client.portal.call(main.save_room, room)

    late = join(client, room_id, "Late")["playerId"]
    room = client.portal.call(main.load_room, room_id)
    assert room["players"][late]["chips"] == 3000
    assert books_balance(client, room_id)


def test_a_latecomer_never_sits_down_behind_less_than_the_buy_in(client, clock):
    """Averaging a table that is down to crumbs must not punish the newcomer."""
    room_id, ids = table(
        client, 3, lateEntryLevels=99, lateEntryChips="average", actionSeconds=0
    )
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    for pid, chips in zip(room["order"], (100, 100, 100)):
        room["players"][pid]["chips"] = chips
    client.portal.call(main.save_room, room)

    late = join(client, room_id, "Late")["playerId"]
    room = client.portal.call(main.load_room, room_id)
    assert room["players"][late]["chips"] == room["startingChips"]


def test_leaving_between_hands_takes_the_stack_home(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    going = ids[2]
    had = client.portal.call(main.load_room, room_id)["players"][going]["chips"]
    assert leave(client, room_id, going).status_code == 200

    room = client.portal.call(main.load_room, room_id)
    assert going not in room["order"]
    assert room["chipsWithdrawn"] == had
    assert books_balance(client, room_id)
    # Leaving early is still a finish: they place below whoever is left.
    assert going in room["bustOrder"]


def test_leaving_mid_hand_waits_for_the_pot_to_be_settled(client, clock):
    """A seat cannot be pulled out from under a hand everybody else is in.

    And nobody should be kept waiting on somebody who has gone: their remaining
    decisions are played out at once rather than on the shot clock, because the
    clock would make the table sit through twenty seconds per street for a
    player who has closed the tab.
    """
    room_id, ids = table(client, 3, actionSeconds=30, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    going = room["actorId"]
    assert going is not None

    assert leave(client, room_id, going).status_code == 200
    room = client.portal.call(main.load_room, room_id)
    assert going in room["order"], "still in the hand"
    assert room["players"][going]["leaving"] is True

    # No clock has to expire: somebody else's poll plays it out for them.
    view = state(client, room_id, ids[0])
    assert view["actorId"] != going
    assert books_balance(client, room_id)

    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    assert going not in room["order"]
    assert books_balance(client, room_id)


def test_leaving_does_not_deal_you_the_hosts_hand(client, clock):
    """A view is somebody's view: it carries their own cards.

    So the answer to "I am going home" has to be built for the person going
    home, however little is left of their seat. Built for anybody else, it
    hands them that person's hole cards on the way out of the door — and
    walking out mid-hand is exactly when those cards are worth something.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    going = next(pid for pid in ids if pid != ids[0])

    res = leave(client, room_id, going)
    assert res.status_code == 200
    view = res.json()
    host = next(p for p in view["players"] if p["id"] == ids[0])
    assert host["cards"] is None, "the host's hand is the host's business"
    assert view["you"] is None or view["you"]["id"] == going


def test_the_table_keeps_a_host_when_the_host_goes_home(client, clock):
    """Being host is not a label, it is the only credential that can deal.

    Walking off with it leaves a table nobody can start, stop, or end — which,
    once the auto-deal has nothing left to deal, is a room that is over whether
    or not anybody meant it to be.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert leave(client, room_id, ids[0]).status_code == 200

    room = client.portal.call(main.load_room, room_id)
    assert room["hostId"] in room["order"]
    assert room["hostId"] != ids[0]
    # And the credential goes with the job: whoever holds it can deal.
    assert start(client, room_id, room["hostId"]).status_code == 200


def test_the_host_leaving_mid_hand_hands_the_job_over_at_the_end(client, clock):
    """The other door: the seat stays until the pot is settled, and so does
    the job — right up to the moment the seat goes."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    assert leave(client, room_id, ids[0]).status_code == 200
    assert client.portal.call(main.load_room, room_id)["hostId"] == ids[0]

    fold_until_hand_over(client, room_id, ids)
    room = client.portal.call(main.load_room, room_id)
    if room["phase"] == "finished":
        pytest.skip("the hand knocked somebody out; there is no table left to host")
    assert room["hostId"] in room["order"]
    assert room["hostId"] != ids[0]


def test_the_lobby_keeps_a_host_too(client, clock):
    room_id, ids = table(client, 3)
    assert leave(client, room_id, ids[0]).status_code == 200
    room = client.portal.call(main.load_room, room_id)
    assert room["hostId"] in ids[1:]
    assert start(client, room_id, room["hostId"]).status_code == 200


def test_a_host_who_busts_is_still_the_host(client, clock):
    """They are at the table, watching. It is still their room."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    bust(client, room_id, ids[0])
    assert client.portal.call(main.load_room, room_id)["hostId"] == ids[0]


def test_the_last_two_players_leaving_still_produces_a_podium(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    leave(client, room_id, ids[2])
    leave(client, room_id, ids[1])

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    places = {s["playerId"]: s["place"] for s in view["standings"]}
    assert set(places) == set(ids)
    assert places[ids[1]] < places[ids[2]], "leaving later is a better finish"


def test_a_table_played_to_the_end_has_no_way_out(client, clock):
    room_id, ids = table(client, 3, allowLeaving=False)
    res = leave(client, room_id, ids[1])
    assert res.status_code == 400
    assert "to the end" in res.json()["detail"]


def test_buying_back_in_undoes_the_bust(client, clock):
    room_id, ids = table(
        client, 3, rebuyLevels=4, rebuysPerPlayer=2, actionSeconds=0, levelMinutes=10
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    bust(client, room_id, ids[2])
    state(client, room_id, ids[0])
    main._record_busts(room := client.portal.call(main.load_room, room_id))
    client.portal.call(main.save_room, room)
    assert ids[2] in client.portal.call(main.load_room, room_id)["bustOrder"]

    assert buy(client, room_id, ids[2]).status_code == 200
    room = client.portal.call(main.load_room, room_id)
    assert room["players"][ids[2]]["chips"] == room["startingChips"]
    assert ids[2] not in room["bustOrder"], "not out any more"
    assert room["players"][ids[2]]["rebuys"] == 1
    assert books_balance(client, room_id)


def test_two_rebuys_inside_one_hand_are_two_purchases(client, clock):
    """A retry and a second purchase are not the same request.

    The client names a purchase so that tapping twice cannot buy twice. Named
    after the player, the hand and the kind, two *different* rebuys can share
    all three: bust, buy back in, and lose the new stack before the next deal —
    the 7-2 bonus is settled after the pot and can take it in one go. The
    second purchase then asked under the first one's name, the server found the
    receipt, answered 200, and handed over no chips. The player saw a purchase
    that had not happened.
    """
    room_id, ids = table(
        client, 3, rebuyLevels=4, rebuysPerPlayer=2, actionSeconds=0, levelMinutes=10
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    me = ids[2]
    hand = client.portal.call(main.load_room, room_id)["handNumber"]

    def purchase(taken):
        """Exactly the name the client builds. See `pokerApi.buyChips`."""
        return client.post(
            f"/api/rooms/{room_id}/rebuy",
            headers=auth(me),
            json={
                "playerId": me,
                "action": "rebuy",
                "requestId": f"b:{me}:{hand}:rebuy:{taken}",
            },
        )

    bust(client, room_id, me)
    assert purchase(0).status_code == 200
    # The same tap again is still one purchase — that part has to keep working.
    assert purchase(0).status_code == 200
    room = client.portal.call(main.load_room, room_id)
    assert room["players"][me]["rebuys"] == 1
    assert room["players"][me]["chips"] == room["startingChips"]

    bust(client, room_id, me)
    # The name the client used to send, which had no ordinal in it and so is
    # this string for both purchases. It answers with the first one's receipt:
    # a 200 with nothing behind it, which is the whole bug.
    assert purchase(0).status_code == 200
    assert client.portal.call(main.load_room, room_id)["players"][me]["chips"] == 0

    assert purchase(1).status_code == 200
    room = client.portal.call(main.load_room, room_id)
    # The premise, stated: none of this crossed a deal.
    assert room["handNumber"] == hand
    assert room["players"][me]["rebuys"] == 2
    assert room["players"][me]["chips"] == room["startingChips"]
    assert books_balance(client, room_id)


def test_rebuys_run_out(client, clock):
    room_id, ids = table(client, 3, rebuyLevels=4, rebuysPerPlayer=1, levelMinutes=10)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    for _ in range(2):
        bust(client, room_id, ids[2])
        last = buy(client, room_id, ids[2])
    assert last.status_code == 400
    assert "all your rebuys" in last.json()["detail"]


def test_a_player_with_chips_cannot_buy_back_in(client, clock):
    room_id, ids = table(client, 3, rebuyLevels=4, levelMinutes=10)
    res = buy(client, room_id, ids[1])
    assert res.status_code == 400
    assert "still have chips" in res.json()["detail"]


def test_the_add_on_is_once_and_only_with_chips_in_front_of_you(client, clock):
    room_id, ids = table(
        client, 3, rebuyLevels=4, addOn=True, levelMinutes=10, actionSeconds=0
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    had = client.portal.call(main.load_room, room_id)["players"][ids[1]]["chips"]
    assert buy(client, room_id, ids[1], "add-on").status_code == 200
    room = client.portal.call(main.load_room, room_id)
    assert room["players"][ids[1]]["chips"] == had + room["startingChips"]
    assert books_balance(client, room_id)

    again = buy(client, room_id, ids[1], "add-on")
    assert again.status_code == 400
    assert "already taken" in again.json()["detail"]


def test_the_table_does_not_crown_a_winner_while_somebody_can_still_return(
    client, clock
):
    """Ending here would hand the night to whoever was left standing at the
    moment, while somebody else was still entitled to sit back down."""
    room_id, ids = table(
        client, 2, rebuyLevels=2, rebuysPerPlayer=1, levelMinutes=1, actionSeconds=0
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    bust(client, room_id, ids[1])
    # The next deal is what discovers there is nobody to deal to.
    clock.advance(main.AUTO_DEAL_SECONDS + 1)

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"
    assert view["standings"] == []

    buy(client, room_id, ids[1])
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"
    assert books_balance(client, room_id)


def test_a_table_waiting_on_a_rebuy_closes_when_the_window_does(client, clock):
    """And it has to close by itself. Nobody is going to press anything."""
    room_id, ids = table(
        client, 2, rebuyLevels=2, rebuysPerPlayer=1, levelMinutes=1, actionSeconds=0
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    bust(client, room_id, ids[1])
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "handover"

    clock.advance(60 * 2 + 1)  # the window shuts
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert [s["playerId"] for s in view["standings"]] == ids


def test_the_books_balance_through_a_whole_messy_night(client, clock):
    """Arrivals, departures, rebuys and hands, with the ledger checked at every
    step. This is the check that replaces "starting stack times players", so it
    is worth walking rather than sampling."""
    room_id, ids = table(
        client,
        3,
        lateEntryLevels=99,
        rebuyLevels=99,
        rebuysPerPlayer=2,
        addOn=True,
        actionSeconds=0,
        levelMinutes=0,
    )
    start(client, room_id, ids[0])
    assert books_balance(client, room_id)

    fold_until_hand_over(client, room_id, ids)
    assert books_balance(client, room_id)

    late = join(client, room_id, "Late")["playerId"]
    assert books_balance(client, room_id)

    buy(client, room_id, ids[1], "add-on")
    assert books_balance(client, room_id)

    leave(client, room_id, ids[2])
    assert books_balance(client, room_id)

    bust(client, room_id, late)
    buy(client, room_id, late)
    assert books_balance(client, room_id)

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    state(client, room_id, ids[0])
    assert books_balance(client, room_id)


def test_the_button_walks_the_seating_not_the_arrival_order(client, clock):
    """``order`` is what the button goes round, so it has to be where people
    are sitting. That was the same list while seats were only ever handed out
    in order; a chair freed and refilled is exactly when it stops being."""
    room_id, ids = table(client, 4)
    kick(client, room_id, ids[0], ids[1])
    join(client, room_id, "Refill")

    room = client.portal.call(main.load_room, room_id)
    seats = [room["players"][pid]["seat"] for pid in room["order"]]
    assert seats == sorted(seats)


# --------------------------------------------------------------------------- #
# Stopping the table
# --------------------------------------------------------------------------- #
def control(client, room_id, host, action):
    return client.post(
        f"/api/rooms/{room_id}/table",
        headers=auth(host),
        json={"playerId": host, "action": action},
    )


def test_pausing_holds_the_blind_clock_still(client, clock):
    """The whole point of a break, and the thing that was missing.

    There is no counter to stop — the level is projected from when it started,
    every time anybody asks — so pausing has to hold the clock still rather
    than stop decrementing something. Done wrong, twenty minutes for a pizza
    comes back three levels higher, which is the difference between a break and
    an ambush.
    """
    room_id, ids = table(client, 2, levelMinutes=10, actionSeconds=0)
    start(client, room_id, ids[0])
    clock.advance(60 * 4)  # four minutes into a ten-minute level

    before = state(client, room_id, ids[0])["level"]
    assert before["secondsLeft"] == 60 * 6
    assert control(client, room_id, ids[0], "pause").status_code == 200

    clock.advance(60 * 20)  # the pizza arrives
    paused = state(client, room_id, ids[0])["level"]
    assert paused["number"] == before["number"]
    assert paused["secondsLeft"] == before["secondsLeft"]

    control(client, room_id, ids[0], "resume")
    back = state(client, room_id, ids[0])["level"]
    assert back["number"] == before["number"]
    # Exactly what was left, not a whole level and not none of it.
    assert back["secondsLeft"] == pytest.approx(before["secondsLeft"], abs=1)

    # And it runs again from there: six more minutes finishes the level.
    clock.advance(60 * 6 + 1)
    running = state(client, room_id, ids[0])["level"]
    assert running["number"] == before["number"], "mid-hand the old level stands"
    assert running["pending"]["number"] == before["number"] + 1


def test_a_scheduled_break_stops_the_table_by_itself(client, clock):
    room_id, ids = table(
        client, 3, levelMinutes=1, actionSeconds=0, breakEveryLevels=2, breakMinutes=5
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    clock.advance(60 * 2 + 1)  # two levels done: the break falls here
    view = state(client, room_id, ids[0])
    assert view["room"]["paused"] is True
    assert view["breakUntil"] == pytest.approx(clock.now + 5 * 60)
    assert view["room"]["phase"] == "handover", "a break never interrupts a hand"

    # It ends on its own, without the host having to do anything.
    clock.advance(5 * 60 + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["paused"] is False
    assert view["breakUntil"] is None

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_a_long_gap_does_not_bank_up_two_breaks(client, clock):
    """Nobody wants two breaks back to back because the pizza arrived late."""
    room_id, ids = table(
        client, 3, levelMinutes=1, actionSeconds=0, breakEveryLevels=1, breakMinutes=2
    )
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    clock.advance(60 * 5 + 1)  # five levels' worth of chatting

    state(client, room_id, ids[0])  # the break lands
    clock.advance(2 * 60 + 1)
    state(client, room_id, ids[0])  # and ends
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "hand", "back to poker, not straight into another"
    assert view["room"]["paused"] is False


def test_the_last_hand_is_the_one_being_played(client, clock):
    """Called during a hand, "last hand" means this one."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    dealt = state(client, room_id, ids[0])["room"]["handNumber"]
    assert control(client, room_id, ids[0], "last-hand").status_code == 200
    assert state(client, room_id, ids[0])["room"]["lastHand"] is True

    fold_until_hand_over(client, room_id, ids)
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert view["room"]["handNumber"] == dealt, "no hand after the last one"
    # Nobody was knocked out, so the placings come from the stacks.
    chips = [s["chips"] for s in view["standings"]]
    assert chips == sorted(chips, reverse=True)
    assert len(view["standings"]) == 3


def test_called_between_hands_there_is_one_more(client, clock):
    """Which is what a host saying "last hand" at the table means.

    Ending on the pot that just finished would close the night on a hand nobody
    knew was the final one.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    played = state(client, room_id, ids[0])["room"]["handNumber"]
    control(client, room_id, ids[0], "last-hand")

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "hand"
    assert view["room"]["handNumber"] == played + 1

    fold_until_hand_over(client, room_id, ids)
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "finished"


def test_the_host_can_take_the_last_hand_back(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    control(client, room_id, ids[0], "last-hand")
    control(client, room_id, ids[0], "keep-playing")
    assert state(client, room_id, ids[0])["room"]["lastHand"] is False

    fold_until_hand_over(client, room_id, ids)
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_dealing_by_hand_cannot_unsay_the_last_hand(client, clock):
    """The whole table was told. The Deal button must not quietly undo it."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    control(client, room_id, ids[0], "last-hand")
    fold_until_hand_over(client, room_id, ids)

    res = start(client, room_id, ids[0])
    assert res.status_code == 400
    assert "last hand" in res.json()["detail"]
    assert state(client, room_id, ids[0])["room"]["phase"] == "finished"


def test_calling_the_last_hand_twice_does_not_buy_another_one(client, clock):
    """Which hand is the last one is decided once, and stands.

    Otherwise the second tap — or the first one landing again after the hand it
    was made during has ended — moves the finish line by one pot, and the table
    plays a hand nobody called for.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    dealt = state(client, room_id, ids[0])["room"]["handNumber"]

    assert control(client, room_id, ids[0], "last-hand").status_code == 200
    fold_until_hand_over(client, room_id, ids)
    assert control(client, room_id, ids[0], "last-hand").status_code == 200

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert view["room"]["handNumber"] == dealt


def test_resuming_a_table_that_is_already_going_leaves_the_clock_alone(client, clock):
    """A button that looks like it did nothing is a button that gets tapped.

    Handing the player on the spot a second full shot clock every time is a way
    to stall a hand from outside it.
    """
    room_id, ids = table(client, 3, actionSeconds=20, levelMinutes=0)
    start(client, room_id, ids[0])
    clock.advance(10)
    before = client.portal.call(main.load_room, room_id)["actionDeadline"]

    assert control(client, room_id, ids[0], "resume").status_code == 200
    assert client.portal.call(main.load_room, room_id)["actionDeadline"] == before
    assert not _is_paused_in_store(client, room_id)


def test_only_the_host_stops_the_table(client, clock):
    room_id, ids = table(client, 3)
    assert control(client, room_id, ids[1], "pause").status_code == 403
    assert control(client, room_id, ids[1], "last-hand").status_code == 403


def test_an_unknown_table_control_is_refused(client, clock):
    room_id, ids = table(client, 2)
    res = control(client, room_id, ids[0], "burn-it-down")
    assert res.status_code == 400
    assert not _is_paused_in_store(client, room_id)


def _is_paused_in_store(client, room_id):
    return main._is_paused(client.portal.call(main.load_room, room_id))


# --------------------------------------------------------------------------- #
# What the room owes the clock
# --------------------------------------------------------------------------- #
def settle_the_schedule(room, rounds=8):
    """Tick until nothing is outstanding, and say how many rounds it took."""
    for taken in range(rounds):
        if not main._work_due(room, main.time.time()):
            return taken
        assert main._tick(room), "something was due and the tick did nothing"
    raise AssertionError("the room never runs out of work to do")


def test_work_that_is_due_is_either_done_or_stops_being_due(client, clock):
    """The failure this guards against congests the room and never recovers.

    ``GET /state`` decides whether to take the lock; the tick decides what to do
    once it has it. If the first says "something is due" and the second leaves
    the condition standing, then every poll from every client takes the lock,
    for ever — six phones at 1.2 seconds each, queueing behind one another all
    night, over work that is never done.

    Walked through every state a room passes through: waiting, a live hand with
    an expired decision, the pause between hands, and the end.
    """
    room_id, ids = table(client, 3, actionSeconds=10, levelMinutes=0)
    room = client.portal.call(main.load_room, room_id)
    assert settle_the_schedule(room) == 0, "a lobby owes the clock nothing"

    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    assert settle_the_schedule(room) == 0, "a fresh decision is not late"

    # Nobody answers, for long enough that every decision in the hand expires.
    for _ in range(12):
        clock.advance(60)
        room = client.portal.call(main.load_room, room_id)
        settle_the_schedule(room)
        client.portal.call(main.save_room, room)
        if room["phase"] == "finished":
            break
    # However far it got, the room is quiet again at that moment.
    assert not main._work_due(room, clock.now)


def test_the_end_of_the_night_comes_before_the_break(client, clock):
    """Convergence is not the same as the right answer.

    Both are due at the same moment, both eventually happen, and the invariant
    above is happy either way — so the order has to be tested for what it
    produces, not for whether it settles. The wrong way round, the host calls
    the last hand, everybody plays it, and the table answers with a five-minute
    countdown before telling anyone who won.
    """
    room_id, ids = table(
        client, 3, levelMinutes=1, actionSeconds=0, breakEveryLevels=1, breakMinutes=5
    )
    start(client, room_id, ids[0])
    dealt = state(client, room_id, ids[0])["room"]["handNumber"]
    assert control(client, room_id, ids[0], "last-hand").status_code == 200

    fold_until_hand_over(client, room_id, ids)
    clock.advance(60 + main.AUTO_DEAL_SECONDS + 1)  # the level turns over too
    room = client.portal.call(main.load_room, room_id)
    assert main._break_due(room, clock.now), "both are genuinely due at once"

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "finished"
    assert view["room"]["handNumber"] == dealt
    assert view["breakUntil"] is None
    assert view["standings"]


def test_a_stopped_table_does_not_fold_anybody(client, clock):
    """Found by pausing a running table and watching it play on without me.

    The blind clock was being held, the dealing was stopped — and the shot
    clock carried on regardless, so the host pausing for a pizza came back to
    a table where everybody had been folded by a clock that never stopped.
    """
    room_id, ids = table(client, 3, actionSeconds=20, timeBankSeconds=60)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    control(client, room_id, ids[0], "pause")

    clock.advance(600)
    view = state(client, room_id, ids[1])
    assert view["actorId"] == actor, "still their decision to make"
    assert view["bankRunning"] is False, "and not out of their time bank either"
    room = client.portal.call(main.load_room, room_id)
    assert room["foldedSeats"] == []
    assert room["timedOutSeats"] == []

    # Back on, and they get their time back in full rather than pro-rata.
    control(client, room_id, ids[0], "resume")
    view = state(client, room_id, ids[0])
    assert view["actorId"] == actor
    assert view["actionDeadline"] == pytest.approx(view["serverTime"] + 20, abs=1)


def test_a_paused_table_asks_nothing_of_the_clock(client, clock):
    """Paused means paused: no appointment, so no reason to take the lock."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    client.post(
        f"/api/rooms/{room_id}/table",
        headers=auth(ids[0]),
        json={"playerId": ids[0], "action": "pause"},
    )
    clock.advance(3600)
    room = client.portal.call(main.load_room, room_id)
    assert main._work_due(room, clock.now) == []
    assert main._next_wakeup(room) is None


def test_the_lock_is_not_taken_on_a_quiet_poll(client, clock):
    """Most polls must not queue. Six phones at 1.2 seconds is the whole reason.

    Counted through the lock itself rather than by reasoning about the
    predicate, so this keeps meaning something when the predicate changes.
    """
    room_id, ids = table(client, 3, actionSeconds=30, levelMinutes=0)
    start(client, room_id, ids[0])
    state(client, room_id, ids[0])  # the first poll writes a heartbeat

    taken = 0
    original = main._RoomLock.__aenter__

    async def counting(self):
        nonlocal taken
        taken += 1
        return await original(self)

    main._RoomLock.__aenter__ = counting
    try:
        for _ in range(5):
            state(client, room_id, ids[0])
    finally:
        main._RoomLock.__aenter__ = original
    assert taken == 0

    # And when there *is* something due, it does take it.
    clock.advance(60)
    main._RoomLock.__aenter__ = counting
    try:
        state(client, room_id, ids[0])
    finally:
        main._RoomLock.__aenter__ = original
    assert taken == 1


# --------------------------------------------------------------------------- #
# Doing a thing once
# --------------------------------------------------------------------------- #
def test_a_join_that_is_retried_takes_the_same_seat(client, clock):
    """The response went missing, not the seat.

    Without a name for the attempt, the retry creates a second player — and the
    first one can never be recovered, because the only proof it belonged to
    anybody went missing with the response.
    """
    room_id, ids = table(client, 2)
    body = {"name": "Marcos", "password": "secret", "requestId": "attempt-1"}

    first = client.post(f"/api/rooms/{room_id}/join", json=body).json()
    again = client.post(f"/api/rooms/{room_id}/join", json=body).json()
    assert again["playerId"] == first["playerId"]
    assert again["token"] == first["token"]

    room = client.portal.call(main.load_room, room_id)
    assert len(room["order"]) == 3
    assert sum(p["name"] == "Marcos" for p in room["players"].values()) == 1


def test_two_people_with_the_same_name_both_get_a_seat(client, clock):
    """The guard is against a repeated *request*, not a repeated name."""
    room_id, _ = table(client, 2)
    one = client.post(
        f"/api/rooms/{room_id}/join",
        json={"name": "Marcos", "password": "secret", "requestId": "his-phone"},
    ).json()
    two = client.post(
        f"/api/rooms/{room_id}/join",
        json={"name": "Marcos", "password": "secret", "requestId": "her-phone"},
    ).json()
    assert one["playerId"] != two["playerId"]
    assert len(client.portal.call(main.load_room, room_id)["order"]) == 4


def test_a_device_that_already_has_a_key_is_somebody_coming_back(client, clock):
    """Identity here is the credential, not the name typed into the box.

    It is what tells "Marcos is back" from "another Marcos has arrived", which
    is the question every way back into a table has to answer.
    """
    room_id, ids = table(client, 3)
    res = client.post(
        f"/api/rooms/{room_id}/join",
        headers=auth(ids[1]),
        json={"name": "Someone Else", "password": "secret"},
    )
    assert res.status_code == 200
    assert res.json()["playerId"] == ids[1]

    room = client.portal.call(main.load_room, room_id)
    assert room["order"] == ids  # no new chair
    assert room["players"][ids[1]]["name"] == "P1"  # and no rename


def test_a_returning_host_is_still_the_host(client, clock):
    room_id, ids = table(client, 2)
    res = client.post(
        f"/api/rooms/{room_id}/join",
        headers=auth(ids[0]),
        json={"name": "Host", "password": "secret"},
    )
    assert res.json()["isHost"] is True


def test_asking_twice_to_sit_out_does_not_sit_you_back_in(client, clock):
    """A flip is the one shape where a retry undoes itself.

    The player asks to sit out, nothing appears to happen, they tap again — and
    they are sitting in, with nothing on screen explaining why.

    This is the old form of the request, still sent by a phone with the
    previous version of the page open. Current clients say which side of the
    table they want to be on instead, which is safe to repeat without a
    receipt — and, unlike a receipt, safe to *mean* twice.
    """
    room_id, ids = table(client, 3)
    body = {"playerId": ids[1], "action": "sit", "requestId": "sit-me-out"}
    for _ in range(2):
        res = client.post(f"/api/rooms/{room_id}/sit", headers=auth(ids[1]), json=body)
        assert res.status_code == 200
    assert client.portal.call(main.load_room, room_id)["players"][ids[1]]["sittingOut"]

    # Genuinely changing their mind later is a different request, and works.
    client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[1]),
        json={"playerId": ids[1], "action": "sit", "requestId": "sit-me-back-in"},
    )
    assert not client.portal.call(main.load_room, room_id)["players"][ids[1]]["sittingOut"]


def test_a_join_is_not_forgotten_because_the_table_kept_playing(client, clock):
    """The one receipt whose loss cannot be put right.

    Every other replay is caught a second time by the state of the room — you
    cannot rebuy with chips in front of you, or take the add-on twice. A
    replayed join is a second seat and a second stack for one person, and the
    first seat is unrecoverable, because the only proof it belonged to anybody
    went missing with the response.

    So it must not queue behind ordinary play: a nine-handed hand is easily
    thirty decisions, which is enough to push it off the end of a shared list
    while the phone that lost the response is still on the same screen.
    """
    room_id, ids = table(client, 3)
    body = {"name": "Marcos", "password": "secret", "requestId": "attempt-1"}
    first = client.post(f"/api/rooms/{room_id}/join", json=body).json()

    for i in range(main.MAX_RECEIPTS * 2):  # a long hand happens
        client.post(
            f"/api/rooms/{room_id}/sit",
            headers=auth(ids[1]),
            json={"playerId": ids[1], "action": "sit", "requestId": f"toggle-{i}"},
        )
        clock.advance(1)

    again = client.post(f"/api/rooms/{room_id}/join", json=body).json()
    assert again["playerId"] == first["playerId"]
    room = client.portal.call(main.load_room, room_id)
    assert sum(p["name"] == "Marcos" for p in room["players"].values()) == 1


def test_the_join_book_is_bounded_as_well(client, clock):
    """Its own shelf, not an unbounded one: the room is read whole every poll.

    Only reachable by churn — the table has nine chairs, so nobody joins
    thirty-three times without leaving — which is also the shape of a night
    where people come and go all evening.
    """
    room_id, _ = table(client, 2)
    for i in range(main.MAX_JOIN_RECEIPTS + 3):
        who = client.post(
            f"/api/rooms/{room_id}/join",
            json={"name": f"P{i}", "password": "secret", "requestId": f"join-{i}"},
        ).json()
        TOKENS[who["playerId"]] = who["token"]
        leave(client, room_id, who["playerId"])
        clock.advance(1)
    room = client.portal.call(main.load_room, room_id)
    assert len(room[main._JOINS]) == main.MAX_JOIN_RECEIPTS
    assert f"join-{main.MAX_JOIN_RECEIPTS + 2}" in room[main._JOINS]


def test_a_name_does_not_block_a_second_real_decision(client, clock):
    """A name is for a retry. Settings are not retried, they are changed back.

    Naming one after where the player wants to end up — "pause, this hand" —
    reads like the intent and works exactly once. The second time the host
    genuinely means it, during the same hand, it is the same name, and the
    answer is a cheerful 200 and a table that never stopped. So settings carry
    no name, and repeating them is made safe on their own terms instead.

    Sent here the way a client that still names them would, because that is
    what the room has to survive.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=10)
    start(client, room_id, ids[0])
    hand = hand_number(client, room_id)

    def control_named(action):
        return client.post(
            f"/api/rooms/{room_id}/table",
            headers=auth(ids[0]),
            json={
                "playerId": ids[0],
                "action": action,
                "requestId": f"t:{hand}:{action}",
            },
        )

    for action in ("pause", "resume", "pause"):
        assert control_named(action).status_code == 200
    assert client.portal.call(main.load_room, room_id)["paused"] is True

    def sit_named(where):
        return client.post(
            f"/api/rooms/{room_id}/sit",
            headers=auth(ids[1]),
            json={
                "playerId": ids[1],
                "action": where,
                "requestId": f"s:{ids[1]}:{hand}:{where}",
            },
        )

    for where in ("out", "in", "out"):
        assert sit_named(where).status_code == 200
    assert client.portal.call(main.load_room, room_id)["players"][ids[1]]["sittingOut"]


def test_asking_for_the_same_side_of_the_table_twice_is_harmless(client, clock):
    """Which is the whole reason the request says where, rather than flip."""
    room_id, ids = table(client, 3)
    for _ in range(2):
        res = client.post(
            f"/api/rooms/{room_id}/sit",
            headers=auth(ids[1]),
            json={"playerId": ids[1], "action": "out"},
        )
        assert res.status_code == 200
    assert client.portal.call(main.load_room, room_id)["players"][ids[1]]["sittingOut"]


def test_the_receipts_do_not_grow_without_end(client, clock):
    """The room is one document that every poll reads whole.

    An unbounded log of everything anybody ever did is a slow leak into every
    request at the table.
    """
    room_id, ids = table(client, 3)
    for i in range(main.MAX_RECEIPTS * 2):
        client.post(
            f"/api/rooms/{room_id}/sit",
            headers=auth(ids[1]),
            json={"playerId": ids[1], "action": "sit", "requestId": f"toggle-{i}"},
        )
        clock.advance(1)
    room = client.portal.call(main.load_room, room_id)
    assert len(room["receipts"]) == main.MAX_RECEIPTS
    # The ones kept are the recent ones.
    assert f"toggle-{main.MAX_RECEIPTS * 2 - 1}" in room["receipts"]
    assert "toggle-0" not in room["receipts"]


# --------------------------------------------------------------------------- #
# Which moment a decision was made at
# --------------------------------------------------------------------------- #
def test_a_stale_decision_cannot_land_when_the_action_comes_back_round(client, clock):
    """The hand stamp is not enough on its own.

    It stops a decision landing on a *later* hand. It does nothing about the
    same one: a raise brings the action back round to a player who has already
    acted, and at that point a duplicate of their earlier request — a double
    tap, a retry after a stall — is legal all over again and gets applied. They
    call a bet they never saw.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])

    view = state(client, room_id, ids[0])
    first = view["actorId"]
    stale_turn = view["turnId"]
    hand = view["room"]["handNumber"]
    # They call. The turn moves on.
    assert act(client, room_id, first, "call").status_code == 200

    # Somebody raises, and the action comes back round to them.
    for _ in range(6):
        view = state(client, room_id, ids[0])
        if view["actorId"] == first:
            break
        legal = view["legal"] or state(client, room_id, view["actorId"])["legal"]
        if legal and legal["canRaise"]:
            act(client, room_id, view["actorId"], "raise", legal["minRaise"])
        else:
            act(client, room_id, view["actorId"], "call")
    assert state(client, room_id, ids[0])["actorId"] == first, "back round to them"

    # The duplicate of their earlier call arrives now. It is their turn, the
    # hand number still matches — and it must not be applied.
    res = act(client, room_id, first, "call", hand=hand, turn=stale_turn)
    assert res.status_code == 409
    assert "moved on" in res.json()["detail"]
    assert state(client, room_id, ids[0])["actorId"] == first


def test_a_repeated_decision_is_answered_rather_than_refused(client, clock):
    """The action worked; only the answer went missing.

    Sending it again should say so, not report a conflict for something that
    succeeded.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    actor = view["actorId"]
    body = {
        "playerId": actor,
        "action": "call",
        "amount": None,
        "handNumber": view["room"]["handNumber"],
        "turnId": view["turnId"],
        "requestId": "one-tap",
    }
    first = client.post(f"/api/rooms/{room_id}/action", headers=auth(actor), json=body)
    again = client.post(f"/api/rooms/{room_id}/action", headers=auth(actor), json=body)
    assert first.status_code == 200
    assert again.status_code == 200
    # And it was applied once: the action has not gone round twice.
    assert again.json()["turnId"] == first.json()["turnId"]


def test_the_turn_counter_never_goes_backwards(client, clock):
    """It has to keep meaning "which moment", including across a new deal."""
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    seen = [state(client, room_id, ids[0])["turnId"]]
    start(client, room_id, ids[0])
    seen.append(state(client, room_id, ids[0])["turnId"])
    fold_until_hand_over(client, room_id, ids)
    seen.append(state(client, room_id, ids[0])["turnId"])
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    seen.append(state(client, room_id, ids[0])["turnId"])
    assert seen == sorted(seen)
    assert seen[-1] > seen[0]


def test_an_action_must_say_which_moment_it_was_decided_at(client, clock):
    room_id, ids = table(client, 2)
    start(client, room_id, ids[0])
    actor = state(client, room_id, ids[0])["actorId"]
    res = client.post(
        f"/api/rooms/{room_id}/action",
        headers=auth(actor),
        json={
            "playerId": actor,
            "action": "call",
            "handNumber": hand_number(client, room_id),
        },
    )
    assert res.status_code == 400
    assert "Reload" in res.json()["detail"]


# --------------------------------------------------------------------------- #
# Redaction
# --------------------------------------------------------------------------- #
def test_hole_cards_are_never_sent_to_other_players(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    for player in view["players"]:
        if player["isYou"]:
            assert len(player["cards"]) == 2
        else:
            assert player["cards"] is None
            assert player["cardsCount"] == 2


def fold_until_hand_over(client, room_id, ids):
    """Fold whoever is to act until the hand ends."""
    for _ in range(40):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand":
            return view
        actor = view["actorId"]
        if actor is None:
            return view
        res = act(client, room_id, actor, "fold")
        if res.status_code != 200:
            act(client, room_id, actor, "call")
    raise AssertionError("hand did not finish")


# --------------------------------------------------------------------------- #
# What just happened (X1) and what it is being played for (X2)
# --------------------------------------------------------------------------- #
def actions(client, room_id, player_id):
    return state(client, room_id, player_id)["actions"]


def test_a_check_leaves_a_trace_when_nothing_else_would(client, clock):
    """The whole point of the log.

    A check moves no chips, folds nobody and grows no board — two polled views
    either side of it are identical apart from whose turn it is, which is the
    same picture as a street closing or a clock expiring. Without this the
    table cannot tell anyone that anything happened.
    """
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    # Get to a flop with everyone still in: call, call, check.
    for _ in range(3):
        view = state(client, room_id, ids[0])
        if view["street"] != "preflop":
            break
        act(client, room_id, view["actorId"], "call")

    view = state(client, room_id, ids[0])
    assert view["street"] == "flop"
    before = state(client, room_id, ids[0])["players"]
    checker = view["actorId"]
    act(client, room_id, checker, "call")  # free — a check
    after = state(client, room_id, ids[0])

    # Nothing a diff could have caught.
    assert [p["chips"] for p in after["players"]] == [p["chips"] for p in before]
    assert [p["bet"] for p in after["players"]] == [p["bet"] for p in before]
    assert after["pot"] == view["pot"]
    # But the table knows.
    last = after["actions"][-1]
    assert last["kind"] == "check"
    assert last["playerId"] == checker
    assert last["amount"] == 0
    assert last["auto"] is False


def test_opening_a_street_is_a_bet_and_answering_one_is_a_raise(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    # Preflop there are blinds up, so the first aggressive action is a raise.
    opener = view["actorId"]
    act(client, room_id, opener, "raise", 40)
    assert actions(client, room_id, ids[0])[-1]["kind"] == "raise"
    assert actions(client, room_id, ids[0])[-1]["to"] == 40

    # Everybody calls to see a flop, where nobody has bet yet.
    for _ in range(4):
        view = state(client, room_id, ids[0])
        if view["street"] != "preflop":
            break
        act(client, room_id, view["actorId"], "call")

    view = state(client, room_id, ids[0])
    assert view["street"] == "flop"
    act(client, room_id, view["actorId"], "raise", 60)
    opened = actions(client, room_id, ids[0])[-1]
    assert opened["kind"] == "bet"
    assert opened["to"] == 60
    assert opened["amount"] == 60

    answered = state(client, room_id, ids[0])
    act(client, room_id, answered["actorId"], "raise", 180)
    assert actions(client, room_id, ids[0])[-1]["kind"] == "raise"


def test_a_call_says_what_it_cost_and_where_it_left_them(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    act(client, room_id, view["actorId"], "raise", 40)
    view = state(client, room_id, ids[0])
    caller = view["actorId"]
    posted = next(p["bet"] for p in view["players"] if p["id"] == caller)
    act(client, room_id, caller, "call")
    last = actions(client, room_id, ids[0])[-1]
    assert last["kind"] == "call"
    assert last["to"] == 40
    # What it actually cost them, which is not the same as the level they
    # called to whenever they already had a blind out there.
    assert last["amount"] == 40 - posted


def test_the_last_action_of_a_hand_is_still_described_correctly(client, clock):
    """The pot is pushed before this runs, and the stacks have already moved.

    Reading the answer off the state afterwards reports a fold by a player
    whose stack went *up*, so the description has to come from the engine's
    own record of what it did.
    """
    room_id, ids = table(client, 2)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    folder = view["actorId"]
    act(client, room_id, folder, "fold")
    last = actions(client, room_id, ids[0])[-1]
    assert last["kind"] == "fold"
    assert last["playerId"] == folder
    assert last["allIn"] is False


def test_going_all_in_is_marked_without_losing_what_it_was(client, clock):
    room_id, ids = table(client, 2, startingChips=100, smallBlind=5, bigBlind=10)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    shover = view["actorId"]
    act(client, room_id, shover, "raise", 100)
    last = actions(client, room_id, ids[0])[-1]
    assert last["allIn"] is True
    # Still a raise. Collapsing it to "all-in" would lose whether they were
    # calling somebody or putting the table to a decision.
    assert last["kind"] == "raise"

    view = state(client, room_id, ids[0])
    caller = view["actorId"]
    act(client, room_id, caller, "call")
    called = actions(client, room_id, ids[0])[-1]
    assert called["kind"] == "call"
    assert called["allIn"] is True


def test_a_fold_by_the_clock_is_marked_apart_from_one_that_was_chosen(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    act(client, room_id, view["actorId"], "raise", 60)
    clock.advance(40)
    view = state(client, room_id, ids[0])
    timed_out = [a for a in view["actions"] if a["auto"]]
    assert timed_out, "the clock's own fold was not written down"
    assert timed_out[-1]["kind"] == "fold"
    chosen = [a for a in view["actions"] if not a["auto"]]
    assert chosen[-1]["kind"] == "raise"


def test_the_sequence_never_restarts_so_a_client_can_tell_what_it_has_seen(
    client, clock
):
    room_id, ids = table(client, 2)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    first = state(client, room_id, ids[0])["actions"]
    assert first
    highest = first[-1]["seq"]

    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    # A new deal clears the hand's actions...
    assert all(a["handNumber"] == view["room"]["handNumber"] for a in view["actions"])
    act(client, room_id, view["actorId"], "call")
    # ...but not the counter, or every deal would replay its first action.
    assert state(client, room_id, ids[0])["actions"][-1]["seq"] > highest


def test_the_log_stays_short_enough_to_ride_on_every_response(client, clock):
    room_id, ids = table(client, 2)
    start(client, room_id, ids[0])
    for _ in range(80):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or view["actorId"] is None:
            break
        act(client, room_id, view["actorId"], "call")
    assert len(state(client, room_id, ids[0])["actions"]) <= main.ACTION_LOG_MAX


def test_one_pot_is_served_as_one_pot(client, clock):
    room_id, ids = table(client, 3)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    act(client, room_id, view["actorId"], "call")
    view = state(client, room_id, ids[0])
    assert len(view["pots"]) <= 1
    assert sum(p["amount"] for p in view["pots"]) == view["pot"]


def test_a_short_all_in_splits_the_pot_and_names_who_can_win_each(client, clock):
    """Today the view says one number, and it is not true for anybody.

    A player all in for 100 into two stacks of 1000 is playing for the main
    pot only; the other two are playing for that and a side pot the short
    stack cannot touch. Told a single total, nobody can work out what their
    call is chasing.
    """
    room_id, ids = table(client, 3, startingChips=1000, smallBlind=5, bigBlind=10)
    # Give the first player a short stack by taking chips off them directly:
    # what is being tested is the shape of the pot, not how they got there.
    room = client.portal.call(main.load_room, room_id)
    short = room["order"][0]
    room["players"][short]["chips"] = 100
    client.portal.call(main.save_room, room)

    start(client, room_id, ids[0])
    # The short stack only ever calls, so their whole stack goes in behind a
    # bet bigger than it — the only way a side pot forms. The other two stop
    # at 300 rather than shoving, so both still have chips behind and the hand
    # is still being played when the pots are read.
    for _ in range(8):
        view = state(client, room_id, ids[0])
        if view["street"] != "preflop" or view["actorId"] is None:
            break
        actor = view["actorId"]
        legal = state(client, room_id, actor)["legal"]
        highest = max(p["bet"] for p in view["players"])
        if actor != short and legal and legal["canRaise"] and highest < 300:
            act(client, room_id, actor, "raise", 300)
        else:
            act(client, room_id, actor, "call")

    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "hand", "the hand should still be live"
    assert len(view["pots"]) > 1, "a short all-in did not produce a side pot"
    # Every pot names who is playing for it, and the short stack is only in
    # the first one.
    assert short in view["pots"][0]["playerIds"]
    assert short not in view["pots"][1]["playerIds"]
    # And the parts still add up to the whole, so a client can render either.
    assert sum(p["amount"] for p in view["pots"]) == view["pot"]


# --------------------------------------------------------------------------- #
# Showing at a showdown: who has to, and who never does
# --------------------------------------------------------------------------- #
#: The deal these showdown tests are written against: a board of
#: ``Tc 2s 6h Kh 9c`` — no flush, no straight, nothing anybody can play on its
#: own. Fixed, because the hands below are planted and the *board* was not: a
#: random five cards rescues a hand meant to lose about one time in six, and a
#: test that fails every sixth run for a reason unrelated to the code is a test
#: nobody reads the output of any more. Every test using it re-states what the
#: board does to its hands, so a changed deck fails on the premise and not on
#: the conclusion.
SHOWDOWN_DEAL = 10


def showdown_between(client, room_id, ids, seats_cards, seed=SHOWDOWN_DEAL):
    """Play a hand to the river with everybody checking, with rigged hands.

    `seats_cards` is {seat: [card, card]}. Every other seat gets something
    bland, so the test is about the hands it planted and not about the deck.
    """
    random.seed(seed)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    for seat, hole in seats_cards.items():
        room["handHoleCards"][seat] = list(hole)
    client.portal.call(main.save_room, room)
    for _ in range(60):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or not view["actorId"]:
            break
        act(client, room_id, view["actorId"], "call")
    return client.portal.call(main.load_room, room_id)


def test_a_beaten_hand_that_speaks_last_is_never_turned_over(client, clock):
    """The rule nobody had implemented: you only show to beat what is showing.

    Everybody checks to the river, so the first to speak is the seat left of
    the button. A hand that cannot beat what is already face up goes into the
    muck unseen — it is the player's information, not the table's, and an app
    that turns it over is handing out a reading of how they play.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    # Seat 0 is first to speak with everybody checking; seat 1 beats it.
    room = showdown_between(
        client, room_id, ids, {0: ["2c", "3d"], 1: ["As", "Ks"], 2: ["4h", "5h"]}
    )
    assert room["phase"] == "handover"
    # The premise, stated rather than assumed: on this board seat 1 has kings,
    # seat 0 has deuces and seat 2 has nothing at all.
    board = poker.boards(poker.loads(room["stateB64"]))[0]
    ranks = [poker.hand_rank(room["handHoleCards"][i], board) for i in range(3)]
    assert ranks[1] > ranks[0] > ranks[2], f"the deal changed under this test: {board}"
    shown = set(room["showSeats"])
    assert 0 in shown, "the first to speak always shows"
    assert 1 in shown, "and so does the hand that beats it"
    assert 2 not in shown, "a hand that beats nothing showing stays face down"

    watcher = ids[0]
    seats = {
        p["name"]: p
        for p in state(client, room_id, watcher)["players"]
    }
    hidden = room["handPlayerIds"][2]
    seen = next(p for p in state(client, room_id, watcher)["players"] if p["id"] == hidden)
    assert seen["cards"] is None
    assert seen["showedDown"] is False
    # Still holding two cards, face down — a muck is not a fold.
    assert seen["cardsCount"] == 2
    assert seats  # the table is intact


def test_the_best_hand_at_the_table_always_shows(client, clock):
    """Whatever else is mucked, the hand that takes it is face up.

    Asserted against the hands the test planted rather than against the
    engine's winner on purpose: rigging changes the snapshot the showdown
    reads, not the cards pokerkit dealt, and the claim being made here is about
    the rule — the best hand of the ones on the table has to be shown.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    room = showdown_between(
        client, room_id, ids, {0: ["2c", "3d"], 1: ["As", "Ks"], 2: ["4h", "5h"]}
    )
    board = poker.boards(poker.loads(room["stateB64"]))[0]
    ranks = [poker.hand_rank(room["handHoleCards"][i], board) for i in range(3)]
    best = max(range(3), key=lambda i: ranks[i])
    assert best in set(room["showSeats"])


def test_a_hand_nobody_had_to_show_can_still_be_shown(client, clock):
    """The choice is the point. The app does not turn it over; the player may."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    room = showdown_between(
        client, room_id, ids, {0: ["2c", "3d"], 1: ["As", "Ks"], 2: ["4h", "5h"]}
    )
    quiet = room["handPlayerIds"][2]
    assert show(client, room_id, quiet, [0, 1]).status_code == 200
    watcher = ids[0]
    seen = next(p for p in state(client, room_id, watcher)["players"] if p["id"] == quiet)
    assert seen["cards"] == ["4h", "5h"]


def test_a_chop_shows_both_hands(client, clock):
    """Tying is not being beaten. Both have to be face up or the pot is a claim."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    room = showdown_between(
        client, room_id, ids, {0: ["As", "Kd"], 1: ["Ah", "Kc"], 2: ["2c", "3d"]}
    )
    shown = set(room["showSeats"])
    assert 0 in shown and 1 in shown


def test_a_seat_that_collected_a_pot_shows_it(client, clock):
    """"Beats what is showing" is not the whole rule. Collecting is the rest.

    A hand can win without being the best one at the table. The short stack is
    all in for the main pot with the best hand of the three; the two behind
    keep betting, and the side pot goes to the better of *those two* — whose
    hand loses to what is already face up and would therefore be mucked. It
    was: a player collected a pot with cards nobody at the table ever saw, and
    with 7-2 running they collected that too.

    Asked of the function directly, with the pushes handed to it, because
    which seat wins which pot is the engine's arithmetic and this is a claim
    about the rule that reads it.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    room = showdown_between(
        client, room_id, ids, {0: ["2c", "3d"], 1: ["As", "Ks"], 2: ["4h", "5h"]}
    )
    state_at_end = poker.loads(room["stateB64"])
    board = poker.boards(state_at_end)[0]
    ranks = [poker.hand_rank(room["handHoleCards"][i], board) for i in range(3)]
    # The premise: seat 2 is the worst hand on the table, so nothing but a pot
    # can oblige it to show.
    assert ranks[1] > ranks[0] > ranks[2], f"the deal changed under this test: {board}"

    # Nothing pushed to seat 2: mucked, which is the behaviour that was right.
    assert 2 not in main._seats_that_must_show(room, state_at_end, [0, 270, 0])
    # The side pot pushed to seat 2: face up, because that is how a pot is
    # claimed.
    must = main._seats_that_must_show(room, state_at_end, [0, 270, 20])
    assert 2 in must
    # And the walk is still a walk — showing to collect does not reorder it.
    assert must == sorted(must, key=lambda s: (s - must[0]) % 3)


def test_the_bonus_needs_cards_the_table_has_seen_not_a_showdown(client, clock):
    """Reaching the showdown is not the same as having been shown.

    `_cards_are_public` used to answer "there was a showdown and this seat did
    not fold", which was the rule before the muck existed. Most hands at a
    showdown are thrown away face down, and calling those public pays the one
    prize in the game that exists to be shown for a hand nobody saw.
    """
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    room["foldedSeats"] = []
    room["showSeats"] = [0]
    room["shownSeats"] = {}
    assert main._cards_are_public(room, 0) is True
    # Live at the showdown, and still nobody's business but its owner's.
    assert main._cards_are_public(room, 1) is False
    # One card turned over is not a hand.
    room["shownSeats"] = {"1": [0]}
    assert main._cards_are_public(room, 1) is False
    room["shownSeats"] = {"1": [0, 1]}
    assert main._cards_are_public(room, 1) is True


def test_a_new_deal_forgets_who_had_to_show(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    showdown_between(client, room_id, ids, {0: ["As", "Ks"]})
    start(client, room_id, ids[0])
    assert client.portal.call(main.load_room, room_id)["showSeats"] == []

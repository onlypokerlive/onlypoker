"""End-to-end tests for the tournament rules layered on top of pokerkit.

The two clocks (blind levels and the per-action shot clock) are driven by
``time.time()`` inside ``main``, so the tests swap in a clock they control and
step it forward instead of sleeping.
"""

from __future__ import annotations

import os
import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
os.environ.pop("KV_REST_API_URL", None)
os.environ.pop("UPSTASH_REDIS_REST_URL", None)

import main  # noqa: E402


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
    assert view["autoDealAt"] == pytest.approx(view["serverTime"] + main.AUTO_DEAL_SECONDS)

    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    # A player who is not the host polling is enough to get the cards out.
    view = state(client, room_id, ids[1])
    assert view["room"]["phase"] == "hand"
    assert view["room"]["handNumber"] == 2


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


def test_heads_up_is_never_benched_into_a_dead_table(client, clock):
    """Benching one of two players leaves a table that can't deal or finish.

    They keep their seat instead and the blinds take the stack, which is what
    walking away from a real tournament costs you.
    """
    room_id, ids = table(client, 2, levelMinutes=0)
    start(client, room_id, ids[0])

    for _ in range(30):
        clock.advance(25)
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] == "handover":
            clock.advance(main.AUTO_DEAL_SECONDS + 1)
            view = state(client, room_id, ids[0])
        if view["room"]["phase"] == "finished":
            break
        assert not any(p["autoSatOut"] for p in view["players"]), (
            "a heads-up player was benched, which deadlocks the tournament"
        )

    # Either still playing or someone got blinded out — never stuck.
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] in ("hand", "handover", "finished")
    if view["room"]["phase"] == "handover":
        assert view["autoDealAt"] is not None


def test_choosing_to_sit_out_cannot_strand_a_heads_up_table(client, clock):
    """The clock's rule has to bind the button too.

    Being benched by the shot clock and choosing to sit out leave exactly the
    same table behind: one eligible player, two live stacks, nothing that can
    deal or declare a winner. Only the route was guarded, so the button walked
    straight past it.
    """
    room_id, ids = table(client, 2, levelMinutes=0)
    start(client, room_id, ids[0])

    res = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[1]),
        json={"playerId": ids[1], "action": "sit"}
    )
    assert res.status_code == 400
    assert "without enough" in res.json()["detail"]

    view = state(client, room_id, ids[0])
    assert not any(p["sittingOut"] for p in view["players"])
    # And the UI is told in advance, so the button is disabled rather than
    # offered and then refused.
    assert view["you"]["canSitOut"] is False

    # The hand still plays out and the table still reaches an end.
    fold_until_hand_over(client, room_id, ids)
    assert state(client, room_id, ids[0])["room"]["phase"] in ("handover", "finished")


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


def test_showdown_reports_what_everyone_had(client, clock):
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    # Nobody folds, so the hand is shown down.
    for _ in range(20):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand":
            break
        act(client, room_id, view["actorId"], "call")

    results = state(client, room_id, ids[0])["lastResults"]
    assert len(results) == 2
    for entry in results:
        assert entry["handName"], f"no hand name for {entry['name']}"
        assert len(entry["handCards"]) == 5


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


def rig_hand(client, room_id, seat, hole):
    """Deal a known hand into a seat. The engine has already dealt; we only
    change the snapshot the settlement reads, which is what the rule uses."""
    room = client.portal.call(main.load_room, room_id)
    room["handHoleCards"][seat] = hole
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
            room["handHoleCards"] = list(dealt)
            room["handHoleCards"][showdown_leader(room)] = ["7h", "2c"]
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
    room["handHoleCards"][0] = ["7h", "2c"]
    room["lastResults"] = [
        {"playerId": room["handPlayerIds"][0], "name": "a", "delta": 0},
        {"playerId": room["handPlayerIds"][1], "name": "b", "delta": 0},
        {"playerId": room["handPlayerIds"][2], "name": "c", "delta": -10},
    ]
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
    assert show(client, room_id, winner, [0, 1]).status_code == 403

    view = state(client, room_id, ids[0])
    assert view["sevenDeuceWin"] is None
    # Only the chips the removal itself took with it.
    assert sum(p["chips"] for p in view["players"]) < total_before


def test_nothing_can_be_shown_while_the_hand_is_running(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    res = show(client, room_id, room["handPlayerIds"][0], [0])
    assert res.status_code == 400


def test_somebody_who_was_not_in_the_hand_cannot_show(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    # Sit one player out so the hand is dealt without them.
    client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(ids[2]),
        json={"playerId": ids[2], "action": "sit"},
    )
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


def test_heads_up_the_button_is_the_small_blind():
    """Heads-up the button posts the small blind and acts first preflop."""
    assert main._seat_order("A", ["A", "B"]) == ["A", "B"]
    assert main._seat_order("B", ["A", "B"]) == ["B", "A"]


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
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    assert kick(client, room_id, ids[0], ids[2]).status_code == 200

    gone = ids[2]
    reading = client.get(
        f"/api/rooms/{room_id}/state", params={"playerId": gone}, headers=auth(gone)
    )
    assert reading.status_code == 403
    sitting = client.post(
        f"/api/rooms/{room_id}/sit",
        headers=auth(gone),
        json={"playerId": gone, "action": "sit"},
    )
    assert sitting.status_code == 403
    assert "removed" in sitting.json()["detail"].lower()
    # And the table itself is unchanged by the attempt.
    room = client.portal.call(main.load_room, room_id)
    assert gone not in room["order"]


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
    """A toggle is the one shape where a retry undoes itself.

    The player asks to sit out, nothing appears to happen, they tap again — and
    they are sitting in, with nothing on screen explaining why.
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

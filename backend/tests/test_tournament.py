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
    return res.json()


def join(client, room_id, name, password="secret"):
    res = client.post(
        f"/api/rooms/{room_id}/join", json={"name": name, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()


def state(client, room_id, player_id):
    res = client.get(f"/api/rooms/{room_id}/state", params={"playerId": player_id})
    assert res.status_code == 200, res.text
    return res.json()


def start(client, room_id, host_id):
    return client.post(f"/api/rooms/{room_id}/start", json={"playerId": host_id, "action": "start"})


def hand_number(client, room_id):
    """Current hand number, read straight from the store.

    Deliberately not through ``GET /state``: that route also runs the clocks,
    and several tests below depend on nothing ticking between two steps.
    """
    return client.portal.call(main.load_room, room_id)["handNumber"]


def act(client, room_id, player_id, action, amount=None, hand=None):
    return client.post(
        f"/api/rooms/{room_id}/action",
        json={
            "playerId": player_id,
            "action": action,
            "amount": amount,
            # Every real client stamps its hand; the helper does the same so the
            # tests exercise the path players actually take.
            "handNumber": hand_number(client, room_id) if hand is None else hand,
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
    res = client.post(
        f"/api/rooms/{room_id}/action",
        json={"playerId": actor, "action": "call", "handNumber": stale_hand},
    )
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
def test_table_locks_once_the_tournament_starts(client, clock):
    room_id, ids = table(client, 2)
    start(client, room_id, ids[0])
    res = client.post(
        f"/api/rooms/{room_id}/join", json={"name": "Latecomer", "password": "secret"}
    )
    assert res.status_code == 400
    assert "already started" in res.json()["detail"]


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
        f"/api/rooms/{room_id}/autodeal", json={"playerId": ids[0], "action": "pause"}
    )
    assert res.status_code == 200
    assert res.json()["autoDealAt"] is None

    clock.advance(60)
    view = state(client, room_id, ids[0])
    assert view["room"]["phase"] == "handover"  # still waiting, as asked
    assert view["room"]["autoDealPaused"] is True

    client.post(
        f"/api/rooms/{room_id}/autodeal", json={"playerId": ids[0], "action": "resume"}
    )
    clock.advance(main.AUTO_DEAL_SECONDS + 1)
    assert state(client, room_id, ids[0])["room"]["phase"] == "hand"


def test_only_the_host_can_pause_dealing(client, clock):
    room_id, ids = table(client, 2)
    res = client.post(
        f"/api/rooms/{room_id}/autodeal", json={"playerId": ids[1], "action": "pause"}
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
        f"/api/rooms/{room_id}/sit", json={"playerId": ids[1], "action": "sit"}
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
        f"/api/rooms/{room_id}/sit", json={"playerId": ids[1], "action": "sit"}
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
        f"/api/rooms/{room_id}/action", json={"playerId": actor, "action": "call"}
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
        f"/api/rooms/{room_id}/sit", json={"playerId": ids[1], "action": "sit"}
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

    res = client.post(f"/api/rooms/{room_id}/sit", json={"playerId": pid, "action": "sit"})
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

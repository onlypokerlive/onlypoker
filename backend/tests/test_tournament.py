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


def test_seven_deuce_pays_out_at_showdown(client, clock):
    room_id, ids = table(client, 3, sevenDeuce=2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    # Everyone checks it down, so the hand reaches a showdown.
    for _ in range(30):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or not view["actorId"]:
            break
        act(client, room_id, view["actorId"], "call")

    view = state(client, room_id, ids[0])
    if not view["wentToShowdown"]:
        pytest.skip("hand did not reach a showdown")
    winner = next(r for r in view["lastResults"] if r["delta"] > 0)
    seat = room["handPlayerIds"].index(winner["playerId"])
    # Nothing was rigged, so the bonus only pays if the cards happened to fit.
    holes = client.portal.call(main.load_room, room_id)["handHoleCards"][seat]
    assert bool(view["sevenDeuceWin"]) == main._is_seven_deuce(holes)


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
        f"/api/rooms/{room_id}/kick", json={"playerId": host, "targetId": target}
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
    """Leaving early is still a finish. Forgetting them rewrites the night."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    kick(client, room_id, ids[0], ids[2])
    room = client.portal.call(main.load_room, room_id)
    assert ids[2] in room["bustOrder"]


def test_removing_the_button_does_not_strand_the_next_deal(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    button = client.portal.call(main.load_room, room_id)["buttonId"]
    target = button if button != ids[0] else ids[1]
    assert kick(client, room_id, ids[0], target).status_code == 200
    assert start(client, room_id, ids[0]).status_code == 200


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
    return client.post(f"/api/rooms/{room_id}/watch", json={"password": password})


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
def show(client, room_id, player_id, indices):
    return client.post(
        f"/api/rooms/{room_id}/show", json={"playerId": player_id, "indices": indices}
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


def test_nothing_can_be_shown_while_the_hand_is_running(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    room = client.portal.call(main.load_room, room_id)
    res = show(client, room_id, room["handPlayerIds"][0], [0])
    assert res.status_code == 400


def test_somebody_who_was_not_in_the_hand_cannot_show(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    # Sit one player out so the hand is dealt without them.
    client.post(f"/api/rooms/{room_id}/sit", json={"playerId": ids[2], "action": "sit"})
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

    fold_until_hand_over(client, room_id, ids)
    played = client.portal.call(main.load_room, room_id)
    board = main.poker.board_cards(main.poker.loads(played["stateB64"]))
    dealt = [c for street in predicted for c in street["cards"]]
    # Whatever of the board actually came out has to match the prediction.
    assert dealt[: len(board)] == board


def test_the_rabbit_hunt_only_covers_the_streets_still_missing(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)

    res = client.get(f"/api/rooms/{room_id}/rabbit")
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
    res = client.get(f"/api/rooms/{room_id}/rabbit")
    assert res.status_code == 400
    assert "finish" in res.json()["detail"]


def test_the_rabbit_hunt_does_not_touch_the_room(client, clock):
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    fold_until_hand_over(client, room_id, ids)
    before = client.portal.call(main.load_room, room_id)
    client.get(f"/api/rooms/{room_id}/rabbit")
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

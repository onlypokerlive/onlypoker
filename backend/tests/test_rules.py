"""The rules, checked against the engine rather than against our intentions.

This file exists because of one bug. Heads-up, pokerkit charges index 0 the
*big* blind and makes the last seat the button — the reverse of every other
field size — and this code assumed "index 0 is the small blind" everywhere. The
result was that in every heads-up hand the dealer posted the big blind, the
other player posted the small, and the big blind opened. It ran like that for a
long time, and the whole suite stayed green, because the test that covered it
asserted that `_seat_order` returned the button first — which was the plan, and
the plan was the thing that was wrong.

So nothing here asserts what we meant. Everything is asserted against **what the
engine actually charged and who it actually asked**, at every field size the app
supports, because a positional rule that is right at nine and wrong at two is
exactly the shape of the bug that got through.

The invariants, in the order they matter:

  * who posts what, and that nobody else posts anything;
  * who acts first before the flop, and who acts first after it;
  * that the button is last after the flop, which is what position *is*;
  * that the blinds go round evenly, hand after hand;
  * that chips are conserved, whatever happens in between.

Those five run at every field size from two to nine (`FIELDS`). The optional
rules below them — the straddle, the bomb pot, the ante — are checked at a
sample of sizes rather than all eight, and say which in each case. Worth being
exact about, because "every field size" is the claim this file exists to make
and a claim that is only three-quarters true is the shape of the bug that
started it.
"""

from __future__ import annotations

import pathlib
import random
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import main  # noqa: E402
from test_tournament import (  # noqa: E402
    SHOWDOWN_DEAL,
    act,
    client,  # noqa: F401  — fixture
    clock,  # noqa: F401  — fixture
    fold_until_hand_over,
    start,
    state,
    table,
)

# Two through nine. Two is the one that was broken; nine is the one everything
# else is tuned for; the ones in between are where an off-by-one hides.
FIELDS = [2, 3, 4, 5, 6, 7, 8, 9]


def seats_by_role(view):
    button = next(p for p in view["players"] if p["isButton"])
    small = next(p for p in view["players"] if p["isSmallBlind"])
    big = next(p for p in view["players"] if p["isBigBlind"])
    return button, small, big


def ring_after(view, player_id, steps=1):
    """The seat `steps` along from this one, the way the button travels.

    `players` comes back in seating order, which is what the button walks.
    """
    order = [p["id"] for p in view["players"]]
    return order[(order.index(player_id) + steps) % len(order)]


# --------------------------------------------------------------------------- #
# Who pays
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("players", FIELDS)
def test_exactly_two_players_post_and_they_post_the_right_amounts(
    client, clock, players
):
    """The money, not the labels.

    The heads-up bug was invisible to every label-based assertion: the seat tags
    said "SB" over the player the app *intended* to be the small blind, while
    the engine had charged them the big one.
    """
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    button, small, big = seats_by_role(view)

    assert small["bet"] == view["room"]["smallBlind"], "the small blind posted the small"
    assert big["bet"] == view["room"]["bigBlind"], "the big blind posted the big"
    others = [p for p in view["players"] if p["id"] not in (small["id"], big["id"])]
    assert all(p["bet"] == 0 for p in others), "nobody else puts anything in blind"
    assert button["id"] in (small["id"], big["id"]) or players > 2


@pytest.mark.parametrize("players", FIELDS)
def test_the_button_is_the_small_blind_only_heads_up(client, clock, players):
    """The rule that changes with the field size, stated once for all of them."""
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    button, small, big = seats_by_role(view)

    if players == 2:
        assert button["id"] == small["id"]
        assert button["id"] != big["id"]
    else:
        # Three or more, the button posts nothing and the blinds are the two
        # seats after it.
        assert button["bet"] == 0
        assert small["id"] == ring_after(view, button["id"], 1)
        assert big["id"] == ring_after(view, button["id"], 2)


@pytest.mark.parametrize("players", FIELDS)
def test_the_blinds_are_the_only_dead_money_by_default(client, clock, players):
    """No ante, no straddle, no bomb pot unless the host asked for one."""
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    put_in = sum(p["bet"] for p in view["players"])
    assert put_in == view["room"]["smallBlind"] + view["room"]["bigBlind"]
    assert view["room"]["ante"] == 0
    assert view["room"]["bombPot"] is False


# --------------------------------------------------------------------------- #
# Who acts
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("players", FIELDS)
def test_who_opens_before_the_flop(client, clock, players):
    """Under the gun, which is the seat after the big blind.

    Heads-up there is no under the gun: the two seats are the blinds, and the
    small blind — who is the button — is in first. That special case is the
    whole reason this file exists.
    """
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    button, small, big = seats_by_role(view)

    if players == 2:
        assert view["actorId"] == small["id"] == button["id"]
    else:
        assert view["actorId"] == ring_after(view, big["id"], 1)


@pytest.mark.parametrize("players", FIELDS)
def test_who_opens_after_the_flop_and_who_closes_it(client, clock, players):
    """Position follows the button, and it swaps over heads-up.

    Before the flop the button is *first* heads-up because they are the small
    blind; after it they are last, like everywhere else. Getting the seat order
    backwards inverts both at once, so both are checked — one of them alone
    would pass on a table that was wrong.
    """
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])

    # Everyone calls, the big blind checks their option, and we are on a flop.
    for _ in range(players * 3):
        view = state(client, room_id, ids[0])
        if view["board"]:
            break
        actor = view["actorId"]
        assert actor is not None, "the hand ended before a flop"
        res = act(client, room_id, actor, "call")
        assert res.status_code == 200, res.text

    view = state(client, room_id, ids[0])
    assert len(view["board"]) == 3, view["board"]
    button, small, _ = seats_by_role(view)

    # First to act after the flop is the first live seat after the button.
    assert view["actorId"] == ring_after(view, button["id"], 1)
    if players > 2:
        assert view["actorId"] == small["id"]

    # And the button is last: everybody else acts before the street closes.
    acted: list[str] = []
    for _ in range(players * 2):
        view = state(client, room_id, ids[0])
        if len(view["board"]) > 3 or view["room"]["phase"] != "hand":
            break
        actor = view["actorId"]
        if actor is None:
            break
        acted.append(actor)
        act(client, room_id, actor, "call")
    assert acted[-1] == button["id"], "the button closes the street"


# --------------------------------------------------------------------------- #
# Going round
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("players", FIELDS)
def test_the_blinds_go_round_evenly(client, clock, players):
    """Over a full orbit everybody posts each blind exactly once.

    The invariant that catches a button that rotates by the wrong step, or one
    that jumps when the field changes size — and it is the one players notice
    first, because paying two big blinds in a row is theft.
    """
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    posted: dict[str, list[str]] = {i: [] for i in ids}
    for _ in range(players):
        start(client, room_id, ids[0])
        view = state(client, room_id, ids[0])
        _, small, big = seats_by_role(view)
        posted[small["id"]].append("sb")
        posted[big["id"]].append("bb")
        fold_until_hand_over(client, room_id, ids)

    for pid, roles in posted.items():
        assert roles.count("sb") == 1, f"{pid} posted the small blind {roles}"
        assert roles.count("bb") == 1, f"{pid} posted the big blind {roles}"


@pytest.mark.parametrize("players", FIELDS)
def test_the_button_moves_one_seat_a_hand(client, clock, players):
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    previous = None
    for _ in range(players + 2):
        start(client, room_id, ids[0])
        view = state(client, room_id, ids[0])
        button, _, _ = seats_by_role(view)
        if previous is not None:
            assert button["id"] == ring_after(view, previous, 1)
        previous = button["id"]
        fold_until_hand_over(client, room_id, ids)


# --------------------------------------------------------------------------- #
# The money adds up
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("players", FIELDS)
def test_chips_are_conserved_over_a_run_of_hands(client, clock, players):
    """Nothing is created and nothing is destroyed.

    Cheap, and it catches a whole class of thing at once: a blind posted twice,
    a side pot counted into two of them, a rounding error in a split, chips
    handed out by a rebuy that was never charged for.

    What a sum cannot catch is a pot pushed to the *wrong* seat — the total is
    identical either way, and that is a claim about who, not how much. The
    tests that hold that down are the ones that plant hands and name the
    winner; this one holds down the arithmetic underneath them.
    """
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    view = state(client, room_id, ids[0])
    total = sum(p["chips"] for p in view["players"])
    assert total == view["room"]["startingChips"] * players

    for _ in range(6):
        start(client, room_id, ids[0])
        # Call everything down, so hands reach showdowns and pots get split.
        for _ in range(players * 6):
            view = state(client, room_id, ids[0])
            if view["room"]["phase"] != "hand" or view["actorId"] is None:
                break
            act(client, room_id, view["actorId"], "call")
        view = state(client, room_id, ids[0])
        live = sum(p["chips"] for p in view["players"])
        assert live == total, f"chips changed: {live} != {total}"
        if view["room"]["phase"] == "finished":
            break


@pytest.mark.parametrize("players", FIELDS)
def test_a_pot_is_worth_what_went_into_it(client, clock, players):
    """What is in the middle plus what is on the felt is what left the stacks."""
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    starting = state(client, room_id, ids[0])["room"]["startingChips"]

    for _ in range(players * 4):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or view["actorId"] is None:
            break
        gone = sum(starting - p["chips"] for p in view["players"])
        felt = sum(p["bet"] for p in view["players"])
        assert view["pot"] + felt == gone, (
            f"pot {view['pot']} + felt {felt} != {gone} out of stacks"
        )
        act(client, room_id, view["actorId"], "call")


# --------------------------------------------------------------------------- #
# The rules that stop a hand being stolen
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("players", FIELDS)
def test_only_the_player_on_the_clock_can_act(client, clock, players):
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    for pid in ids:
        if pid == view["actorId"]:
            continue
        res = act(client, room_id, pid, "call")
        assert res.status_code >= 400, f"{pid} acted out of turn"


@pytest.mark.parametrize("players", FIELDS)
def test_a_raise_has_to_clear_the_minimum(client, clock, players):
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    actor = view["actorId"]
    legal = state(client, room_id, actor)["legal"]
    assert legal["canRaise"]
    assert act(client, room_id, actor, "raise", legal["minRaise"] - 1).status_code >= 400
    assert act(client, room_id, actor, "raise", legal["maxRaise"] + 1).status_code >= 400
    assert act(client, room_id, actor, "raise", legal["minRaise"]).status_code == 200


@pytest.mark.parametrize("players", FIELDS)
def test_nobody_can_fold_a_hand_they_could_check(client, clock, players):
    """Folding for free is legal everywhere and pointless everywhere.

    Offering it is a button that throws a hand away for nothing, which somebody
    will eventually press by accident — and heads-up that is the whole
    tournament.
    """
    room_id, ids = table(client, players, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    # Get to the big blind's option, where checking is free.
    for _ in range(players * 2):
        view = state(client, room_id, ids[0])
        actor = view["actorId"]
        if actor is None or view["board"]:
            break
        legal = state(client, room_id, actor)["legal"]
        if legal["canCheckOrCall"] and legal["callAmount"] == 0:
            assert legal["canFold"] is False
            assert act(client, room_id, actor, "fold").status_code >= 400
            return
        act(client, room_id, actor, "call")
    # Not a skip. Everybody calling preflop *always* comes round to the big
    # blind with nothing to call, at every field size — that is what the big
    # blind is. So arriving here means the free check never happened, which is
    # the regression this test exists to catch, and skipping on it is a green
    # tick for the bug.
    raise AssertionError(
        f"the big blind never got a free option {players}-handed — "
        "which is the behaviour under test, not a shape this does not cover"
    )


# --------------------------------------------------------------------------- #
# Where the money can actually go wrong
# --------------------------------------------------------------------------- #
def set_chips(client, room_id, amounts: dict[str, int]):
    """Put specific stacks in front of specific players, before a deal.

    Side pots and chops only happen at particular stack shapes, and playing a
    table down to one of those by hand is both slow and not reproducible.
    """
    room = client.portal.call(main.load_room, room_id)
    for pid, chips in amounts.items():
        room["players"][pid]["chips"] = chips
    client.portal.call(main.save_room, room)


def play_out(client, room_id, ids, action="call"):
    for _ in range(60):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or view["actorId"] is None:
            return view
        act(client, room_id, view["actorId"], action)
    raise AssertionError("hand did not finish")


def test_a_short_stack_makes_a_side_pot_it_cannot_win(client, clock):
    """The rule that decides real money and is easiest to get wrong.

    Somebody all in for less plays for what everybody matched *of theirs*; the
    rest is a pot only the others can win. A table that shows one total is
    telling each of them a different wrong thing, and one that pays one total is
    handing the short stack chips that were never theirs.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    short, a, b = ids[0], ids[1], ids[2]
    set_chips(client, room_id, {short: 300, a: 5000, b: 5000})
    start(client, room_id, ids[0])

    # One deep stack opens for more than the short stack has, the other deep
    # stack calls, and the short stack is all in for less. The pots are sampled
    # after **every** action, because pokerkit only forms them when a street
    # closes and pays them out when the hand ends — a single look either side of
    # that window sees an empty list and proves nothing.
    pots: list = []

    def sample():
        nonlocal pots
        seen = state(client, room_id, ids[0])["pots"]
        if len(seen) > len(pots):
            pots = seen

    for _ in range(30):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or view["actorId"] is None:
            break
        actor = view["actorId"]
        legal = state(client, room_id, actor)["legal"]
        if actor != short and legal["canRaise"] and legal["minRaise"] <= 1000 <= legal["maxRaise"]:
            act(client, room_id, actor, "raise", 1000)
        else:
            act(client, room_id, actor, "call")
        sample()

    assert len(pots) >= 2, f"expected a side pot, got {pots}"
    assert short in pots[0]["playerIds"], "the short stack plays for the main pot"
    for side in pots[1:]:
        assert short not in side["playerIds"], "and for nothing beyond it"
    # The main pot is capped at what everybody matched of the short stack's 300.
    assert pots[0]["amount"] <= 300 * 3


#: A deal where the board plays: ``Th 8h 7h Jc 9d`` is a jack-high straight and
#: neither hand can improve on it. Fixed, because the old version of this test
#: dealt thirty hands hoping a tie turned up and skipped when none did — so on
#: the runs where nothing chopped it proved nothing while reporting green, and
#: on the runs where something did it only checked that the table's chips added
#: up, which is true of every hand ever played.
CHOP_DEAL = 82


def test_a_chop_gives_each_side_back_what_it_put_in(client, clock):
    """The one hand where winning and finishing ahead are different things.

    Both players take half the pot and both end the hand exactly where they
    started. So the money says they each won something and the net says nobody
    won anything, and an app that asks the second question paints a showdown
    with no winner in it.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    random.seed(CHOP_DEAL)
    start(client, room_id, ids[0])
    for _ in range(20):
        view = state(client, room_id, ids[0])
        if view["room"]["phase"] != "hand" or view["actorId"] is None:
            break
        act(client, room_id, view["actorId"], "call")

    view = state(client, room_id, ids[0])
    board = view["board"]
    results = view["lastResults"]
    assert len(results) == 2, f"the deal changed under this test: {board}"
    assert all(r["delta"] == 0 for r in results), f"not a chop on {board}: {results}"
    # Each of them was pushed chips, and neither of them is up. Both halves
    # matter: this is the hand where `delta` and `won` disagree.
    assert all(r["won"] > 0 for r in results), f"a chop pushed nothing: {results}"
    assert results[0]["won"] == results[1]["won"], f"an even pot split unevenly: {results}"
    live = state(client, room_id, ids[0])
    total = sum(p["chips"] for p in live["players"])
    assert total == live["room"]["startingChips"] * 2, "a chip went missing in the chop"


def test_the_straddle_posts_and_acts_last_at_every_field_size(client, clock):
    """Under the gun posts two big blinds and gets to act last preflop.

    Not offered heads-up, where there is no under the gun — the two seats are
    already the blinds. That exception is the same one the blinds themselves
    have, and it is where this kind of rule breaks.
    """
    for players in [2, 3, 6, 9]:
        room_id, ids = table(
            client, players, straddle=True, actionSeconds=0, levelMinutes=0
        )
        start(client, room_id, ids[0])
        view = state(client, room_id, ids[0])
        posted = [p for p in view["players"] if p["bet"] > 0]
        if players == 2:
            assert len(posted) == 2, "heads-up there is nobody to straddle"
            continue
        straddler = next(p for p in view["players"] if p["isStraddle"])
        assert straddler["bet"] == view["room"]["bigBlind"] * 2
        # And they are the seat after the big blind.
        big = next(p for p in view["players"] if p["isBigBlind"])
        assert straddler["id"] == ring_after(view, big["id"], 1)

        # And — the half this test was named after and never checked — they act
        # last. Paying two blinds from under the gun buys exactly one thing:
        # seeing what everybody else does before you decide. The test asserted
        # the price and never the thing bought, so an engine that took the
        # money and asked them first would have passed it.
        asked: list[str] = []
        for _ in range(players * 4):
            live = state(client, room_id, ids[0])
            if live["room"]["phase"] != "hand" or live["street"] != "preflop":
                break
            actor = live["actorId"]
            if actor is None:
                break
            asked.append(actor)
            act(client, room_id, actor, "call")
        assert asked, f"{players}-handed: nobody was asked to act preflop"
        assert asked[-1] == straddler["id"], (
            f"{players}-handed: preflop ended on somebody who was not the straddler"
        )


def test_a_bomb_pot_puts_everyone_in_for_the_same_and_skips_preflop(client, clock):
    for players in [2, 4, 7]:
        room_id, ids = table(
            client, players, bombPotEvery=1, actionSeconds=0, levelMinutes=0
        )
        start(client, room_id, ids[0])
        view = state(client, room_id, ids[0])
        assert view["room"]["bombPot"] is True
        # Nobody is a blind in a bomb pot, and everybody is in for the same.
        assert not any(p["isSmallBlind"] or p["isBigBlind"] for p in view["players"])
        assert len(view["board"]) == 3, "a bomb pot deals straight to the flop"
        stacks = [p["chips"] for p in view["players"]]
        assert len(set(stacks)) == 1, f"unequal contributions: {stacks}"


def test_an_ante_comes_off_every_stack_and_lands_in_the_pot(client, clock):
    for players in [2, 5, 9]:
        room_id, ids = table(
            client, players, anteMode="all", actionSeconds=0, levelMinutes=0
        )
        start(client, room_id, ids[0])
        view = state(client, room_id, ids[0])
        starting = view["room"]["startingChips"]
        gone = sum(starting - p["chips"] for p in view["players"])
        felt = sum(p["bet"] for p in view["players"])
        assert view["pot"] + felt == gone, f"{players}: pot and stacks disagree"
        assert view["pot"] >= view["room"]["ante"] * players


# --------------------------------------------------------------------------- #
# What you are holding
# --------------------------------------------------------------------------- #
def test_your_hand_is_named_to_you_and_to_nobody_else(client, clock):
    """The one piece of private information at this table.

    Naming it is not doing anybody's thinking for them — a player at a real
    table works it out from cards they can hold at arm's length, and the screen
    equivalent is fourteen millimetres under their own thumb. Sending it to
    anybody else would be dealing the hand face up.
    """
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    for pid in ids:
        view = state(client, room_id, pid)
        for p in view["players"]:
            if p["id"] == pid:
                assert p["handName"], f"{pid} was not told what they hold"
            else:
                assert p.get("handName") is None, "somebody else's hand leaked"


def test_a_preflop_hand_is_named_even_though_there_is_nothing_to_evaluate(
    client, clock
):
    """Five cards is the evaluator's minimum, and preflop there are two.

    "No hand yet" is not what somebody holding two aces wants to be told, so the
    two cards get named the way players say them out loud.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = state(client, room_id, ids[0])
    you = next(p for p in view["players"] if p["id"] == ids[0])
    assert view["board"] == []
    assert you["handName"]
    assert "suited" in you["handName"] or "offsuit" in you["handName"] or (
        you["handName"].startswith("Pair of")
    )


def test_the_name_follows_the_board(client, clock):
    """It is what you have *now*, not what you were dealt.

    The deal is fixed, so "no flop came" is not an outcome this can have. It
    used to skip on it, which meant a regression that stopped the flop coming —
    exactly the sort of thing that breaks a hand name — turned this test green
    by removing it.
    """
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    random.seed(SHOWDOWN_DEAL)
    start(client, room_id, ids[0])
    preflop = next(
        p for p in state(client, room_id, ids[0])["players"] if p["id"] == ids[0]
    )["handName"]
    for _ in range(6):
        view = state(client, room_id, ids[0])
        if view["board"] or view["actorId"] is None:
            break
        act(client, room_id, view["actorId"], "call")
    view = state(client, room_id, ids[0])
    assert view["board"], "heads-up, both calling: the flop always comes"
    after = next(p for p in view["players"] if p["id"] == ids[0])["handName"]
    assert after
    # Five cards now, so it is a made hand rather than two cards described.
    assert "suited" not in after and "offsuit" not in after, (
        f"still describing two cards on a flop: {preflop} -> {after}"
    )


def test_the_hand_that_won_is_named_in_the_results(client, clock):
    """So the table can say what it was won with, not only by whom."""
    room_id, ids = table(client, 2, actionSeconds=0, levelMinutes=0)
    random.seed(SHOWDOWN_DEAL)
    start(client, room_id, ids[0])
    view = play_out(client, room_id, ids)
    assert view.get("wentToShowdown"), f"the deal changed under this test: {view['board']}"
    # `won` and not `delta`. Chips coming out of the middle is what winning is;
    # finishing ahead is a different question, and on a chop — where both of
    # them are staring at the board — it answers no for everybody.
    winners = [r for r in view["lastResults"] if r["won"] > 0]
    assert winners, view["lastResults"]
    assert all(w.get("handName") for w in winners), view["lastResults"]


def test_a_pot_won_by_folding_names_no_hand(client, clock):
    """Nobody had to show anything, so there is nothing to name."""
    room_id, ids = table(client, 3, actionSeconds=0, levelMinutes=0)
    start(client, room_id, ids[0])
    view = fold_until_hand_over(client, room_id, ids)
    assert view.get("wentToShowdown") is False
    assert all(r.get("handName") is None for r in view["lastResults"])


@pytest.mark.parametrize(
    "hole, expected",
    [
        (["As", "Ks"], "Ace-king suited"),
        (["Ah", "Kd"], "Ace-king offsuit"),
        (["7h", "7d"], "Pair of sevens"),
        (["2c", "2d"], "Pair of deuces"),
        (["Td", "9d"], "Ten-nine suited"),
        # The low card first, to prove it is ordered by rank and not by position.
        (["2c", "Ah"], "Ace-deuce offsuit"),
    ],
)
def test_two_cards_are_named_the_way_players_say_them(hole, expected):
    import poker

    assert poker.describe_hole(hole) == expected


def test_describing_two_cards_refuses_anything_that_is_not_two_cards():
    import poker

    assert poker.describe_hole([]) is None
    assert poker.describe_hole(["As"]) is None
    assert poker.describe_hole(["As", "Kd", "2c"]) is None

"""Thin wrapper around pokerkit for a No-Limit Texas Hold'em cash game.

The pokerkit ``State`` object is fully picklable, so we serialize it to a
base64 string and stash it in Redis between requests. Every HTTP request
rebuilds the exact same game state by unpickling, applies at most one action,
then re-pickles. This keeps the engine authoritative and serverless-safe.
"""

from __future__ import annotations

import base64
import pickle
from collections import Counter
from typing import Any

from pokerkit import (
    Automation,
    CheckingOrCalling,
    ChipsPushing,
    CompletionBettingOrRaisingTo,
    Folding,
    Mode,
    NoLimitTexasHoldem,
    StandardHighHand,
)

# Everything is automated except the actual player betting decisions
# (fold / check-call / bet-raise). pokerkit will post blinds, deal hole and
# board cards, run showdowns, and push chips on its own.
_AUTOMATIONS = (
    Automation.ANTE_POSTING,
    Automation.BET_COLLECTION,
    Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.CARD_BURNING,
    Automation.HOLE_DEALING,
    Automation.BOARD_DEALING,
    Automation.HOLE_CARDS_SHOWING_OR_MUCKING,
    Automation.HAND_KILLING,
    Automation.CHIPS_PUSHING,
    Automation.CHIPS_PULLING,
)


def create_hand(
    starting_stacks: list[int],
    small_blind: int,
    big_blind: int,
    ante: int = 0,
    ante_from_big_blind: bool = False,
    forced: list[int] | None = None,
    run_it_twice: bool = False,
):
    """Create a fresh hand. ``starting_stacks`` is in seat order where index 0
    is the small blind, index 1 the big blind, and the final index the button
    (pokerkit posts blinds positionally from index 0).

    ``ante_from_big_blind`` is the modern big-blind ante: one player posts for
    the whole table, which is the same dead money with a fraction of the
    fiddling. It needs ``ante_trimming_status=False`` — trimming exists to
    equalise antes across players, so with it on a one-player ante is trimmed
    to nothing and silently never posted at all.

    ``forced`` replaces the blinds outright, in seat order. That is how a
    straddle is expressed (``sb, bb, straddle``) and how a bomb pot is
    (the same amount for everybody).

    ``run_it_twice`` puts the engine in cash-game mode, which is the only mode
    that will deal a board more than once — pokerkit takes the view that a
    tournament never runs it twice, and it is right about tournaments. This is
    a tournament between friends, and §3.D says the host gets to decide. Cash
    mode also lets a player fold a hand they could check for free, which is
    legal everywhere and pointless everywhere; ``legal_actions`` and
    ``apply_action`` keep refusing it, so the table plays the same either way.
    """
    if ante and ante_from_big_blind:
        raw_antes: Any = {1: ante}  # index 1 is the big blind, by construction
    else:
        raw_antes = ante
    return NoLimitTexasHoldem.create_state(
        automations=_AUTOMATIONS,
        mode=Mode.CASH_GAME if run_it_twice else Mode.TOURNAMENT,
        ante_trimming_status=not (ante and ante_from_big_blind),
        raw_antes=raw_antes,
        raw_blinds_or_straddles=tuple(forced) if forced else (small_blind, big_blind),
        # What a bet has to be worth from the flop on. It stays the big blind
        # even when the forced bets are larger, so a bomb pot does not also
        # raise the price of every bet after it.
        min_bet=big_blind,
        raw_starting_stacks=tuple(starting_stacks),
        player_count=len(starting_stacks),
    )


def bomb_pot_forced(players: int, ante: int) -> list[int]:
    """Everyone in for the same amount, which is what a bomb pot is.

    pokerkit has no "start on the flop", but it does not need one: posting an
    equal forced bet for every seat leaves nobody facing anything preflop, so
    checking that round around costs no chips and lands straight on the flop.
    """
    return [ante] * players


def check_around(state) -> None:
    """Close a betting round where nobody owes anything.

    Only safe when every player is already in for the same amount — the bomb
    pot. Called before the hand is ever saved, so no client sees the phantom
    preflop round it passes through.
    """
    guard = 0
    while state.status and state.street_index == 0 and state.actor_index is not None:
        if state.checking_or_calling_amount:
            raise ActionError("check_around called on a round with money owed")
        state.check_or_call()
        guard += 1
        if guard > 64:  # a table cannot be this big; refuse to spin
            raise ActionError("check_around did not converge")


def initial_positions(state) -> dict[str, int]:
    """Derive small blind, big blind, and button seat indices from the *initial*
    posted bets of a freshly created hand. This must be called right after
    ``create_hand`` (before any action), because it reads ``state.bets`` which
    at that point holds exactly the posted blinds.

    pokerkit posts blinds as actual bets:
      - 3+ players: bets = [SB, BB, 0, ...]  -> button is the last seat.
      - heads-up:   bets = [BB, SB]          -> button is the small blind seat.
    """
    bets = list(state.bets)
    n = len(bets)
    posted = [(i, b) for i, b in enumerate(bets) if b]
    posted.sort(key=lambda t: t[1])  # smallest bet == small blind
    sb_i = posted[0][0] if posted else 0
    bb_i = posted[-1][0] if len(posted) > 1 else (1 % n)
    # Heads-up: the button is the small blind. Otherwise the button is the
    # seat immediately before the small blind.
    button_i = sb_i if n == 2 else (sb_i - 1) % n
    return {"sb": sb_i, "bb": bb_i, "button": button_i}


def dumps(state) -> str:
    return base64.b64encode(pickle.dumps(state)).decode("ascii")


def loads(blob: str):
    return pickle.loads(base64.b64decode(blob.encode("ascii")))


def card_str(card) -> str:
    """pokerkit Card repr is already the compact form, e.g. '7h', 'Ts', 'Ad'."""
    return repr(card)


def boards(state) -> list[list[str]]:
    """Every board dealt, as one list of cards each.

    ``state.board_cards`` is laid out the other way round: one row per card
    position, holding that position's card *on each board*. With one board
    that is a list of one-element rows and the distinction never comes up;
    with two it is the difference between two boards and one board of ten
    cards, dealt interleaved.
    """
    count = max(1, int(getattr(state, "board_count", 1) or 1))
    out: list[list[str]] = [[] for _ in range(count)]
    for row in state.board_cards:
        try:
            cards = [card_str(c) for c in row]
        except TypeError:
            cards = [card_str(row)]
        for i, card in enumerate(cards):
            if i < count:
                out[i].append(card)
    return out


def board_cards(state, index: int = 0) -> list[str]:
    """One board's cards. The first one unless asked otherwise."""
    dealt = boards(state)
    return dealt[index] if index < len(dealt) else []


def runout_choosers(state) -> list[int]:
    """Seats still to say how many times they want the rest dealt.

    Non-empty only after everybody is all-in with board to come, and only on a
    table whose host turned the rule on. The hand does not move until they have
    all answered, which is what makes it a decision rather than a setting.
    """
    if not state.status:
        return []
    try:
        return list(state.runout_count_selector_indices)
    except Exception:
        return []


def choose_runout(state, count: int | None) -> None:
    """Record one player's answer. Everybody has to agree for the second board.

    pokerkit settles a disagreement the way a card room does: one run. So a
    player who wants it once only has to say so, and a player who says nothing
    at all is not taken to have agreed.
    """
    state.select_runout_count(count)


def hole_cards(state, index: int) -> list[str]:
    return [card_str(c) for c in state.hole_cards[index]]


def is_hand_over(state) -> bool:
    return not state.status


def legal_actions(state) -> dict[str, Any]:
    """Legal actions for whoever is currently to act."""
    if not state.status or state.actor_index is None:
        return {
            "canFold": False,
            "canCheckOrCall": False,
            "callAmount": 0,
            "canRaise": False,
            "minRaise": 0,
            "maxRaise": 0,
        }
    can_raise = state.can_complete_bet_or_raise_to()
    owed = int(state.checking_or_calling_amount or 0)
    return {
        # Never for free. Cash-game mode — which running it twice needs —
        # allows folding a hand you could check, which is legal everywhere and
        # pointless everywhere; offering it would just be a button that throws
        # away a free card.
        "canFold": bool(state.can_fold()) and owed > 0,
        "canCheckOrCall": bool(state.can_check_or_call()),
        "callAmount": int(state.checking_or_calling_amount or 0),
        "canRaise": bool(can_raise),
        "minRaise": int(state.min_completion_betting_or_raising_to_amount or 0)
        if can_raise
        else 0,
        "maxRaise": int(state.max_completion_betting_or_raising_to_amount or 0)
        if can_raise
        else 0,
    }


class ActionError(Exception):
    """Raised when a requested action is illegal."""


def apply_action(state, action: str, amount: int | None = None):
    """Apply a single betting action, validating it against pokerkit rules."""
    if not state.status or state.actor_index is None:
        raise ActionError("The hand is not awaiting an action.")

    if action == "fold":
        if not state.can_fold() or not state.checking_or_calling_amount:
            raise ActionError("You cannot fold right now.")
        state.fold()
    elif action == "check" or action == "call":
        if not state.can_check_or_call():
            raise ActionError("You cannot check or call right now.")
        state.check_or_call()
    elif action == "raise" or action == "bet":
        if amount is None:
            raise ActionError("A raise amount is required.")
        lo = state.min_completion_betting_or_raising_to_amount
        hi = state.max_completion_betting_or_raising_to_amount
        if lo is None or hi is None:
            raise ActionError("You cannot raise right now.")
        if not (lo <= amount <= hi):
            raise ActionError(f"Raise must be between {lo} and {hi}.")
        state.complete_bet_or_raise_to(amount)
    else:
        raise ActionError(f"Unknown action: {action}")
    return state


def pushed_amounts(state, seats: int) -> list[int]:
    """What each seat was actually awarded out of the pots.

    "Came out ahead" is not the same thing as "won a pot", and the difference
    is not academic: a short all-in wins the main pot while somebody else takes
    the side pot, and that somebody can finish the hand down on the deal.
    Netting their stack against what they started with calls them a loser of a
    pot they demonstrably won — which is how a side-pot winner with seven-deuce
    quietly fails to collect the bonus.

    pokerkit records every push it makes as an operation on the state we
    already serialize, so this reads the answer instead of inferring it.
    """
    totals = [0] * seats
    for op in state.operations:
        if isinstance(op, ChipsPushing):
            for i, amount in enumerate(op.amounts):
                if i < seats:
                    totals[i] += int(amount)
    return totals


def pushed_by_board(state, seats: int) -> list[list[int]]:
    """Which seats were paid off each board, in board order.

    The drama of running it twice is entirely in "she took the first one, he
    took the second", and that is not something the final stacks can tell you —
    a player who wins both and a player who chops both come out the same. The
    engine records a push per board, so it is asked.
    """
    count = max(1, int(getattr(state, "board_count", 1) or 1))
    out: list[list[int]] = [[] for _ in range(count)]
    for op in state.operations:
        if not isinstance(op, ChipsPushing):
            continue
        # No board named means the pot was not contested board by board —
        # everybody else had folded or been killed, so the one player left took
        # every board there was. Naming only the first would report a hand that
        # was won outright as a hand that was split.
        targets = range(count) if op.board_index is None else [op.board_index]
        for board in targets:
            if board >= count:
                continue
            for seat, amount in enumerate(op.amounts):
                if seat < seats and amount > 0 and seat not in out[board]:
                    out[board].append(seat)
    return out


def pot_total(state, hand_start_stacks: list[int]) -> int:
    """Chips already collected into the pot (excludes chips currently bet in
    front of players on the active street)."""
    committed = sum(hand_start_stacks) - sum(int(s) for s in state.stacks)
    front = sum(int(b) for b in state.bets)
    return max(0, committed - front)


def side_pots(state) -> list[dict[str, Any]]:
    """The pots as they actually stand, main first, with who can win each.

    A single number is a lie as soon as somebody is all in for less than the
    bet: the short stack is playing for the main pot and everybody else is
    playing for that *plus* a side pot they cannot win. Told only the total, a
    player cannot work out what their call is actually chasing.

    Sums to :func:`pot_total` by construction — pokerkit's pots exclude what is
    still out on the felt this street, which is the same line that function
    draws. Empty between hands and once the chips have been pushed.
    """
    out: list[dict[str, Any]] = []
    for pot in state.pots:
        amount = int(pot.amount)
        if amount <= 0:
            continue
        out.append({"amount": amount, "seats": [int(i) for i in pot.player_indices]})
    return out


def action_mark(state) -> int:
    """A bookmark in the engine's own log, taken before an action is applied.

    Paired with :func:`describe_action`, which reads back everything the
    engine recorded past this point.
    """
    return len(state.operations)


def describe_action(
    state,
    mark: int,
    seat: int,
    bets_before: list[int],
    stack_before: int,
) -> dict[str, Any] | None:
    """Name what a player just did, from the table's point of view.

    pokerkit has three verbs; a table has five. Checking and calling are the
    same move to the engine and the opposite move to everyone watching, and
    opening a street is not the same thing as raising somebody — "raises to
    900" when nobody had bet describes a hand that never happened.

    Read off the operations the engine wrote rather than off the state
    afterwards, because by the time this runs the state has moved on twice
    over: pokerkit collects the bets the moment a street closes, so the last
    call of a street reports a table where nobody had bet anything, and it
    pushes the pot the moment a hand ends, so the last fold of a hand reports
    a player whose stack went *up*.
    """
    verb = None
    amount = 0
    for op in state.operations[mark:]:
        if getattr(op, "player_index", None) != seat:
            continue
        if isinstance(op, Folding):
            verb, amount = "fold", 0
            break
        if isinstance(op, CheckingOrCalling):
            verb, amount = "call", int(op.amount)
            break
        if isinstance(op, CompletionBettingOrRaisingTo):
            verb, amount = "raise", int(op.amount)
            break
    if verb is None:
        return None

    mine = int(bets_before[seat]) if seat < len(bets_before) else 0
    others = [b for i, b in enumerate(bets_before) if i != seat]
    highest = max(others) if others else 0

    if verb == "fold":
        kind, put_in, to = "fold", 0, mine
    elif verb == "call":
        # The engine's amount is what leaves the stack, so a free card is a
        # zero and that is exactly the check the table would call out.
        kind = "call" if amount > 0 else "check"
        put_in, to = amount, mine + amount
    else:
        # A raise names the level it raises *to*, not what it costs.
        kind = "raise" if highest > 0 else "bet"
        put_in, to = amount - mine, amount

    return {
        "kind": kind,
        # What this decision cost them, and where it left their bet. Both,
        # because "calls 300" and "raises to 900" are the two numbers a table
        # says out loud and neither can be worked out from the other.
        "amount": put_in,
        "to": to,
        # Their whole stack went in. Not a kind of its own: somebody can be
        # all in *and* calling, and collapsing the two loses which it was.
        "allIn": kind != "fold" and stack_before - put_in <= 0,
    }


# --------------------------------------------------------------------------- #
# Hand naming
# --------------------------------------------------------------------------- #
_RANKS = "23456789TJQKA"
_SINGULAR = {
    "2": "deuce", "3": "three", "4": "four", "5": "five", "6": "six",
    "7": "seven", "8": "eight", "9": "nine", "T": "ten", "J": "jack",
    "Q": "queen", "K": "king", "A": "ace",
}
_PLURAL = {
    "2": "deuces", "3": "threes", "4": "fours", "5": "fives", "6": "sixes",
    "7": "sevens", "8": "eights", "9": "nines", "T": "tens", "J": "jacks",
    "Q": "queens", "K": "kings", "A": "aces",
}


def _straight_ends(ranks: list[str]) -> tuple[str, str]:
    """Low and high card of a straight, naming the wheel as ace-to-five."""
    order = sorted(_RANKS.index(r) for r in ranks)
    if order == [0, 1, 2, 3, 12]:  # A-2-3-4-5: the ace plays low
        return "A", "5"
    return _RANKS[order[0]], _RANKS[order[-1]]


def _describe(cards: list[str], label: str) -> str:
    """Turn pokerkit's category into what a player would say out loud."""
    ranks = [c[:-1] for c in cards]
    counts = Counter(ranks)
    # Most repeated first, then highest — so pairs come before kickers.
    grouped = sorted(counts.items(), key=lambda kv: (-kv[1], -_RANKS.index(kv[0])))
    high = max(ranks, key=lambda r: _RANKS.index(r))

    if label == "High card":
        return f"{_SINGULAR[high].capitalize()} high"
    if label == "One pair":
        return f"Pair of {_PLURAL[grouped[0][0]]}"
    if label == "Two pair":
        return f"Two pair, {_PLURAL[grouped[0][0]]} and {_PLURAL[grouped[1][0]]}"
    if label == "Three of a kind":
        return f"Three of a kind, {_PLURAL[grouped[0][0]]}"
    if label == "Four of a kind":
        return f"Four of a kind, {_PLURAL[grouped[0][0]]}"
    if label == "Full house":
        return f"Full house, {_PLURAL[grouped[0][0]]} over {_PLURAL[grouped[1][0]]}"
    if label == "Flush":
        return f"Flush, {_SINGULAR[high]} high"
    if label in ("Straight", "Straight flush"):
        low, top = _straight_ends(ranks)
        if label == "Straight flush":
            return (
                "Royal flush"
                if top == "A"
                else f"Straight flush, {_SINGULAR[low]} to {_SINGULAR[top]}"
            )
        return f"Straight, {_SINGULAR[low]} to {_SINGULAR[top]}"
    return label


def evaluate_hand(hole: list[str], board: list[str]) -> dict[str, Any] | None:
    """Best five cards a player can make, and what that hand is called.

    Returns None when the hand can't be evaluated (not enough cards dealt, or
    pokerkit rejects the input), because a missing name is never worth failing
    a showdown over.
    """
    if len(hole) + len(board) < 5:
        return None
    try:
        hand = StandardHighHand.from_game("".join(hole), "".join(board))
    except Exception:
        return None
    cards = [card_str(c) for c in hand.cards]
    return {"cards": cards, "name": _describe(cards, hand.entry.label.value)}


# Cards each remaining street would have been dealt, given how much board is
# already out. Hold'em only ever stops at one of these.
_REMAINING_STREETS = {
    0: (("flop", 3), ("turn", 1), ("river", 1)),
    3: (("turn", 1), ("river", 1)),
    4: (("river", 1),),
    5: (),
}


def would_have_come(state) -> list[dict[str, Any]]:
    """The board that never happened, for a hand that ended early.

    The deck is still sitting in the state we serialize, in order, so this is
    pure arithmetic — but it has to account for the burn. pokerkit burns a card
    before every street (``CARD_BURNING`` is automated), so the flop is not the
    top three cards, it is the three *after* the burn. Verified against the
    engine: dealing a flop consumes ``deck[0]`` and lays ``deck[1:4]``.

    Reading only; nothing here touches the state.
    """
    deck = [card_str(c) for c in state.deck_cards]
    out: list[dict[str, Any]] = []
    at = 0
    for name, count in _REMAINING_STREETS.get(len(board_cards(state)), ()):
        at += 1  # the burn
        cards = deck[at : at + count]
        if len(cards) < count:
            break  # a deck this short means something is wrong; say nothing
        out.append({"street": name, "cards": cards})
        at += count
    return out


def street_name(state) -> str:
    if not state.status or state.street_index is None:
        return "showdown"
    return {0: "preflop", 1: "flop", 2: "turn", 3: "river"}.get(
        state.street_index, "preflop"
    )

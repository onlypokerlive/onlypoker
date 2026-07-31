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

from pokerkit import Automation, NoLimitTexasHoldem, StandardHighHand

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


def create_hand(starting_stacks: list[int], small_blind: int, big_blind: int):
    """Create a fresh hand. ``starting_stacks`` is in seat order where index 0
    is the small blind, index 1 the big blind, and the final index the button
    (pokerkit posts blinds positionally from index 0)."""
    return NoLimitTexasHoldem.create_state(
        automations=_AUTOMATIONS,
        ante_trimming_status=True,
        raw_antes=0,
        raw_blinds_or_straddles=(small_blind, big_blind),
        min_bet=big_blind,
        raw_starting_stacks=tuple(starting_stacks),
        player_count=len(starting_stacks),
    )


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


def board_cards(state) -> list[str]:
    cards: list[str] = []
    for row in state.board_cards:
        # each dealt street entry is an iterable of Card
        try:
            cards.extend(card_str(c) for c in row)
        except TypeError:
            cards.append(card_str(row))
    return cards


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
    return {
        "canFold": bool(state.can_fold()),
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
        if not state.can_fold():
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


def pot_total(state, hand_start_stacks: list[int]) -> int:
    """Chips already collected into the pot (excludes chips currently bet in
    front of players on the active street)."""
    committed = sum(hand_start_stacks) - sum(int(s) for s in state.stacks)
    front = sum(int(b) for b in state.bets)
    return max(0, committed - front)


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

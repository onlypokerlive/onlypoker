"""Thin wrapper around pokerkit for a No-Limit Texas Hold'em cash game.

The pokerkit ``State`` object is fully picklable, so we serialize it to a
base64 string and stash it in Redis between requests. Every HTTP request
rebuilds the exact same game state by unpickling, applies at most one action,
then re-pickles. This keeps the engine authoritative and serverless-safe.
"""

from __future__ import annotations

import base64
import pickle
from typing import Any

from pokerkit import Automation, NoLimitTexasHoldem

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


def street_name(state) -> str:
    if not state.status or state.street_index is None:
        return "showdown"
    return {0: "preflop", 1: "flop", 2: "turn", 3: "river"}.get(
        state.street_index, "preflop"
    )

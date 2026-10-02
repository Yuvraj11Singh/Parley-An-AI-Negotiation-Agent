"""
safeguard.py — a transparent, rule-based walk-away safeguard layered on top
of a trained buyer agent. Imported by BOTH the live server (app/server.py)
and the evaluation code (src/evaluate.py) so live behaviour and measured
behaviour are governed by the exact same rule.

This is NOT a learned behaviour. Two retraining attempts (v7, v8) tried to
teach the agent itself to walk away from an unmovable seller, and both
failed their acceptance bars elsewhere — from the agent's point of view,
walking is always partly a guess, since it never observes the seller's
hidden floor. There is exactly one situation where walking is *not* a
guess: Parley's own offer is already pinned at its hidden maximum (it is
physically unable to concede any further) and the seller hasn't moved at
all while it sat there. In that situation no deal is reachable unless the
seller moves, so continuing only burns rounds toward a timeout. This module
checks for exactly that situation and nothing else — every other decision
in a negotiation is still the agent's own.
"""

# How many consecutive rounds Parley must have been pinned at its maximum,
# with the seller motionless throughout, before the safeguard fires.
# ExploitativeSeller (opponent.py) is designed to concede once the buyer has
# held firm for k = 2-4 rounds — N=4 is the smallest value that clears the
# top of that range, so the safeguard never cuts off a real concession that
# was already on its way. Verified in evaluation (deal rate against
# ExploitativeSeller must not fall below v6's).
SAFEGUARD_HOLD_ROUNDS = 4


def should_walk_away(state, n: int = SAFEGUARD_HOLD_ROUNDS) -> bool:
    """
    True when, for the most recent `n` rounds, Parley's offer has stayed at
    its maximum (state.limit_rounds >= n) AND the seller's ask hasn't
    dropped by at least deal_tolerance at any point during that same
    trailing window (state.stall_rounds >= n).

    Both `limit_rounds` and `stall_rounds` are backward-scans over
    `state.history` already defined on NegotiationState (environment.py) —
    this function adds no separate tracking and no new rule beyond
    requiring both streaks to cover the same most-recent `n` rounds.
    """
    return state.limit_rounds >= n and state.stall_rounds >= n

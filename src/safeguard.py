"""
safeguard.py — transparent, rule-based walk-away safeguards layered on top
of a trained buyer agent. Imported by BOTH the live server (app/server.py)
and the evaluation code (src/evaluate.py) so live behaviour and measured
behaviour are governed by the exact same rules.

Two rules, checked in this order:

  Rule A (always on) — a DEADLOCK: for the most recent `n` completed
  rounds, neither side has moved — the seller's ask hasn't dropped by at
  least deal_tolerance(buyer_max), AND Parley's own offer hasn't risen by
  at least deal_tolerance(buyer_max). This subsumes the original
  at-the-limit rule (at the limit, Parley's offer literally cannot rise,
  so it's always "frozen" there) and also covers a case that rule missed:
  Parley stuck holding firm well BELOW its maximum in a state the trained
  policy never learned a real move for (every action tied at 0.0, and
  deterministic tie-breaking always picks "hold firm" — see agent.py). The
  original rule required Parley to be AT its limit, so it never fired for
  these stuck-below-limit negotiations; they just ran out the clock.

  Rule B (OFF by default, RULE_B_ENABLED) — a blunter STUBBORN-SELLER
  rule: walk once the seller's ask alone has been frozen for `m`
  consecutive rounds, regardless of what Parley is doing. Uses a distinct
  walk_reason ("seller_stalled") specifically so its cost (negotiations
  where Parley was still making real progress and would have closed) can
  be weighed separately from Rule A's.
"""

from .environment import deal_tolerance

SAFEGUARD_HOLD_ROUNDS = 4          # Rule A's N
RULE_B_ENABLED = False              # Rule B is opt-in, off by default
RULE_B_STALL_ROUNDS = 6             # Rule B's M


def _deadlock_rounds(state) -> int:
    """How many of the most recent consecutive COMPLETED rounds neither the
    seller's ask nor Parley's own offer moved by at least
    deal_tolerance(buyer_max) — same backward-scan over state.history as
    stall_rounds/limit_rounds (environment.py), combining both conditions
    with AND instead of tracking them separately. An offer that (abnormally)
    fell, or an ask that rose, both still count as "frozen" on that side,
    matching stall_rounds' existing treatment of an ask that rises.

    Counting convention (must hold for the server and evaluate.py to agree
    — see tests/test_safeguard_consistency.py): state.history holds exactly
    one entry per completed round, appended only after that round is fully
    resolved, and this function is always called before the round currently
    being decided has an entry.
    """
    history = state.history
    if len(history) < 2:
        return 0
    tol = deal_tolerance(state.buyer_max)
    count = 0
    for i in range(len(history) - 1, 0, -1):
        prev_offer, prev_ask = history[i - 1][1], history[i - 1][2]
        curr_offer, curr_ask = history[i][1], history[i][2]
        seller_frozen = (prev_ask - curr_ask) < tol
        buyer_frozen = (curr_offer - prev_offer) < tol
        if seller_frozen and buyer_frozen:
            count += 1
        else:
            break
    return count


def should_walk_away(state, n: int = SAFEGUARD_HOLD_ROUNDS,
                      rule_b_enabled: bool = RULE_B_ENABLED,
                      m: int = RULE_B_STALL_ROUNDS):
    """Returns the walk_reason string if a rule fires this round, else None.
    Rule A ("safeguard") is checked first; Rule B ("seller_stalled"), only
    when explicitly enabled, is checked second."""
    if _deadlock_rounds(state) >= n:
        return "safeguard"
    if rule_b_enabled and state.stall_rounds >= m:
        return "seller_stalled"
    return None

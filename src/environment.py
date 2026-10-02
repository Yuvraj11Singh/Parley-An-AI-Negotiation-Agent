from dataclasses import dataclass, field

@dataclass
class NegotiationState:
    """Everything true about one in-progress negotiation."""
    buyer_max: float          # buyer's true reservation price (private)
    seller_min: float         # seller's true reservation price (private)
    buyer_offer: float        # buyer's current offer on the table
    seller_ask: float         # seller's current ask on the table
    round: int = 0
    done: bool = False
    outcome: str | None = None      # "deal" | "walk" | "timeout"
    deal_price: float | None = None
    history: list = field(default_factory=list)

    @property
    def gap(self) -> float:
        return max(0.0, self.seller_ask - self.buyer_offer)

    @property
    def zopa(self) -> float:
        """Zone of Possible Agreement — positive if a deal is theoretically possible."""
        return self.buyer_max - self.seller_min

    @property
    def stall_rounds(self) -> int:
        """How many of the most recent consecutive rounds the seller's ask
        has failed to decrease by at least deal_tolerance (an ask that rose
        counts as a stall too). Computed from `history`, which `reset()`
        seeds with the opening ask as round 0 — no separate tracking."""
        if len(self.history) < 2:
            return 0
        tol = deal_tolerance(self.buyer_max)
        count = 0
        for i in range(len(self.history) - 1, 0, -1):
            prev_ask = self.history[i - 1][2]
            curr_ask = self.history[i][2]
            if prev_ask - curr_ask < tol:
                count += 1
            else:
                break
        return count

    @property
    def limit_rounds(self) -> int:
        """How many of the most recent consecutive rounds (including now)
        Parley's offer has been at its maximum — buyer_offer >= buyer_max -
        deal_tolerance. Computed from `history`'s recorded offers, same
        backward-scan pattern as stall_rounds; the seeded round-0 "opening"
        entry (offer = buyer_max * 0.35) is always far below the limit, so
        it naturally stops the scan without special-casing it."""
        if not self.history:
            return 0
        tol = deal_tolerance(self.buyer_max)
        at_limit = self.buyer_max - tol
        count = 0
        for i in range(len(self.history) - 1, -1, -1):
            offer_at_i = self.history[i][1]
            if offer_at_i >= at_limit:
                count += 1
            else:
                break
        return count


import random

ACTIONS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, "WALK"]
MAX_ROUNDS = 15

# Deal-closing tolerance, expressed as a fraction of the buyer's own max
# price rather than a fixed absolute amount — a negotiation over $50k
# needs a different absolute "close enough" margin than one over $50.
# 0.05% of buyer_max reproduces the original fixed 0.05 tolerance exactly
# at the environment's original ~100-unit price scale.
DEAL_TOLERANCE_FRACTION = 0.0005


def deal_tolerance(buyer_max: float) -> float:
    return max(1e-9, buyer_max) * DEAL_TOLERANCE_FRACTION


class NegotiationEnv:
    """
    A single-issue (price-only) buyer/seller negotiation.

    Usage:
        env = NegotiationEnv(opponent)
        state = env.reset()
        while not state.done:
            action = agent.act(state)
            state, reward = env.step(action)
    """

    def __init__(self, opponent, max_rounds: int = MAX_ROUNDS,
                 buyer_max_range=(70, 130), seller_min_range=(35, 100)):
        self.opponent = opponent
        self.max_rounds = max_rounds
        self.buyer_max_range = buyer_max_range
        self.seller_min_range = seller_min_range

    def reset(self) -> NegotiationState:
        buyer_max = random.uniform(*self.buyer_max_range)
        seller_min = random.uniform(*self.seller_min_range)
        buyer_offer = max(0.0, buyer_max * 0.35 + random.uniform(0, 10))

        self.opponent.reset(seller_min)
        seller_ask = self.opponent.opening_ask(seller_min)

        self.state = NegotiationState(
            buyer_max=buyer_max,
            seller_min=seller_min,
            buyer_offer=buyer_offer,
            seller_ask=seller_ask,
        )
        # seed history with the opening ask as "round 0" so stall_rounds has
        # a real previous ask to compare against from round 2 onward
        self.state.history.append((0, buyer_offer, seller_ask, "opening"))
        return self.state

    def step(self, action):
        s = self.state
        if s.done:
            raise RuntimeError("step() called on a finished negotiation — call reset() first.")

        s.round += 1

        if action == "WALK":
            s.done = True
            s.outcome = "walk"
            s.history.append((s.round, s.buyer_offer, s.seller_ask, "buyer walked away"))
            return s, 0.0

        concession = float(action)
        s.buyer_offer = min(s.buyer_max, s.buyer_offer + concession * s.gap)

        if s.buyer_offer >= s.seller_ask - deal_tolerance(s.buyer_max):
            s.done = True
            s.outcome = "deal"
            s.deal_price = s.seller_ask
            reward = max(0.0, s.buyer_max - s.deal_price)
            s.history.append((s.round, s.buyer_offer, s.seller_ask, f"deal closed @ {s.deal_price:.1f}"))
            return s, reward

        s.seller_ask = self.opponent.respond(s)

        if s.buyer_offer >= s.seller_ask - deal_tolerance(s.buyer_max):
            s.done = True
            s.outcome = "deal"
            s.deal_price = s.seller_ask
            reward = max(0.0, s.buyer_max - s.deal_price)
            s.history.append((s.round, s.buyer_offer, s.seller_ask, f"deal closed @ {s.deal_price:.1f}"))
            return s, reward

        s.history.append((s.round, s.buyer_offer, s.seller_ask, "—"))

        if s.round >= self.max_rounds:
            s.done = True
            s.outcome = "timeout"
            return s, 0.0

        return s, 0.0

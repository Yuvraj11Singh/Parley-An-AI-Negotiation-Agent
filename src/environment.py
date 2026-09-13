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


import random

ACTIONS = [0.0, 0.15, 0.35, 0.6, 0.85, 1.0, "WALK"]
MAX_ROUNDS = 10
DEAL_TOLERANCE = 0.05


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

        if s.buyer_offer >= s.seller_ask - DEAL_TOLERANCE:
            s.done = True
            s.outcome = "deal"
            s.deal_price = s.seller_ask
            reward = max(0.0, s.buyer_max - s.deal_price)
            s.history.append((s.round, s.buyer_offer, s.seller_ask, f"deal closed @ {s.deal_price:.1f}"))
            return s, reward

        s.seller_ask = self.opponent.respond(s)

        if s.buyer_offer >= s.seller_ask - DEAL_TOLERANCE:
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

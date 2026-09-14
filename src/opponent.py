import random


class BaseSeller:
    def opening_ask(self, seller_min: float) -> float:
        raise NotImplementedError

    def reset(self, seller_min: float) -> None:
        pass

    def respond(self, state) -> float:
        raise NotImplementedError


class FixedScheduleSeller(BaseSeller):
    """Original single-schedule seller. Kept as the 'before' baseline."""

    TOUGHNESS_PARAMS = {
        "slow":   dict(base=0.07, growth=0.008),
        "medium": dict(base=0.14, growth=0.018),
        "fast":   dict(base=0.24, growth=0.03),
    }

    def __init__(self, toughness: str = "medium"):
        if toughness not in self.TOUGHNESS_PARAMS:
            raise ValueError(f"unknown toughness '{toughness}'")
        self.toughness = toughness
        self._seller_min = None

    def reset(self, seller_min: float) -> None:
        self._seller_min = seller_min

    def opening_ask(self, seller_min: float) -> float:
        return seller_min + (seller_min * 0.4 + 15 + random.uniform(0, 15))

    def _concession_rate(self, round_num: int) -> float:
        p = self.TOUGHNESS_PARAMS[self.toughness]
        return min(0.9, p["base"] + p["growth"] * round_num)

    def respond(self, state) -> float:
        rate = self._concession_rate(state.round)
        new_ask = state.seller_ask - rate * (state.seller_ask - state.buyer_offer)
        return max(self._seller_min, new_ask)


class RandomizedSeller(BaseSeller):
    """
    Same underlying mechanic as FixedScheduleSeller, but every episode
    draws a fresh toughness, opening markup, and concession growth rate
    instead of using one fixed schedule. Also includes a chance of
    genuine multi-round stalls — holding the ask nearly flat for a few
    rounds — so the agent learns to handle real stubbornness rather than
    only ever facing opponents who move a little every single round.
    """

    def __init__(self, base_range=(0.05, 0.30), growth_range=(0.005, 0.035),
                 markup_range=(0.2, 0.7), stall_chance=0.18, stall_round_range=(2, 4)):
        self.base_range = base_range
        self.growth_range = growth_range
        self.markup_range = markup_range
        self.stall_chance = stall_chance
        self.stall_round_range = stall_round_range
        self._seller_min = None
        self._base = None
        self._growth = None
        self._markup = None
        self._stall_until_round = 0

    def reset(self, seller_min: float) -> None:
        self._seller_min = seller_min
        self._base = random.uniform(*self.base_range)
        self._growth = random.uniform(*self.growth_range)
        self._markup = random.uniform(*self.markup_range)
        if random.random() < self.stall_chance:
            self._stall_until_round = random.randint(*self.stall_round_range)
        else:
            self._stall_until_round = 0

    def opening_ask(self, seller_min: float) -> float:
        return seller_min + (seller_min * self._markup + 10 + random.uniform(0, 20))

    def _concession_rate(self, round_num: int) -> float:
        if round_num <= self._stall_until_round:
            return 0.0
        return min(0.9, self._base + self._growth * round_num)

    def respond(self, state) -> float:
        rate = self._concession_rate(state.round)
        new_ask = state.seller_ask - rate * (state.seller_ask - state.buyer_offer)
        return max(self._seller_min, new_ask)


class MixedSeller(BaseSeller):
    """
    Training pool: each episode draws one opponent type. Weighted toward
    the randomized seller but with a substantial share of persistently
    slow fixed-schedule sellers, which the previous training distribution
    under-represented.
    """

    def __init__(self, weights=None):
        self.pool = [
            RandomizedSeller(),
            FixedScheduleSeller("slow"),
            FixedScheduleSeller("medium"),
            FixedScheduleSeller("fast"),
        ]
        self.weights = weights or [0.55, 0.25, 0.10, 0.10]
        self._current = None

    def reset(self, seller_min: float) -> None:
        self._current = random.choices(self.pool, weights=self.weights, k=1)[0]
        self._current.reset(seller_min)

    def opening_ask(self, seller_min: float) -> float:
        return self._current.opening_ask(seller_min)

    def respond(self, state) -> float:
        return self._current.respond(state)

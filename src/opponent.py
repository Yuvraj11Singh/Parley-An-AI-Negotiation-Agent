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
    The generalization fix: draws a fresh toughness, opening markup, and
    concession growth rate every episode instead of using one fixed
    schedule.
    """

    def __init__(self, base_range=(0.05, 0.30), growth_range=(0.005, 0.035),
                 markup_range=(0.2, 0.7)):
        self.base_range = base_range
        self.growth_range = growth_range
        self.markup_range = markup_range
        self._seller_min = None
        self._base = None
        self._growth = None
        self._markup = None

    def reset(self, seller_min: float) -> None:
        self._seller_min = seller_min
        self._base = random.uniform(*self.base_range)
        self._growth = random.uniform(*self.growth_range)
        self._markup = random.uniform(*self.markup_range)

    def opening_ask(self, seller_min: float) -> float:
        return seller_min + (seller_min * self._markup + 10 + random.uniform(0, 20))

    def _concession_rate(self, round_num: int) -> float:
        return min(0.9, self._base + self._growth * round_num)

    def respond(self, state) -> float:
        rate = self._concession_rate(state.round)
        new_ask = state.seller_ask - rate * (state.seller_ask - state.buyer_offer)
        return max(self._seller_min, new_ask)

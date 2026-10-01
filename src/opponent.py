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


class StubbornSeller(BaseSeller):
    """
    Opens with a markup over its own minimum and then almost never moves —
    added in v7 so the agent sees genuinely immovable sellers during
    training, not just ones who concede slowly.

    The markup is drawn relative to `seller_min` only (never `buyer_max`,
    which stays private) — but because the two are drawn independently
    from overlapping ranges, a meaningful share of episodes naturally end
    up with this seller's ask fixed above `buyer_max`, where no deal is
    reachable at all. In those episodes the only good response is to walk
    away rather than concede toward a price nobody will ever reach.
    """

    def __init__(self, markup_range=(0.30, 0.75), rare_move_chance=0.10,
                 rare_move_fraction=(0.01, 0.03)):
        self.markup_range = markup_range
        self.rare_move_chance = rare_move_chance
        self.rare_move_fraction = rare_move_fraction
        self._seller_min = None
        self._ask = None

    def reset(self, seller_min: float) -> None:
        self._seller_min = seller_min
        self._ask = None

    def opening_ask(self, seller_min: float) -> float:
        markup = random.uniform(*self.markup_range)
        self._ask = seller_min * (1 + markup)
        return self._ask

    def respond(self, state) -> float:
        if random.random() < self.rare_move_chance:
            frac = random.uniform(*self.rare_move_fraction)
            self._ask = max(self._seller_min, self._ask - frac * (self._ask - state.buyer_offer))
        return self._ask


class ExploitativeSeller(BaseSeller):
    """
    Punishes caving — added in v7 so the agent learns that conceding isn't
    always the way to make progress. Holds its ask firm while the buyer
    keeps raising its own offer, and only starts conceding once the buyer
    has held its offer flat for at least `k` consecutive rounds (k is
    randomized per episode, 2-4). Its floor sits below `buyer_max`, so a
    real deal is reachable here — but only by holding firm first.

    "Buyer held firm" is read off how `buyer_offer` moves across
    `state.history` (unchanged between two consecutive rounds means the
    buyer's last action was a 0.0 concession) rather than the buyer's raw
    action, which a real opponent couldn't observe directly either.
    """

    def __init__(self, markup_range=(0.25, 0.55), hold_k_range=(2, 4),
                 concession_rate=0.22):
        self.markup_range = markup_range
        self.hold_k_range = hold_k_range
        self.concession_rate = concession_rate
        self._seller_min = None
        self._ask = None
        self._hold_k = None

    def reset(self, seller_min: float) -> None:
        self._seller_min = seller_min
        self._ask = None
        self._hold_k = random.randint(*self.hold_k_range)

    def opening_ask(self, seller_min: float) -> float:
        markup = random.uniform(*self.markup_range)
        self._ask = seller_min + seller_min * markup + random.uniform(0, 10)
        return self._ask

    @staticmethod
    def _buyer_hold_streak(state) -> int:
        history = state.history
        if len(history) < 2:
            return 0
        count = 0
        for i in range(len(history) - 1, 0, -1):
            prev_offer = history[i - 1][1]
            curr_offer = history[i][1]
            if curr_offer == prev_offer:
                count += 1
            else:
                break
        return count

    def respond(self, state) -> float:
        if self._buyer_hold_streak(state) >= self._hold_k:
            self._ask = max(self._seller_min, self._ask - self.concession_rate * (self._ask - state.buyer_offer))
        return self._ask


class MixedSeller(BaseSeller):
    """
    Training pool: each episode draws one opponent type. Weighted toward
    the randomized seller but with a substantial share of persistently
    slow fixed-schedule sellers, which the previous training distribution
    under-represented. v7 adds StubbornSeller and ExploitativeSeller at
    15% each, scaling the pre-existing pool down to 70% in total so the
    original relative mix among those four is preserved.
    """

    def __init__(self, weights=None):
        self.pool = [
            RandomizedSeller(),
            FixedScheduleSeller("slow"),
            FixedScheduleSeller("medium"),
            FixedScheduleSeller("fast"),
            StubbornSeller(),
            ExploitativeSeller(),
        ]
        self.weights = weights or [0.385, 0.175, 0.07, 0.07, 0.15, 0.15]
        self._current = None

    def reset(self, seller_min: float) -> None:
        self._current = random.choices(self.pool, weights=self.weights, k=1)[0]
        self._current.reset(seller_min)

    def opening_ask(self, seller_min: float) -> float:
        return self._current.opening_ask(seller_min)

    def respond(self, state) -> float:
        return self._current.respond(state)

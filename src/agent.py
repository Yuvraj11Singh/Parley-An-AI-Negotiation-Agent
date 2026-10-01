"""
agent.py — the buyer's tabular Q-learning agent.

State is (round bucket, gap bucket, stall bucket) where gap is the seller's
current ask minus buyer's current offer, measured as a fraction of the
buyer's own max price and discretized — this keeps the state scale-invariant
across price ranges (a $5 gap on a $50 deal and a $5,000 gap on a
$50,000 deal look identical to the agent). The stall bucket (added in v7)
tracks how many consecutive recent rounds the seller's ask has failed to
move, so the agent can tell a stubborn seller apart from a cooperative one
— something round/gap alone cannot express. Reward only arrives at the end
of a negotiation (deal surplus, or 0, minus v7's small round cost), so the
agent updates its whole round-by-round trajectory using a Monte Carlo
return once the episode finishes, rather than bootstrapping mid-episode.
"""

import json
from pathlib import Path
import random

from .environment import ACTIONS, MAX_ROUNDS

GAP_BUCKETS = 24
GAP_STEP = 0.05   # each bucket is 5% of the buyer's own max price

STALL_BUCKETS = 5  # 0, 1, 2, 3-4, 5+

MODEL_VERSION = 2  # 2 = adds the stall-count state dimension (v7+)


class QLearningAgent:
    def __init__(self, alpha: float = 0.15, gamma: float = 0.92,
                 epsilon_start: float = 0.3, epsilon_min: float = 0.03,
                 epsilon_decay: float = 0.999, max_rounds: int = MAX_ROUNDS,
                 use_stall_feature: bool = True):
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon_start
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.max_rounds = max_rounds
        self.round_buckets = max_rounds + 1

        self.use_stall_feature = use_stall_feature
        self.stall_buckets_eff = STALL_BUCKETS if use_stall_feature else 1

        # round_cost is a training-time hyperparameter; the agent itself
        # never reads it — it's carried here only so it round-trips into
        # the saved model's metadata for reproducibility.
        self.round_cost = 0.0

        # Q[round_bucket][gap_bucket][stall_bucket] -> list of action values.
        # Always stored 4-D internally, even when the stall feature is off
        # (stall_buckets_eff=1 then) — this keeps act()/end_episode() free
        # of branching, and lets a v6 (3-D, no-stall) table be loaded by
        # wrapping each gap bucket's action list in a length-1 stall axis.
        self.Q = self._blank_q()
        self._trajectory = []  # cleared at the start of each episode

    def _blank_q(self):
        return [
            [[[0.0] * len(ACTIONS) for _ in range(self.stall_buckets_eff)] for _ in range(GAP_BUCKETS)]
            for _ in range(self.round_buckets)
        ]

    @staticmethod
    def _gap_to_bucket(state) -> int:
        """Gap as a fraction of the buyer's own max — scale-invariant."""
        denom = max(1e-9, state.buyer_max)
        rel = max(0.0, state.gap) / denom
        b = round(rel / GAP_STEP)
        return min(GAP_BUCKETS - 1, b)

    def _stall_to_bucket(self, state) -> int:
        if not self.use_stall_feature:
            return 0
        n = state.stall_rounds
        if n <= 2:
            return n          # 0 -> 0, 1 -> 1, 2 -> 2
        if n <= 4:
            return 3          # 3-4
        return 4               # 5+

    def start_episode(self):
        self._trajectory = []

    def act(self, state, greedy: bool = False):
        round_b = min(self.round_buckets - 1, state.round)
        gap_b = self._gap_to_bucket(state)
        stall_b = self._stall_to_bucket(state)

        if not greedy and random.random() < self.epsilon:
            action_idx = random.randrange(len(ACTIONS))
        else:
            qs = self.Q[round_b][gap_b][stall_b]
            max_q = max(qs)
            best = [i for i, q in enumerate(qs) if q == max_q]
            action_idx = random.choice(best)

        if not greedy:
            self._trajectory.append((round_b, gap_b, stall_b, action_idx))

        return ACTIONS[action_idx]

    def end_episode(self, final_reward: float):
        """Monte Carlo backward update using the episode's terminal reward
        (already including v7's round-cost shaping, if any — applied by the
        caller, not here; see train.py)."""
        G = final_reward
        for round_b, gap_b, stall_b, action_idx in reversed(self._trajectory):
            q = self.Q[round_b][gap_b][stall_b][action_idx]
            self.Q[round_b][gap_b][stall_b][action_idx] = q + self.alpha * (G - q)
            G *= self.gamma
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    def save(self, path: str):
        meta = {
            "version": MODEL_VERSION,
            "actions": ACTIONS,
            "gap_buckets": GAP_BUCKETS,
            "use_stall_feature": self.use_stall_feature,
            "stall_buckets": self.stall_buckets_eff,
            "max_rounds": self.max_rounds,
            "round_cost": self.round_cost,
        }
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"Q": self.Q, "epsilon": self.epsilon, "meta": meta}, f)

    def load(self, path: str):
        with open(path) as f:
            data = json.load(f)

        meta = data.get("meta")
        if meta is None:
            # v6 and earlier: no metadata was ever written. Assume the only
            # config that era could have used, and wrap the 3-D Q table
            # ([round][gap][action]) into this agent's 4-D shape with a
            # single stall bucket, so act()/end_episode() stay branch-free.
            self.use_stall_feature = False
            self.stall_buckets_eff = 1
            self.round_cost = 0.0
            raw_Q = data["Q"]
            if len(raw_Q[0][0]) != len(ACTIONS):
                raise ValueError(
                    f"model '{path}' has no metadata and its action count "
                    f"({len(raw_Q[0][0])}) doesn't match the current ACTIONS "
                    f"({len(ACTIONS)}) — refusing to load a table that would "
                    f"silently misinterpret action indices."
                )
            self.Q = [[[action_values] for action_values in round_row] for round_row in raw_Q]
        else:
            if meta.get("actions") != ACTIONS:
                raise ValueError(
                    f"model '{path}' was trained with actions={meta.get('actions')}, "
                    f"but the current code uses ACTIONS={ACTIONS} — refusing to load."
                )
            if meta.get("gap_buckets") != GAP_BUCKETS:
                raise ValueError(
                    f"model '{path}' was trained with gap_buckets={meta.get('gap_buckets')}, "
                    f"but the current code uses GAP_BUCKETS={GAP_BUCKETS} — refusing to load."
                )
            if meta.get("max_rounds") != self.max_rounds:
                raise ValueError(
                    f"model '{path}' was trained with max_rounds={meta.get('max_rounds')}, "
                    f"but this agent is configured for max_rounds={self.max_rounds} — refusing to load."
                )
            use_stall = bool(meta.get("use_stall_feature", False))
            if use_stall and meta.get("stall_buckets") != STALL_BUCKETS:
                raise ValueError(
                    f"model '{path}' was trained with stall_buckets={meta.get('stall_buckets')}, "
                    f"but the current code uses STALL_BUCKETS={STALL_BUCKETS} — refusing to load."
                )
            self.use_stall_feature = use_stall
            self.stall_buckets_eff = meta["stall_buckets"] if use_stall else 1
            self.round_cost = meta.get("round_cost", 0.0)
            self.Q = data["Q"]

        self.epsilon = data.get("epsilon", self.epsilon_min)

"""
agent.py — the buyer's tabular Q-learning agent.

State is (round bucket, gap bucket, stall bucket, limit bucket):
  - gap: seller's current ask minus buyer's current offer, as a fraction of
    the buyer's own max price — scale-invariant across price ranges.
  - stall (v7): how many consecutive recent rounds the seller's ask has
    failed to move, so the agent can tell a stubborn seller apart from a
    cooperative one.
  - limit (v8): how many consecutive recent rounds Parley's own offer has
    been sitting at its maximum. At the limit, conceding is literally
    impossible, so the only real choices are waiting or walking — this
    disambiguates "tiny gap about to close" from "tiny gap that can never
    close", which the gap feature alone cannot (both look like a small
    relative gap; only tracking how long the buyer has been stuck there
    distinguishes them).

Reward only arrives at the end of a negotiation (deal surplus, 0 for a
walk, or v8's timeout penalty for a timeout), so the agent updates its
whole round-by-round trajectory using a Monte Carlo return once the
episode finishes, rather than bootstrapping mid-episode.
"""

import json
from pathlib import Path
import random

from .environment import ACTIONS, MAX_ROUNDS

GAP_BUCKETS = 24
GAP_STEP = 0.05   # each bucket is 5% of the buyer's own max price

STALL_BUCKETS = 5   # 0, 1, 2, 3-4, 5+
LIMIT_BUCKETS = 3   # 0 (below limit), 1 (at limit 1-2 rounds), 2 (at limit 3+ rounds)

MODEL_VERSION = 3  # 3 = adds the at-limit state dimension + visit counts (v8+)


class QLearningAgent:
    def __init__(self, alpha: float = 0.15, gamma: float = 0.92,
                 epsilon_start: float = 0.3, epsilon_min: float = 0.03,
                 epsilon_decay: float = 0.999, max_rounds: int = MAX_ROUNDS,
                 use_stall_feature: bool = True, use_limit_feature: bool = True):
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon_start
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.max_rounds = max_rounds
        self.round_buckets = max_rounds + 1

        self.use_stall_feature = use_stall_feature
        self.stall_buckets_eff = STALL_BUCKETS if use_stall_feature else 1
        self.use_limit_feature = use_limit_feature
        self.limit_buckets_eff = LIMIT_BUCKETS if use_limit_feature else 1

        # round_cost (v7) and timeout_penalty (v8) are training-time
        # hyperparameters; the agent itself never reads them during act() —
        # they're carried here only so they round-trip into the saved
        # model's metadata for reproducibility.
        self.round_cost = 0.0
        self.timeout_penalty = 0.0

        # diagnostic-only counters: how often a greedy (served/evaluation)
        # decision landed on a state where every action is tied (in
        # practice: never visited during training, so all Q-values are
        # still 0.0). Not saved/loaded, never read by act() itself — purely
        # for reporting how often the deterministic tie-break in greedy mode
        # (see act()) actually matters.
        self.greedy_calls = 0
        self.greedy_full_tie_calls = 0

        # Q[round][gap][stall][limit] -> list of action values. Always
        # stored 5-D internally, even when a feature is off (that axis's
        # effective size is then 1) — keeps act()/end_episode() branch-free
        # and lets older (3-D v6, 4-D v7) tables be loaded by wrapping the
        # missing trailing axes as length-1.
        self.Q = self._blank_table(0.0)
        self.N = self._blank_table(0)  # visit counts, same shape as Q
        self._trajectory = []  # cleared at the start of each episode

    def _blank_table(self, fill):
        return [
            [
                [
                    [[fill] * len(ACTIONS) for _ in range(self.limit_buckets_eff)]
                    for _ in range(self.stall_buckets_eff)
                ]
                for _ in range(GAP_BUCKETS)
            ]
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

    def _limit_to_bucket(self, state) -> int:
        if not self.use_limit_feature:
            return 0
        n = state.limit_rounds
        if n == 0:
            return 0          # below limit
        if n <= 2:
            return 1          # at limit 1-2 rounds
        return 2               # at limit 3+ rounds

    def start_episode(self):
        self._trajectory = []

    def act(self, state, greedy: bool = False):
        round_b = min(self.round_buckets - 1, state.round)
        gap_b = self._gap_to_bucket(state)
        stall_b = self._stall_to_bucket(state)
        limit_b = self._limit_to_bucket(state)

        if not greedy and random.random() < self.epsilon:
            action_idx = random.randrange(len(ACTIONS))
        else:
            qs = self.Q[round_b][gap_b][stall_b][limit_b]
            max_q = max(qs)
            best = [i for i, q in enumerate(qs) if q == max_q]
            if greedy:
                # served/evaluation: deterministic — the lowest-index tied
                # action (ACTIONS[0] == 0.0, hold firm, when every action is
                # tied). A frozen, greedy policy that still rolled dice among
                # ties wasn't actually frozen; the safeguard already handles
                # the hopeless at-limit case, so holding firm is the safe
                # default here, not a random guess including WALK.
                action_idx = min(best)
                self.greedy_calls += 1
                if len(best) == len(ACTIONS):
                    self.greedy_full_tie_calls += 1
            else:
                # training: unchanged — random tie-breaking is part of how
                # exploration gathers experience, and retraining is out of
                # scope here, so this path must keep behaving exactly as it
                # always has.
                action_idx = random.choice(best)

        if not greedy:
            self._trajectory.append((round_b, gap_b, stall_b, limit_b, action_idx))

        return ACTIONS[action_idx]

    def end_episode(self, final_reward: float):
        """Monte Carlo backward update using the episode's terminal reward
        (already including any reward shaping from the caller — see
        train.py; this method itself is shaping-agnostic)."""
        G = final_reward
        for round_b, gap_b, stall_b, limit_b, action_idx in reversed(self._trajectory):
            q = self.Q[round_b][gap_b][stall_b][limit_b][action_idx]
            self.Q[round_b][gap_b][stall_b][limit_b][action_idx] = q + self.alpha * (G - q)
            self.N[round_b][gap_b][stall_b][limit_b][action_idx] += 1
            G *= self.gamma
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    def save(self, path: str):
        meta = {
            "version": MODEL_VERSION,
            "actions": ACTIONS,
            "gap_buckets": GAP_BUCKETS,
            "use_stall_feature": self.use_stall_feature,
            "stall_buckets": self.stall_buckets_eff,
            "use_limit_feature": self.use_limit_feature,
            "limit_buckets": self.limit_buckets_eff,
            "max_rounds": self.max_rounds,
            "round_cost": self.round_cost,
            "timeout_penalty": self.timeout_penalty,
        }
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"Q": self.Q, "N": self.N, "epsilon": self.epsilon, "meta": meta}, f)

    def load(self, path: str):
        with open(path) as f:
            data = json.load(f)

        meta = data.get("meta")
        if meta is None:
            # v6 and earlier: no metadata was ever written, Q is 3-D
            # ([round][gap][action]). Wrap into this agent's 5-D shape with
            # a single stall bucket and a single limit bucket.
            self.use_stall_feature = False
            self.stall_buckets_eff = 1
            self.use_limit_feature = False
            self.limit_buckets_eff = 1
            self.round_cost = 0.0
            self.timeout_penalty = 0.0
            raw_Q = data["Q"]
            if len(raw_Q[0][0]) != len(ACTIONS):
                raise ValueError(
                    f"model '{path}' has no metadata and its action count "
                    f"({len(raw_Q[0][0])}) doesn't match the current ACTIONS "
                    f"({len(ACTIONS)}) — refusing to load a table that would "
                    f"silently misinterpret action indices."
                )
            new_Q = []
            for round_row in raw_Q:
                new_round = []
                for action_values in round_row:
                    new_round.append([[list(action_values)]])  # stall=1, limit=1
                new_Q.append(new_round)
            self.Q = new_Q
            self.N = self._blank_table(0)  # no visit counts were ever recorded for v6

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

            if "limit_buckets" in meta:
                # v8+: already 5-D, nothing to wrap
                use_limit = bool(meta.get("use_limit_feature", False))
                if use_limit and meta.get("limit_buckets") != LIMIT_BUCKETS:
                    raise ValueError(
                        f"model '{path}' was trained with limit_buckets={meta.get('limit_buckets')}, "
                        f"but the current code uses LIMIT_BUCKETS={LIMIT_BUCKETS} — refusing to load."
                    )
                self.use_limit_feature = use_limit
                self.limit_buckets_eff = meta["limit_buckets"] if use_limit else 1
                self.timeout_penalty = meta.get("timeout_penalty", 0.0)
                self.Q = data["Q"]
                self.N = data.get("N") or self._blank_table(0)
            else:
                # v7: 4-D ([round][gap][stall][action]), no limit dimension
                # and no visit counts. Wrap into 5-D with a single limit
                # bucket.
                self.use_limit_feature = False
                self.limit_buckets_eff = 1
                self.timeout_penalty = 0.0
                raw_Q = data["Q"]
                new_Q = []
                for round_row in raw_Q:
                    new_round = []
                    for gap_row in round_row:
                        new_gap = []
                        for action_values in gap_row:
                            new_gap.append([list(action_values)])  # limit=1
                        new_round.append(new_gap)
                    new_Q.append(new_round)
                self.Q = new_Q
                self.N = self._blank_table(0)  # v7 never recorded visit counts

        self.epsilon = data.get("epsilon", self.epsilon_min)

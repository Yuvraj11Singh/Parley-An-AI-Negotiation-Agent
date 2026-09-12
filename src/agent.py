"""
agent.py — the buyer's tabular Q-learning agent.

State is (round bucket, gap bucket) where gap = seller's current ask
minus buyer's current offer, discretized. Reward only arrives at the end
of a negotiation (deal surplus, or 0), so the agent updates its whole
round-by-round trajectory using a Monte Carlo return once the episode
finishes, rather than bootstrapping mid-episode.
"""

import json
import random
from pathlib import Path

from .environment import ACTIONS, MAX_ROUNDS

GAP_BUCKETS = 24
GAP_STEP = 5


class QLearningAgent:
    def __init__(self, alpha: float = 0.15, gamma: float = 0.92,
                 epsilon_start: float = 0.3, epsilon_min: float = 0.03,
                 epsilon_decay: float = 0.999, max_rounds: int = MAX_ROUNDS):
        self.alpha = alpha
        self.gamma = gamma
        self.epsilon = epsilon_start
        self.epsilon_min = epsilon_min
        self.epsilon_decay = epsilon_decay
        self.max_rounds = max_rounds
        self.round_buckets = max_rounds + 1

        # Q[round_bucket][gap_bucket] -> list of action values
        self.Q = [
            [[0.0] * len(ACTIONS) for _ in range(GAP_BUCKETS)]
            for _ in range(self.round_buckets)
        ]
        self._trajectory = []  # cleared at the start of each episode

    @staticmethod
    def _gap_to_bucket(gap: float) -> int:
        b = round(max(0.0, gap) / GAP_STEP)
        return min(GAP_BUCKETS - 1, b)

    def start_episode(self):
        self._trajectory = []

    def act(self, state, greedy: bool = False):
        round_b = min(self.round_buckets - 1, state.round)
        gap_b = self._gap_to_bucket(state.gap)

        if not greedy and random.random() < self.epsilon:
            action_idx = random.randrange(len(ACTIONS))
        else:
            qs = self.Q[round_b][gap_b]
            max_q = max(qs)
            best = [i for i, q in enumerate(qs) if q == max_q]
            action_idx = random.choice(best)

        if not greedy:
            self._trajectory.append((round_b, gap_b, action_idx))

        return ACTIONS[action_idx]

    def end_episode(self, final_reward: float):
        """Monte Carlo backward update using the episode's terminal reward."""
        G = final_reward
        for round_b, gap_b, action_idx in reversed(self._trajectory):
            q = self.Q[round_b][gap_b][action_idx]
            self.Q[round_b][gap_b][action_idx] = q + self.alpha * (G - q)
            G *= self.gamma
        self.epsilon = max(self.epsilon_min, self.epsilon * self.epsilon_decay)

    def save(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump({"Q": self.Q, "epsilon": self.epsilon}, f)

    def load(self, path: str):
        with open(path) as f:
            data = json.load(f)
        self.Q = data["Q"]
        self.epsilon = data.get("epsilon", self.epsilon_min)

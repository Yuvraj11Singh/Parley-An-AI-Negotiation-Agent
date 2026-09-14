"""
train.py — trains a buyer agent against a chosen seller opponent.

Usage:
    python -m src.train --opponent randomized --episodes 30000 --out models/buyer_randomized.json
    python -m src.train --opponent fixed --toughness medium --episodes 30000 --out models/buyer_fixed_medium.json
"""

import argparse
import csv
import random
from pathlib import Path

from .agent import QLearningAgent
from .environment import NegotiationEnv
from .opponent import FixedScheduleSeller, RandomizedSeller


def build_opponent(kind: str, toughness: str):
    if kind == "randomized":
        return RandomizedSeller()
    if kind == "fixed":
        return FixedScheduleSeller(toughness=toughness)
    raise ValueError(f"unknown opponent kind '{kind}'")


def train(episodes: int, opponent_kind: str, toughness: str, out_path: str,
          log_path: str = None, log_every: int = 100):
    opponent = build_opponent(opponent_kind, toughness)
    env = NegotiationEnv(opponent)
    agent = QLearningAgent()

    rows = []
    deals = 0
    surplus_sum = 0.0
    surplus_count = 0

    for ep in range(1, episodes + 1):
        agent.start_episode()
        state = env.reset()
        while not state.done:
            action = agent.act(state)
            state, reward = env.step(action)
        agent.end_episode(reward)

        if state.outcome == "deal":
            deals += 1
            zopa = state.zopa
            if zopa > 1:
                surplus_count += 1
                surplus_sum += max(0.0, min(1.0, reward / zopa))

        if log_path and ep % log_every == 0:
            rows.append({
                "episode": ep,
                "epsilon": round(agent.epsilon, 4),
                "deal_rate": round(deals / ep, 4),
                "avg_surplus_captured": round(surplus_sum / surplus_count, 4) if surplus_count else None,
            })

    agent.save(out_path)
    print(f"Trained {episodes} episodes vs '{opponent_kind}' opponent -> {out_path}")
    print(f"  final deal rate: {deals/episodes:.1%}")
    if surplus_count:
        print(f"  final avg surplus captured: {surplus_sum/surplus_count:.1%}")

    if log_path:
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=["episode", "epsilon", "deal_rate", "avg_surplus_captured"])
            writer.writeheader()
            writer.writerows(rows)
        print(f"  training log -> {log_path}")

    return agent


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--opponent", choices=["fixed", "randomized"], default="randomized")
    parser.add_argument("--toughness", choices=["slow", "medium", "fast"], default="medium",
                         help="only used when --opponent=fixed")
    parser.add_argument("--episodes", type=int, default=30000)
    parser.add_argument("--out", default="models/buyer.json")
    parser.add_argument("--log", default=None, help="optional CSV path to log training curve")
    parser.add_argument("--seed", type=int, default=42,
                         help="random seed, for reproducible training runs")
    args = parser.parse_args()

    random.seed(args.seed)
    train(args.episodes, args.opponent, args.toughness, args.out, args.log)

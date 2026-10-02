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
from .opponent import FixedScheduleSeller, MixedSeller, RandomizedSeller


def build_opponent(kind: str, toughness: str):
    if kind == "randomized":
        return RandomizedSeller()
    if kind == "fixed":
        return FixedScheduleSeller(toughness=toughness)
    if kind == "mixed":
        return MixedSeller()
    raise ValueError(f"unknown opponent kind '{kind}'")


def train(episodes: int, opponent_kind: str, toughness: str, out_path: str,
          log_path: str = None, log_every: int = 100,
          timeout_penalty: float = 0.0, use_stall_feature: bool = True, use_limit_feature: bool = True):
    opponent = build_opponent(opponent_kind, toughness)
    env = NegotiationEnv(opponent)
    agent = QLearningAgent(use_stall_feature=use_stall_feature, use_limit_feature=use_limit_feature)
    # v7's per-round cost is gone entirely (round_cost stays 0 — applied to
    # every outcome including deals, it pushed the agent to rush all
    # negotiations). v8 only shapes TIMEOUT, which is otherwise reward-free
    # and therefore indistinguishable from an early WALK.
    agent.round_cost = 0.0
    agent.timeout_penalty = timeout_penalty

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
        # timeout_penalty shapes the TRAINING target only — environment.py's
        # raw `reward` (used below for deal-rate/surplus logging, and by
        # evaluate.py) is never touched, so evaluation numbers stay directly
        # comparable across versions.
        final_reward = -timeout_penalty if state.outcome == "timeout" else reward
        agent.end_episode(final_reward)

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
    parser.add_argument("--opponent", choices=["fixed", "randomized", "mixed"], default="randomized")
    parser.add_argument("--toughness", choices=["slow", "medium", "fast"], default="medium",
                         help="only used when --opponent=fixed")
    parser.add_argument("--episodes", type=int, default=30000)
    parser.add_argument("--out", default="models/buyer.json")
    parser.add_argument("--log", default=None, help="optional CSV path to log training curve")
    parser.add_argument("--seed", type=int, default=42,
                         help="random seed, for reproducible training runs")
    parser.add_argument("--timeout-penalty", type=float, default=0.0,
                         help="reward applied as -timeout_penalty when an episode times out, instead of the usual 0 (v8)")
    parser.add_argument("--no-stall-feature", action="store_true",
                         help="disable the stall-count state dimension (v7) and train a v6-shaped 3-D Q-table")
    parser.add_argument("--no-limit-feature", action="store_true",
                         help="disable the at-limit state dimension (v8)")
    args = parser.parse_args()

    random.seed(args.seed)
    train(args.episodes, args.opponent, args.toughness, args.out, args.log,
          timeout_penalty=args.timeout_penalty, use_stall_feature=not args.no_stall_feature,
          use_limit_feature=not args.no_limit_feature)

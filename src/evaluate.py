"""
evaluate.py — runs a trained (frozen, greedy) agent against all four
evaluation opponent conditions and reports deal rate + surplus captured.
This produces the numbers for the project report, rather than eyeballing
single sessions or only checking an agent against its own training
opponent.

Usage:
    python -m src.evaluate --model models/buyer_fixed_medium.json --episodes 3000
    python -m src.evaluate --model models/buyer_randomized.json --episodes 3000 --plot results/comparison.png
"""

import argparse
import json
import random

from .agent import QLearningAgent
from .environment import NegotiationEnv
from .opponent import FixedScheduleSeller, MixedSeller, RandomizedSeller


def evaluate_against(agent: QLearningAgent, opponent, episodes: int):
    env = NegotiationEnv(opponent)
    deals = 0
    surplus_sum = 0.0
    surplus_count = 0

    for _ in range(episodes):
        state = env.reset()
        while not state.done:
            action = agent.act(state, greedy=True)
            state, reward = env.step(action)
        if state.outcome == "deal":
            deals += 1
            zopa = state.zopa
            if zopa > 1:
                surplus_count += 1
                surplus_sum += max(0.0, min(1.0, reward / zopa))

    return {
        "deal_rate": deals / episodes,
        "avg_surplus_captured": (surplus_sum / surplus_count) if surplus_count else None,
    }


def run_full_comparison(model_path: str, episodes: int):
    agent = QLearningAgent()
    agent.load(model_path)

    results = {}
    for toughness in ["slow", "medium", "fast"]:
        results[f"fixed_{toughness}"] = evaluate_against(agent, FixedScheduleSeller(toughness), episodes)
    results["randomized"] = evaluate_against(agent, RandomizedSeller(), episodes)
    results["mixed"] = evaluate_against(agent, MixedSeller(), episodes)
    return results


def print_results(results: dict):
    print(f"{'Opponent':<18}{'Deal rate':<14}{'Avg surplus captured'}")
    for name, r in results.items():
        deal_rate = f"{r['deal_rate']:.1%}"
        surplus = f"{r['avg_surplus_captured']:.1%}" if r["avg_surplus_captured"] is not None else "—"
        print(f"{name:<18}{deal_rate:<14}{surplus}")


def plot_results(results: dict, out_path: str):
    import matplotlib.pyplot as plt

    names = list(results.keys())
    deal_rates = [results[n]["deal_rate"] * 100 for n in names]
    surplus = [(results[n]["avg_surplus_captured"] or 0) * 100 for n in names]

    x = range(len(names))
    fig, ax = plt.subplots(figsize=(8, 5))
    width = 0.35
    ax.bar([i - width / 2 for i in x], deal_rates, width, label="Deal rate (%)")
    ax.bar([i + width / 2 for i in x], surplus, width, label="Avg surplus captured (%)")
    ax.set_xticks(list(x))
    ax.set_xticklabels(names, rotation=20)
    ax.set_ylabel("%")
    ax.set_title("Agent performance across opponent types")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    print(f"  plot saved -> {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--episodes", type=int, default=2000)
    parser.add_argument("--plot", default=None)
    parser.add_argument("--json", default=None)
    parser.add_argument("--seed", type=int, default=None,
                         help="random seed for evaluation draws, independent of training seed")
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    results = run_full_comparison(args.model, args.episodes)
    print_results(results)

    if args.plot:
        plot_results(results, args.plot)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2)
        print(f"  raw results -> {args.json}")

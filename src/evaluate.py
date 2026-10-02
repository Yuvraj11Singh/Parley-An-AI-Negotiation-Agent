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
from .safeguard import SAFEGUARD_HOLD_ROUNDS, RULE_B_ENABLED, RULE_B_STALL_ROUNDS, should_walk_away


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


def evaluate_against_with_safeguard(agent: QLearningAgent, opponent, episodes: int,
                                     n: int = SAFEGUARD_HOLD_ROUNDS,
                                     rule_b_enabled: bool = RULE_B_ENABLED,
                                     m: int = RULE_B_STALL_ROUNDS):
    """
    Same as evaluate_against, but before each action the same should_walk_away
    check the live server runs is applied — if it fires, "WALK" is used in
    place of the agent's own choice. Reuses NegotiationEnv.step() unchanged,
    so this never touches the environment's rules, only which action gets
    passed into it. Separates walk-aways by who/what caused them (the
    agent's own policy, Rule A's deadlock check, or Rule B's stubborn-seller
    check) so each can be reported and weighed independently.
    """
    env = NegotiationEnv(opponent)
    deals = 0
    surplus_sum = 0.0
    surplus_count = 0
    walks_agent = 0
    walks_rule_a = 0
    walks_rule_b = 0
    timeouts = 0
    rule_a_walk_rounds = []
    rule_b_walk_rounds = []

    for _ in range(episodes):
        state = env.reset()
        last_reason = None
        while not state.done:
            reason = should_walk_away(state, n, rule_b_enabled, m)
            if reason:
                action = "WALK"
            else:
                action = agent.act(state, greedy=True)
            last_reason = reason if reason else ("agent" if action == "WALK" else None)
            state, reward = env.step(action)

        if state.outcome == "deal":
            deals += 1
            zopa = state.zopa
            if zopa > 1:
                surplus_count += 1
                surplus_sum += max(0.0, min(1.0, reward / zopa))
        elif state.outcome == "walk":
            if last_reason == "safeguard":
                walks_rule_a += 1
                rule_a_walk_rounds.append(state.round)
            elif last_reason == "seller_stalled":
                walks_rule_b += 1
                rule_b_walk_rounds.append(state.round)
            else:
                walks_agent += 1
        else:
            timeouts += 1

    return {
        "deal_rate": deals / episodes,
        "avg_surplus_captured": (surplus_sum / surplus_count) if surplus_count else None,
        "walk_rate_agent": walks_agent / episodes,
        "walk_rate_safeguard": walks_rule_a / episodes,
        "walk_rate_seller_stalled": walks_rule_b / episodes,
        "timeout_rate": timeouts / episodes,
        "avg_safeguard_walk_round": (sum(rule_a_walk_rounds) / len(rule_a_walk_rounds))
                                     if rule_a_walk_rounds else None,
        "avg_seller_stalled_walk_round": (sum(rule_b_walk_rounds) / len(rule_b_walk_rounds))
                                          if rule_b_walk_rounds else None,
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

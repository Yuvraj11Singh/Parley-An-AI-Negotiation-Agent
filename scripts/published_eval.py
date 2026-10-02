"""
scripts/published_eval.py — produces the exact numbers shown on the landing
page (app/static/index.html) and the Agent Insights panel
(app/static/dashboard.html). Committed and seeded so anyone can reproduce
them by running this file, rather than quoting a number nobody can
regenerate.

Configuration actually served (app/server.py), evaluated here with the same
code: v6 (models/buyer_randomized_v6.json), the round-offset fix, the
deterministic greedy tie-break (agent.py), and the walk-away safeguard's
Rule A (src/safeguard.py) at N=4, Rule B OFF — see the safeguard-generalization
report for why N=4 (no N from {3,4,5} cleanly passes every acceptance bar;
N=4 was the closest, and is what app/server.py currently ships).

Usage:
    python -m scripts.published_eval
"""

import random

from src.agent import QLearningAgent
from src.evaluate import evaluate_against_with_safeguard
from src.opponent import FixedScheduleSeller, MixedSeller, RandomizedSeller

# Recorded, not guessed: the exact seed and sample size behind every number
# this script prints. This is the project's held-out evaluation seed, used
# throughout (never the seed used to pick which training run to serve).
HELD_OUT_SEED = 600
EPISODES = 3000

# The served model, plus the two other candidate training seeds from the
# same run (for an honest, reproducible 3-seed spread — not a guess, and
# not re-using stale numbers from a different model version).
SERVED_MODEL = "models/buyer_randomized_v6.json"
SEED_MODELS = {
    42: "models/buyer_v6_s42.json",
    43: "models/buyer_v6_s43.json",
    44: "models/buyer_v6_s44.json",  # == buyer_randomized_v6.json, the served model
}

RULE_A_N = 4  # see module docstring


def make_opponents():
    return {
        "fixed_slow": FixedScheduleSeller("slow"),
        "fixed_medium": FixedScheduleSeller("medium"),
        "fixed_fast": FixedScheduleSeller("fast"),
        "randomized": RandomizedSeller(),
        "mixed": MixedSeller(),
    }


def evaluate_model(model_path: str):
    agent = QLearningAgent()
    agent.load(model_path)
    results = {}
    for name, opponent in make_opponents().items():
        random.seed(HELD_OUT_SEED)
        results[name] = evaluate_against_with_safeguard(agent, opponent, EPISODES, n=RULE_A_N)
    return results


def main():
    print(f"Served model: {SERVED_MODEL}")
    print(f"Held-out seed: {HELD_OUT_SEED}  |  Episodes per condition: {EPISODES}  |  Rule A N={RULE_A_N}, Rule B off\n")

    served = evaluate_model(SERVED_MODEL)
    print(f"{'Condition':<14}{'Deal rate':<12}{'Surplus captured':<18}{'Safeguard fire %'}")
    for name, r in served.items():
        print(f"{name:<14}{r['deal_rate']*100:<12.1f}{(r['avg_surplus_captured'] or 0)*100:<18.1f}{r['walk_rate_safeguard']*100:.1f}")

    print(f"\n3-seed spread, one point per training seed, same seed/episodes/config, every condition:")
    seed_results = {seed: evaluate_model(path) for seed, path in SEED_MODELS.items()}
    print(f"{'Condition':<14}{'mean deal':<12}{'+/-':<8}{'mean surplus':<14}{'+/-'}")
    spread = {}
    for cond in make_opponents():
        rates = [seed_results[s][cond]["deal_rate"] * 100 for s in SEED_MODELS]
        surps = [(seed_results[s][cond]["avg_surplus_captured"] or 0) * 100 for s in SEED_MODELS]
        mean_rate, spread_rate = sum(rates) / len(rates), max(rates) - sum(rates) / len(rates)
        mean_surp, spread_surp = sum(surps) / len(surps), max(surps) - sum(surps) / len(surps)
        spread[cond] = dict(mean_rate=mean_rate, spread_rate=spread_rate, mean_surp=mean_surp, spread_surp=spread_surp)
        print(f"{cond:<14}{mean_rate:<12.1f}{spread_rate:<8.1f}{mean_surp:<14.1f}{spread_surp:.1f}")

    return served, spread


if __name__ == "__main__":
    main()

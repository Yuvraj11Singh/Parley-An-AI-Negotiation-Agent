"""
tests/test_safeguard_consistency.py — guards against the server and the
evaluation code disagreeing about the agent's decisions, the safeguard's
timing, or the outcome, for the same scripted sequence of seller asks.

This test became possible to write in its strong (exact-trajectory-match)
form only after two bugs were fixed:

1. app/server.py used to increment state.round BEFORE calling agent.act(),
   while NegotiationEnv.step() (environment.py, used by training and
   evaluate.py) increments it AFTER — so the live server always consulted
   one Q-table round-bucket ahead of what training intended.
2. agent.act() used random.choice() to break ties among equally-good
   actions even in greedy (served/evaluation) mode. In states never visited
   during training (all 8 Q-values exactly 0.0), this made the "frozen,
   greedy" policy pick a different action — including WALK — on different
   runs of the identical scenario.

With both fixed (round increment moved in server.py; greedy mode always
picks the lowest-index tied action — see agent.py's act()), the server and
evaluate.py's own mechanics must produce byte-for-byte identical actions,
offers and outcomes for the same ask sequence, and the same scenario must
be exactly reproducible across repeated runs. That is what this file checks.
"""

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "app"))

from src.agent import QLearningAgent
from src.environment import NegotiationEnv, MAX_ROUNDS
from src.opponent import BaseSeller
from src.safeguard import should_walk_away

import server as app_server

MODEL_PATH = str(PROJECT_ROOT / "models" / "buyer_randomized_v6.json")


class ScriptedAskSeller(BaseSeller):
    """A seller whose ask for round r is schedule(r) — deterministic and
    unreactive to the buyer's offer, so it can drive both NegotiationEnv and
    the live server with the identical input."""

    def __init__(self, schedule):
        self.schedule = schedule

    def reset(self, seller_min):
        pass

    def opening_ask(self, seller_min):
        return self.schedule(1)

    def respond(self, state):
        return self.schedule(state.round)


def _scenario_3_schedule(r, _s={1: 90000.0, 2: 86250.0, 3: 82500.0, 4: 78750.0, 5: 75000.0}):
    return _s.get(r, 75000.0)


SCENARIOS = {
    "scenario_1_impossible_frozen_above_max": dict(
        buyer_max=119193.8, seller_min=87457.5, schedule=lambda r: 120000.0,
    ),
    "scenario_2_huge_gap_frozen_above_max": dict(
        buyer_max=25449.0, seller_min=15000.0, schedule=lambda r: 100000.0,
    ),
    "scenario_3_closes_at_75000": dict(
        buyer_max=99025.2, seller_min=67391.7, schedule=_scenario_3_schedule,
    ),
}


def run_evaluation_path(buyer_max, seller_min, schedule):
    """The canonical convention: training and evaluate.py both call
    agent.act() BEFORE NegotiationEnv.step() increments state.round."""
    agent = QLearningAgent()
    agent.load(MODEL_PATH)
    env = NegotiationEnv(ScriptedAskSeller(schedule),
                          buyer_max_range=(buyer_max, buyer_max),
                          seller_min_range=(seller_min, seller_min))
    state = env.reset()
    state.buyer_offer = max(0.0, buyer_max * 0.35)
    state.history[0] = (0, state.buyer_offer, state.seller_ask, "opening")

    trajectory = []
    while not state.done:
        reason = should_walk_away(state)
        if reason:
            action = "WALK"
        else:
            action = agent.act(state, greedy=True)
            reason = "agent" if action == "WALK" else None
        state, _ = env.step(action)
        trajectory.append((state.round, action, reason, round(state.buyer_offer, 1),
                            round(state.seller_ask, 1), state.outcome))
    return trajectory


def run_server_path(buyer_max, seller_min, schedule):
    """Drives the identical scenario through the real Flask app via its test
    client hitting POST /api/offer. There is no public endpoint to set an
    exact buyer_max/seller_min (the real app always randomizes them), so a
    normal negotiation is started through the public API and the live
    session's state is then overwritten with the scenario's exact numbers;
    every round after that is played through the real submit_offer() view."""
    client = app_server.app.test_client()
    client.post("/api/new_negotiation", json={"category": "real_estate", "item": "warehouse_lease"})

    state = app_server.session["state"]
    state.buyer_max = buyer_max
    state.seller_min = seller_min
    state.buyer_offer = max(0.0, buyer_max * 0.35)
    state.seller_ask = schedule(1)
    state.round = 0
    state.history = [(0, state.buyer_offer, state.seller_ask, "opening")]
    app_server.session["seller_min"] = seller_min

    trajectory = []
    for r in range(1, MAX_ROUNDS + 1):
        resp = client.post("/api/offer", json={"ask": schedule(r)})
        d = resp.get_json()
        trajectory.append((d["round"], d["action"], d["walk_reason"], d["buyer_offer"], d["seller_ask"], d["outcome"]))
        if d["done"]:
            return trajectory
    raise AssertionError("negotiation did not finish within MAX_ROUNDS")


class SafeguardConsistencyTest(unittest.TestCase):
    def test_history_discipline_matches_environment_py(self):
        """Direct unit check: state.history must gain exactly one entry per
        round, each holding that round's FINAL buyer_offer/seller_ask —
        matching NegotiationEnv.step()'s own single append per round."""
        client = app_server.app.test_client()
        client.post("/api/new_negotiation", json={"category": "real_estate", "item": "warehouse_lease"})
        state = app_server.session["state"]
        state.buyer_max = 119193.8
        state.seller_min = 87457.5
        state.buyer_offer = max(0.0, 119193.8 * 0.35)
        state.seller_ask = 120000.0
        state.round = 0
        state.history = [(0, state.buyer_offer, state.seller_ask, "opening")]
        app_server.session["seller_min"] = 87457.5

        for expected_round in range(1, 4):
            client.post("/api/offer", json={"ask": 120000.0})
            self.assertEqual(len(state.history), expected_round + 1,
                              f"after round {expected_round}, history should hold exactly "
                              f"{expected_round + 1} entries (round 0 + one per completed round)")
            self.assertEqual(state.history[-1][0], expected_round)

    def test_server_and_evaluation_paths_match_exactly_for_frozen_asks(self):
        """With the round-offset and tie-breaking bugs fixed, the two paths
        must produce the identical (round, action, walk_reason, buyer_offer,
        seller_ask, outcome) trajectory for a FROZEN ask (Scenarios 1 & 2) —
        where "frozen" matters: see test_scenario_3_outcome_matches below for
        why a changing ask is a different, separate case."""
        for name in ("scenario_1_impossible_frozen_above_max", "scenario_2_huge_gap_frozen_above_max"):
            cfg = SCENARIOS[name]
            with self.subTest(scenario=name):
                eval_trajectory = run_evaluation_path(cfg["buyer_max"], cfg["seller_min"], cfg["schedule"])
                server_trajectory = run_server_path(cfg["buyer_max"], cfg["seller_min"], cfg["schedule"])
                self.assertEqual(eval_trajectory, server_trajectory,
                                  f"{name}: server and evaluation paths diverged")

    def test_scenario_3_outcome_matches_despite_known_ask_timing_difference(self):
        """Scenario 3's ask CHANGES round to round, which exposes a third,
        separate, pre-existing difference this task did not fix: environment.py
        has the agent commit to its concession before NegotiationEnv.step()
        reveals that round's seller response (opponent.respond() runs after
        the buyer's move), while app/server.py lets the agent react to the
        human's ask the moment it's submitted. That makes round-by-round
        identity impossible here without changing WHEN the server reveals an
        ask to the agent — a materially bigger, UX-affecting change than
        this task's two authorized fixes, and out of scope for it.

        What must still hold, and does: both paths reach the same OUTCOME —
        a deal at 75,000, with the safeguard never firing — which is the
        actual acceptance bar for this scenario."""
        cfg = SCENARIOS["scenario_3_closes_at_75000"]
        eval_trajectory = run_evaluation_path(cfg["buyer_max"], cfg["seller_min"], cfg["schedule"])
        server_trajectory = run_server_path(cfg["buyer_max"], cfg["seller_min"], cfg["schedule"])

        eval_outcome, eval_deal_price = eval_trajectory[-1][5], eval_trajectory[-1][4]
        server_outcome, server_deal_price = server_trajectory[-1][5], server_trajectory[-1][4]
        self.assertEqual(eval_outcome, "deal")
        self.assertEqual(server_outcome, "deal")
        self.assertAlmostEqual(eval_deal_price, 75000.0, places=1)
        self.assertAlmostEqual(server_deal_price, 75000.0, places=1)
        self.assertFalse(any(reason == "safeguard" for *_, reason, _, _, _ in eval_trajectory))
        self.assertFalse(any(reason == "safeguard" for *_, reason, _, _, _ in server_trajectory))

        # confirm the round-by-round transcripts genuinely do still diverge
        # for the diagnosed, understood reason (not something else) — if
        # this ever starts passing, the ask-timing difference above has
        # disappeared and this test (and its docstring) need updating
        self.assertNotEqual(eval_trajectory, server_trajectory,
                             "scenario 3's transcripts now match exactly — the documented ask-timing "
                             "difference this test exists to track may have been fixed elsewhere; "
                             "if so, merge this into test_server_and_evaluation_paths_match_exactly_for_frozen_asks")

    def test_scenarios_are_reproducible(self):
        """Running the same scenario twice through the live server must give
        exactly the same transcript — no more random tie-breaking."""
        for name, cfg in SCENARIOS.items():
            with self.subTest(scenario=name):
                first = run_server_path(cfg["buyer_max"], cfg["seller_min"], cfg["schedule"])
                second = run_server_path(cfg["buyer_max"], cfg["seller_min"], cfg["schedule"])
                self.assertEqual(first, second, f"{name}: repeated run produced a different transcript")


if __name__ == "__main__":
    unittest.main()

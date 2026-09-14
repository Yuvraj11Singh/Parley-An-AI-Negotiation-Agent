"""
server.py — Flask API exposing the trained buyer agent for interactive
human-vs-agent negotiation. Single in-memory session (one negotiation at
a time) — a deliberate simplification for a local demo, not intended for
multiple concurrent users.
"""

import random
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

sys.path.append(str(Path(__file__).resolve().parent.parent))
from src.agent import QLearningAgent
from src.environment import NegotiationState, DEAL_TOLERANCE

app = Flask(__name__, static_folder="static")

agent = QLearningAgent()
agent.load(str(Path(__file__).resolve().parent.parent / "models" / "buyer_randomized_v3.json"))

session = {"state": None, "seller_min": None}

CATEGORIES = {
    "electronics":   {"name": "Electronics & Gadgets",        "icon": "💻", "min": 350,    "max": 650},
    "furniture":     {"name": "Office Furniture",              "icon": "🪑", "min": 210,    "max": 390},
    "vehicles":      {"name": "Vehicles & Fleet",               "icon": "🚚", "min": 21000,  "max": 39000},
    "supplies":      {"name": "Industrial & Bulk Supplies",     "icon": "📦", "min": 10500,  "max": 19500},
    "services":      {"name": "Professional Services",          "icon": "🧰", "min": 5600,   "max": 10400},
    "real_estate":   {"name": "Commercial Real Estate",         "icon": "🏢", "min": 140000, "max": 260000},
}
DEFAULT_CATEGORY = "electronics"


def _serialize(state: NegotiationState, revealed: bool = False):
    return {
        "round": state.round,
        "buyer_offer": round(state.buyer_offer, 1),
        "seller_ask": round(state.seller_ask, 1),
        "done": state.done,
        "outcome": state.outcome,
        "deal_price": round(state.deal_price, 1) if state.deal_price else None,
        "buyer_max": round(state.buyer_max, 1) if revealed else None,
    }


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/dashboard")
def dashboard():
    return send_from_directory(app.static_folder, "dashboard.html")


@app.route("/categories")
def categories():
    return send_from_directory(app.static_folder, "categories.html")


@app.route("/desk")
def desk():
    return send_from_directory(app.static_folder, "desk.html")


@app.route("/api/categories", methods=["GET"])
def get_categories():
    return jsonify(CATEGORIES)


@app.route("/api/new_negotiation", methods=["POST"])
def new_negotiation():
    data = request.get_json(silent=True) or {}
    category_id = data.get("category", DEFAULT_CATEGORY)
    cat = CATEGORIES.get(category_id, CATEGORIES[DEFAULT_CATEGORY])

    seller_min = random.uniform(cat["min"], cat["max"])
    buyer_max = random.uniform(cat["min"] * 1.15, cat["max"] * 1.3)
    buyer_offer = max(0.0, buyer_max * 0.35 + random.uniform(0, cat["max"] * 0.05))

    state = NegotiationState(
        buyer_max=buyer_max,
        seller_min=seller_min,
        buyer_offer=buyer_offer,
        seller_ask=buyer_offer,  # placeholder until the human sends a real ask
    )
    session["state"] = state
    session["seller_min"] = seller_min
    session["category"] = category_id

    return jsonify({
        "seller_min": round(seller_min, 1),
        "category": cat["name"],
        **_serialize(state)
    })


@app.route("/api/offer", methods=["POST"])
def submit_offer():
    state = session["state"]
    if state is None or state.done:
        return jsonify({"error": "no negotiation in progress — call /api/new_negotiation first"}), 400

    data = request.get_json()
    seller_ask = float(data["ask"])
    if seller_ask < session["seller_min"]:
        return jsonify({"error": f"that's below your own minimum of {session['seller_min']:.1f}"}), 400

    state.round += 1
    state.seller_ask = seller_ask

    action = agent.act(state, greedy=True)

    if action == "WALK":
        state.done = True
        state.outcome = "walk"
        return jsonify(_serialize(state, revealed=True))

    concession = float(action)
    state.buyer_offer = min(state.buyer_max, state.buyer_offer + concession * state.gap)

    if state.buyer_offer >= state.seller_ask - DEAL_TOLERANCE:
        state.done = True
        state.outcome = "deal"
        state.deal_price = state.seller_ask
        return jsonify(_serialize(state, revealed=True))

    if state.round >= 10:
        state.done = True
        state.outcome = "timeout"
        return jsonify(_serialize(state, revealed=True))

    return jsonify(_serialize(state))


if __name__ == "__main__":
    app.run(debug=True, port=5000)

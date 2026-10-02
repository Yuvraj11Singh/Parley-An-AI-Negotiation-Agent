"""
server.py — Flask API exposing the trained buyer agent for interactive
human-vs-agent negotiation. Single in-memory session (one negotiation at
a time) — a deliberate simplification for a local demo, not intended for
multiple concurrent users.
"""

import csv
import random
import sys
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

sys.path.append(str(Path(__file__).resolve().parent.parent))
from src.agent import QLearningAgent
from src.environment import MAX_ROUNDS, NegotiationState, deal_tolerance
from src.safeguard import SAFEGUARD_HOLD_ROUNDS, should_walk_away

app = Flask(__name__, static_folder="static")

agent = QLearningAgent()
agent.load(str(Path(__file__).resolve().parent.parent / "models" / "buyer_randomized_v6.json"))

session = {"state": None, "seller_min": None}

CATEGORIES = {
    "electronics": {"name": "Electronics & Gadgets",     "icon": "💻"},
    "furniture":   {"name": "Office Furniture",           "icon": "🪑"},
    "vehicles":    {"name": "Vehicles & Fleet",           "icon": "🚚"},
    "supplies":    {"name": "Industrial & Bulk Supplies", "icon": "📦"},
    "services":    {"name": "Professional Services",      "icon": "🧰"},
    "real_estate": {"name": "Commercial Real Estate",     "icon": "🏢"},
    "software":    {"name": "Software & SaaS Licenses",   "icon": "🧩"},
    "logistics":   {"name": "Logistics & Freight",        "icon": "🚢"},
    "materials":   {"name": "Raw Materials",              "icon": "⛏️"},
    "machinery":   {"name": "Manufacturing Machinery",    "icon": "⚙️"},
}

ITEMS = {
    # electronics
    "laptops_20":     {"category": "electronics", "name": "Business laptops — 20 units", "description": "Mid-range 14\" business laptops for a new sales team.", "details": ["Core i5 / 16GB / 512GB SSD", "Qty 20, 3-year onsite warranty", "Delivery within 3 weeks"], "min": 16000, "max": 24000},
    "monitors_40":    {"category": "electronics", "name": "27\" monitors — 40 units", "description": "Standard office displays for a floor refresh.", "details": ["27\" IPS, 1440p, USB-C", "Qty 40, 2-year warranty", "Palletized delivery"], "min": 9000, "max": 14000},
    "server_rack":    {"category": "electronics", "name": "Rack server — 2 units", "description": "Two rack servers for an on-prem application cluster.", "details": ["Dual-socket, 128GB RAM, 4×2TB NVMe", "Qty 2, 5-year support contract", "Installation included"], "min": 18000, "max": 28000},
    # furniture
    "desks_50":       {"category": "furniture", "name": "Sit-stand desks — 50 units", "description": "Electric height-adjustable desks for an open-plan office.", "details": ["Dual-motor, 120×70cm top", "Qty 50, assembled on site", "5-year warranty"], "min": 18000, "max": 27000},
    "chairs_60":      {"category": "furniture", "name": "Ergonomic task chairs — 60 units", "description": "Mesh-back ergonomic chairs for all workstations.", "details": ["Adjustable lumbar, 4D arms", "Qty 60, delivered assembled", "10-year warranty"], "min": 15000, "max": 24000},
    "meeting_pods":   {"category": "furniture", "name": "Acoustic meeting pods — 4 units", "description": "Enclosed 4-person pods for a noisy open floor.", "details": ["Ventilated, lit, power + USB", "Qty 4, installation included", "Lead time 6 weeks"], "min": 32000, "max": 48000},
    # vehicles
    "vans_5":         {"category": "vehicles", "name": "Delivery vans — 5 units", "description": "Medium panel vans for last-mile delivery.", "details": ["Diesel, 3.5t, 11m³ cargo", "Qty 5, fleet livery included", "3-year service plan"], "min": 140000, "max": 200000},
    "forklifts_2":    {"category": "vehicles", "name": "Electric forklifts — 2 units", "description": "Counterbalance forklifts for a distribution warehouse.", "details": ["2.5t capacity, lithium battery", "Qty 2, operator training included", "Spare parts kit"], "min": 55000, "max": 80000},
    "exec_sedans_3":  {"category": "vehicles", "name": "Executive sedans — 3 units", "description": "Company cars for the senior leadership team.", "details": ["Hybrid, premium trim", "Qty 3, 4-year lease-to-own", "Maintenance included"], "min": 120000, "max": 165000},
    # supplies
    "packaging_pallets": {"category": "supplies", "name": "Corrugated packaging — 40 pallets", "description": "Annual supply of shipping cartons in three sizes.", "details": ["Double-wall, printed logo", "40 pallets, quarterly deliveries", "Recyclable stock"], "min": 22000, "max": 34000},
    "safety_ppe":     {"category": "supplies", "name": "PPE annual contract", "description": "Gloves, eyewear, hi-vis, and hearing protection for 300 staff.", "details": ["Certified to local standards", "12-month supply, monthly restock", "Sizing kit included"], "min": 30000, "max": 45000},
    "cleaning_supplies": {"category": "supplies", "name": "Facilities consumables — annual", "description": "Cleaning and washroom consumables for three sites.", "details": ["Eco-certified range", "12 months, auto-replenish", "Dispenser installation"], "min": 12000, "max": 20000},
    # services
    "it_support":     {"category": "services", "name": "Managed IT support — 12 months", "description": "Helpdesk and infrastructure support for 200 users.", "details": ["24/7 helpdesk, 4-hour SLA", "Monthly reporting", "Onboarding included"], "min": 60000, "max": 90000},
    "legal_retainer": {"category": "services", "name": "Legal retainer — 12 months", "description": "Commercial contracts and compliance advisory.", "details": ["Up to 20 hours/month", "Dedicated partner contact", "Quarterly review"], "min": 48000, "max": 72000},
    "brand_campaign": {"category": "services", "name": "Brand campaign — Q4", "description": "Creative, media planning, and production for a product launch.", "details": ["Multi-channel, 8-week run", "Two creative concepts", "Performance reporting"], "min": 75000, "max": 120000},
    # real estate
    "office_lease":   {"category": "real_estate", "name": "Office lease — 5,000 sq ft, 3 years", "description": "City-centre office space for a growing team.", "details": ["Fitted, 3-year term", "2 parking bays", "Annual rent negotiated"], "min": 150000, "max": 240000},
    "warehouse_lease": {"category": "real_estate", "name": "Warehouse lease — 20,000 sq ft", "description": "Distribution warehouse near the ring road.", "details": ["Dock-level loading, 8m eaves", "5-year term, break at 3", "Annual rent negotiated"], "min": 180000, "max": 280000},
    "retail_unit":    {"category": "real_estate", "name": "Retail unit — high street, 2 years", "description": "Ground-floor retail unit for a flagship store.", "details": ["1,200 sq ft, glazed frontage", "2-year term", "Fit-out contribution requested"], "min": 90000, "max": 140000},
    # software
    "crm_licenses":   {"category": "software", "name": "CRM licenses — 150 seats, annual", "description": "Sales CRM for the commercial team.", "details": ["Enterprise tier, SSO", "150 seats, 12 months", "Migration support"], "min": 54000, "max": 85000},
    "erp_module":     {"category": "software", "name": "ERP finance module — annual", "description": "Finance and procurement module on the existing ERP.", "details": ["Up to 40 named users", "Implementation + training", "12-month support"], "min": 80000, "max": 130000},
    "security_suite": {"category": "software", "name": "Endpoint security — 500 devices", "description": "EDR and device management across all endpoints.", "details": ["500 devices, 12 months", "24/7 SOC monitoring", "Compliance reporting"], "min": 35000, "max": 55000},
    # logistics
    "freight_contract": {"category": "logistics", "name": "Freight contract — 12 months", "description": "Domestic road freight for weekly regional distribution.", "details": ["~40 loads/month", "Tracked, insured", "Fuel surcharge capped"], "min": 220000, "max": 330000},
    "customs_brokerage": {"category": "logistics", "name": "Customs brokerage — annual", "description": "Import clearance and compliance for ~600 shipments.", "details": ["All entry types", "Duty optimisation review", "Monthly reporting"], "min": 30000, "max": 48000},
    "warehousing_3pl": {"category": "logistics", "name": "3PL warehousing — 6 months", "description": "Pick-pack-ship for seasonal e-commerce volume.", "details": ["2,000 pallet positions", "Peak-season staffing", "Returns handling"], "min": 110000, "max": 170000},
    # materials
    "steel_coil":     {"category": "materials", "name": "Hot-rolled steel coil — 200 t", "description": "Structural steel for a fabrication order.", "details": ["Grade S275, 3–6mm", "200 tonnes, two deliveries", "Mill certificates"], "min": 150000, "max": 220000},
    "polymer_resin":  {"category": "materials", "name": "Polymer resin — 60 t", "description": "Injection-moulding grade resin for a production run.", "details": ["PP copolymer, natural", "60 tonnes, monthly call-off", "Batch traceability"], "min": 78000, "max": 115000},
    "timber_stock":   {"category": "materials", "name": "Kiln-dried timber — 400 m³", "description": "Softwood stock for a joinery contract.", "details": ["C24 graded, 18% MC", "400 m³, staged delivery", "FSC certified"], "min": 130000, "max": 190000},
    # machinery
    "cnc_mill":       {"category": "machinery", "name": "CNC vertical mill", "description": "3-axis mill for a precision machining cell.", "details": ["Travel 1000×500×500mm", "Installation + commissioning", "2-year warranty"], "min": 95000, "max": 150000},
    "packaging_line": {"category": "machinery", "name": "Automated packaging line", "description": "Case erector, filler, and sealer for a new SKU.", "details": ["30 cases/min", "Turnkey install", "Operator training"], "min": 220000, "max": 340000},
    "compressor_system": {"category": "machinery", "name": "Compressed air system", "description": "Central compressor with dryer and distribution.", "details": ["75kW, VSD", "Install + 5-year service", "Energy audit included"], "min": 60000, "max": 95000},
}
DEFAULT_ITEM = "laptops_20"


def _serialize(state: NegotiationState, revealed: bool = False, action=None, walk_reason=None):
    return {
        "round": state.round,
        "buyer_offer": round(state.buyer_offer, 1),
        "seller_ask": round(state.seller_ask, 1),
        "done": state.done,
        "outcome": state.outcome,
        "deal_price": round(state.deal_price, 1) if state.deal_price else None,
        "buyer_max": round(state.buyer_max, 1) if revealed else None,
        # the real decision the trained agent made this round ("WALK" or a
        # concession fraction) — exposed read-only for frontend telemetry,
        # doesn't change how the decision itself is made
        "action": action,
        # "agent" = the trained policy itself chose WALK; "safeguard" = the
        # rule-based walk-away safeguard overrode it; None otherwise
        "walk_reason": walk_reason,
        # a boolean only — never buyer_max itself — so the round timeline can
        # label a round AT LIMIT without revealing the hidden maximum early
        "at_limit": state.buyer_offer >= state.buyer_max - deal_tolerance(state.buyer_max),
        "safeguard_hold_rounds": SAFEGUARD_HOLD_ROUNDS,
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


@app.route("/items")
def items():
    return send_from_directory(app.static_folder, "items.html")


@app.route("/api/categories", methods=["GET"])
def get_categories():
    return jsonify({"categories": CATEGORIES, "items": ITEMS})


@app.route("/api/session_status", methods=["GET"])
def session_status():
    state = session.get("state")
    if state is None or state.done:
        return jsonify({"active": False})
    item = session.get("item") or {}
    return jsonify({
        "active": True,
        "category": session.get("category"),
        "item": item.get("id"),
        "item_name": item.get("name"),
        "round": state.round,
    })


TRAINING_LOGS = {
    "v8": "train_v8.csv",
    "v7": "train_v7.csv",
    "v6": "train_randomized_v6.csv",
    "v5": "train_randomized_v5.csv",
    "v4": "train_randomized_v4.csv",
    "v3": "train_randomized_v3.csv",
    "v2": "train_randomized_v2.csv",
    "v1": "train_randomized.csv",
    "fixed_medium": "train_fixed_medium.csv",
}


@app.route("/api/training_log/<version>", methods=["GET"])
def training_log(version):
    filename = TRAINING_LOGS.get(version)
    if not filename:
        abort(404)
    path = Path(__file__).resolve().parent.parent / "results" / filename
    if not path.exists():
        abort(404)
    rows = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            rows.append({
                "episode": int(row["episode"]),
                "epsilon": float(row["epsilon"]),
                "deal_rate": float(row["deal_rate"]),
                "avg_surplus_captured": float(row["avg_surplus_captured"]) if row["avg_surplus_captured"] not in ("", "None") else None,
            })
    return jsonify(rows)


@app.route("/api/new_negotiation", methods=["POST"])
def new_negotiation():
    data = request.get_json(silent=True) or {}
    raw_item = data.get("item")
    category_id = data.get("category")

    if isinstance(raw_item, dict):
        # custom item defined via the modal
        name = (raw_item.get("name") or "").strip()
        if not name:
            return jsonify({"error": "item name is required"}), 400
        try:
            reference_price = float(raw_item.get("reference_price"))
        except (TypeError, ValueError):
            return jsonify({"error": "reference price must be a positive number"}), 400
        if reference_price <= 0:
            return jsonify({"error": "reference price must be a positive number"}), 400

        item_id = None
        item_name = name
        item_description = raw_item.get("description") or ""
        item_details = raw_item.get("details") or []
        item_quantity = raw_item.get("quantity")
        if category_id not in CATEGORIES:
            category_id = ITEMS[DEFAULT_ITEM]["category"]
    else:
        # old-style catalog item id (string), or missing -> fall back to the default item
        item_key = raw_item if isinstance(raw_item, str) and raw_item in ITEMS else DEFAULT_ITEM
        catalog_item = ITEMS[item_key]
        item_id = item_key
        item_name = catalog_item["name"]
        item_description = catalog_item["description"]
        item_details = catalog_item["details"]
        item_quantity = None
        reference_price = (catalog_item["min"] + catalog_item["max"]) / 2
        category_id = catalog_item["category"]

    cat = CATEGORIES.get(category_id, CATEGORIES[ITEMS[DEFAULT_ITEM]["category"]])

    lo, hi = reference_price * 0.80, reference_price * 1.20
    seller_min = random.uniform(lo, hi)
    buyer_max = random.uniform(lo * 1.15, hi * 1.30)
    buyer_offer = max(0.0, buyer_max * 0.35 + random.uniform(0, hi * 0.05))

    state = NegotiationState(
        buyer_max=buyer_max,
        seller_min=seller_min,
        buyer_offer=buyer_offer,
        seller_ask=buyer_offer,  # placeholder until the human sends a real ask
    )
    # seed round 0 the same way environment.py's reset() does, so
    # state.limit_rounds / state.stall_rounds (and therefore the safeguard)
    # have real history to scan from round 1 onward
    state.history.append((0, buyer_offer, buyer_offer, "opening"))
    item_payload = {
        "id": item_id,
        "name": item_name,
        "description": item_description,
        "details": item_details,
        "quantity": item_quantity,
        "reference_price": reference_price,
    }
    session["state"] = state
    session["seller_min"] = seller_min
    session["category"] = category_id
    session["item"] = item_payload

    return jsonify({
        "seller_min": round(seller_min, 1),
        "category": cat["name"],
        "category_id": category_id,
        "max_rounds": MAX_ROUNDS,
        "item": item_payload,
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

    state.seller_ask = seller_ask

    # agent.act() (and should_walk_away, which also reads state.history) must
    # see state.round exactly as NegotiationEnv.step() would: act() is always
    # called BEFORE round is incremented there (round_b for the decision that
    # PRODUCES round r's result is r-1), so the increment below happens AFTER
    # this decision, not before it. Doing it the other way around (as this
    # file used to) makes the agent consult the Q-table one round-bucket
    # ahead of what training intended, for every served negotiation.
    #
    # should_walk_away() reads state.history, which at this point holds one
    # entry per COMPLETED round only (round r's own entry is appended below,
    # after r is resolved) — this is the same timing NegotiationEnv.step()
    # uses (see environment.py), and is what makes the safeguard's counting
    # identical here and in evaluate.py's safeguard-aware loop. Do not
    # pre-append a provisional entry for the current round before this check.
    #
    # Known, deliberate limitation (not a bug): here, the agent reacts to
    # the seller_ask just set above — the human's ask the instant it's
    # submitted. In training and evaluate.py (NegotiationEnv.step()), the
    # agent instead commits to its concession BEFORE that round's seller
    # response is revealed; the opponent only responds after the buyer's
    # move. Frozen or scripted asks (as in the safeguard's own test
    # scenarios) hide this difference entirely; a live, reactive ask does
    # not. Left as-is: matching the training convention here would mean the
    # live agent always reacts to the human's PREVIOUS message instead of
    # the one just typed, which is a real UX regression for an interactive
    # demo, not something this fix is meant to change.
    safeguard_reason = should_walk_away(state)
    if safeguard_reason:
        action = "WALK"
        walk_reason = safeguard_reason
    else:
        action = agent.act(state, greedy=True)
        walk_reason = "agent" if action == "WALK" else None

    state.round += 1

    if action == "WALK":
        state.done = True
        state.outcome = "walk"
        state.history.append((state.round, state.buyer_offer, state.seller_ask, "buyer walked away"))
        return jsonify(_serialize(state, revealed=True, action=action, walk_reason=walk_reason))

    concession = float(action)
    state.buyer_offer = min(state.buyer_max, state.buyer_offer + concession * state.gap)

    if state.buyer_offer >= state.seller_ask - deal_tolerance(state.buyer_max):
        state.done = True
        state.outcome = "deal"
        state.deal_price = state.seller_ask
        state.history.append((state.round, state.buyer_offer, state.seller_ask, f"deal closed @ {state.deal_price:.1f}"))
        return jsonify(_serialize(state, revealed=True, action=action))

    # single append per continuing round, after this round's buyer_offer and
    # seller_ask are both final — mirrors NegotiationEnv.step()'s own single
    # append for a non-terminal round
    state.history.append((state.round, state.buyer_offer, state.seller_ask, "—"))

    if state.round >= MAX_ROUNDS:
        state.done = True
        state.outcome = "timeout"
        return jsonify(_serialize(state, revealed=True, action=action))

    return jsonify(_serialize(state, action=action))


if __name__ == "__main__":
    app.run(debug=True, port=5000)
